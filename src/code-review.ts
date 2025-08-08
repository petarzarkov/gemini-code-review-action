import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { Octokit } from "@octokit/rest";
import {
  PullRequestDetails,
  GitHubEventData,
  FileData,
  HunkData,
  ReviewComment,
  AiReviewResponse,
  AiResponseData,
} from "./code-review.types";
import { logger } from "./logger";
import { interpolate, matchesPattern, parseExcludePatterns } from "./helpers";
import parseDiff, { ParsedFile, DiffChunk, DiffChange } from "./parse-diff";

export class CodeReviewService {
  private readonly octokit: Octokit;
  private readonly genAi: GoogleGenAI;
  private readonly excludePatterns: string[];
  private readonly modelName: string;
  private promptTemplate: string | null = null;
  private lastRequestTime: number = 0;
  private readonly rateLimitDelay: number;

  constructor(
    githubToken: string,
    geminiApiKey: string,
    excludePatterns: string[] = []
  ) {
    this.octokit = new Octokit({ auth: githubToken });
    this.genAi = new GoogleGenAI({ apiKey: geminiApiKey });
    this.excludePatterns = excludePatterns;
    this.modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

    // Calculate rate limit delay based on model
    const rpmLimits: Record<string, number> = {
      "gemini-2.5-pro": 5,
      "gemini-2.5-flash": 10,
      "gemini-2.5-flash-lite": 15,
      "gemini-2.0-flash": 15,
      "gemini-2.0-flash-lite": 30,
    };

    const rpm = rpmLimits[this.modelName] || 5;
    this.rateLimitDelay = Math.ceil(60000 / rpm); // ms between requests

    logger.info(
      `Using model: ${this.modelName} with ${rpm} RPM (${this.rateLimitDelay}ms delay)`
    );
  }

  public async processCodeReview(): Promise<void> {
    try {
      const prDetails = this.getPullRequestDetails();
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (eventName !== "pull_request") {
        logger.warn(`Unsupported event: ${eventName}`);
        return;
      }

      const diff = await this.getPullRequestDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pullNumber
      );
      if (!diff) {
        logger.warn("No diff found for this pull request");
        return;
      }

      const parsedDiff = this.parseDiff(diff);
      const filteredDiff = this.filterFilesByExcludePatterns(parsedDiff);

      logger.info(
        `Files to analyze after filtering: ${filteredDiff
          .map((f) => f.path)
          .join(", ")}`
      );

      const comments = await this.analyzeCodeChanges(filteredDiff, prDetails);

      if (comments.length > 0) {
        await this.createReviewComments(
          prDetails.owner,
          prDetails.repo,
          prDetails.pullNumber,
          comments
        );
        logger.success(`Created ${comments.length} review comments`);
      } else {
        logger.info("No review comments generated");
      }
    } catch (error) {
      logger.error("Error in code review process:");
      console.error(error);
      throw error;
    }
  }

  private getPullRequestDetails(): PullRequestDetails {
    const eventData = this.getEventData();
    const repoFullName = eventData.repository.full_name;

    if (!eventData.pull_request) {
      throw new Error("No pull request data found in event");
    }

    const [owner, repo] = repoFullName.split("/");

    return {
      owner,
      repo,
      pullNumber: eventData.pull_request.number,
      title: eventData.pull_request.title,
      description: eventData.pull_request.body || "",
    };
  }

  private getEventData(): GitHubEventData {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error("GITHUB_EVENT_PATH environment variable is not set");
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return eventData as GitHubEventData;
  }

  private async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    try {
      logger.processing(`Fetching diff for ${owner}/${repo} PR#${pullNumber}`);

      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: {
          format: "diff",
        },
      });

      const diff = response.data as unknown as string;
      logger.debug(`Retrieved diff length: ${diff.length}`);
      return diff;
    } catch (error) {
      logger.error("Failed to get pull request diff:");
      console.error(error);
      return "";
    }
  }

  private parseDiff(diffStr: string): FileData[] {
    const parsedFiles = parseDiff(diffStr);
    return this.convertParsedFilesToFileData(parsedFiles);
  }

  private convertParsedFilesToFileData(parsedFiles: ParsedFile[]): FileData[] {
    return parsedFiles.map((parsedFile) => {
      const fileData: FileData = {
        path: parsedFile.to === "/dev/null" ? parsedFile.from : parsedFile.to,
        hunks: parsedFile.chunks.map((chunk) =>
          this.convertChunkToHunkData(chunk)
        ),
      };
      return fileData;
    });
  }

  private convertChunkToHunkData(chunk: DiffChunk): HunkData {
    return {
      header: chunk.content,
      lines: chunk.changes.map((change) => this.convertChangeToLine(change)),
      startPosition: 0, // Not used - GitHub API counts from 1 after @@
    };
  }

  private convertChangeToLine(change: DiffChange): string {
    switch (change.type) {
      case "add":
        return `+${change.content}`;
      case "del":
        return `-${change.content}`;
      case "normal":
        return ` ${change.content}`;
      default:
        return change.content;
    }
  }

  private filterFilesByExcludePatterns(files: FileData[]): FileData[] {
    if (this.excludePatterns.length === 0) {
      return files;
    }

    return files.filter((file) => {
      const shouldExclude = this.excludePatterns.some((pattern) =>
        matchesPattern(file.path, pattern)
      );

      if (shouldExclude) {
        logger.debug(`Excluding file: ${file.path}`);
        return false;
      }

      return true;
    });
  }

  private async analyzeCodeChanges(
    files: FileData[],
    prDetails: PullRequestDetails
  ): Promise<ReviewComment[]> {
    logger.processing(`Starting analysis of ${files.length} files`);

    // Process each hunk individually but with rate limiting
    const allComments: ReviewComment[] = [];
    let hunkCount = 0;
    let totalHunks = 0;

    // Count total hunks for progress tracking
    for (const file of files) {
      if (file.path && file.path !== "/dev/null") {
        totalHunks += file.hunks.filter((hunk) => hunk.lines.length > 0).length;
      }
    }

    logger.info(`Processing ${totalHunks} hunks individually`);

    for (const file of files) {
      logger.info(`Processing file: ${file.path}`);

      if (!file.path || file.path === "/dev/null") {
        continue;
      }

      for (const hunk of file.hunks) {
        if (hunk.lines.length === 0) {
          continue;
        }

        hunkCount++;
        logger.processing(`Processing hunk ${hunkCount}/${totalHunks}`);

        const comments = await this.analyzeHunk(file.path, hunk, prDetails);
        allComments.push(...comments);
      }
    }

    logger.success(`Generated ${allComments.length} review comments`);
    return allComments;
  }

  private async analyzeHunk(
    filePath: string,
    hunk: HunkData,
    prDetails: PullRequestDetails
  ): Promise<ReviewComment[]> {
    const prompt = this.createReviewPrompt(filePath, hunk, prDetails);
    const aiResponses = await this.getAiResponse(prompt);

    if (aiResponses.length > 0) {
      return this.createCommentsFromAiResponses(filePath, hunk, aiResponses);
    }

    return [];
  }

  private loadPromptTemplate(): string {
    if (this.promptTemplate !== null) {
      return this.promptTemplate;
    }

    try {
      const promptPath = path.join(__dirname, "prompt.txt");
      this.promptTemplate = fs.readFileSync(promptPath, "utf8");
      return this.promptTemplate;
    } catch (error) {
      logger.error("Error loading prompt template:");
      console.error(error);
      throw new Error("Failed to load prompt template file");
    }
  }

  private createReviewPrompt(
    filePath: string,
    hunk: HunkData,
    prDetails: PullRequestDetails
  ): string {
    const template = this.loadPromptTemplate();

    // Simply join the hunk lines as they contain the diff markers (+, -, space)
    const hunkContent = hunk.lines.join("\n");

    const variables = {
      filePath,
      title: prDetails.title,
      description: prDetails.description || "No description provided",
      hunkContent,
    };

    return interpolate(template, variables);
  }

  private async getAiResponse(
    prompt: string,
    retryCount = 0
  ): Promise<AiReviewResponse[]> {
    const maxRetries = 3;

    try {
      // Rate limiting: ensure we don't exceed API limits
      await this.enforceRateLimit();

      const generationConfig = {
        // maxOutputTokens: 8192 / 2,
        temperature: 0.8,
        topP: 0.95,
      };

      logger.processing(
        `Sending prompt to Gemini AI... (attempt ${retryCount + 1})`
      );
      const result = await this.genAi.models.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        model: this.modelName,
        config: generationConfig,
      });

      let responseText = result.text?.trim();
      if (!responseText) {
        logger.warn("No response text received from AI");
        return [];
      }

      // Clean up response text
      if (responseText.startsWith("```json")) {
        responseText = responseText.slice(7);
      }
      if (responseText.endsWith("```")) {
        responseText = responseText.slice(0, -3);
      }
      responseText = responseText.trim();

      logger.debug(
        `AI response received: ${responseText.substring(0, 100)}...`
      );

      const data = JSON.parse(responseText) as AiResponseData;

      if (data.reviews && Array.isArray(data.reviews)) {
        return data.reviews.filter(
          (review) => review.lineContent && review.reviewComment
        );
      }

      logger.warn("Invalid response format from AI");
      return [];
    } catch (error) {
      logger.error(`Error calling Gemini AI (attempt ${retryCount + 1}):`);
      console.error(error);

      // Check if it's a rate limit error and retry with exponential backoff
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 429
      ) {
        if (retryCount < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30s
          logger.warn(
            `Rate limit exceeded. Retrying in ${backoffDelay}ms... (${
              retryCount + 1
            }/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          return this.getAiResponse(prompt, retryCount + 1);
        } else {
          logger.error("Max retries exceeded. Skipping this request.");
        }
      }

      return [];
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms before next request`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  private createCommentsFromAiResponses(
    filePath: string,
    hunk: HunkData,
    aiResponses: AiReviewResponse[]
  ): ReviewComment[] {
    logger.processing(
      `Creating comments for ${aiResponses.length} AI responses`
    );
    const comments: ReviewComment[] = [];

    for (const aiResponse of aiResponses) {
      try {
        const { lineContent, reviewComment } = aiResponse;

        // The line content from the AI must be a non-empty string and start with '+'
        if (!lineContent || !lineContent.trim().startsWith("+")) {
          logger.warn(
            `AI response provided invalid or non-added lineContent, skipping: "${lineContent}"`
          );
          continue;
        }

        const normalizedAiLine = lineContent.trim().replace(/\s+/g, " ");

        const position =
          hunk.lines.findIndex((hunkLine) => {
            // Normalize the hunk line in the exact same way before comparing
            const normalizedHunkLine = hunkLine.trim().replace(/\s+/g, " ");
            return normalizedHunkLine === normalizedAiLine;
          }) + 1;

        // If we couldn't find the line in the hunk, the AI hallucinated. Skip it.
        if (position === 0) {
          logger.warn(
            `AI provided lineContent that was not found in the hunk, skipping.
          - AI Line (Normalized): "${normalizedAiLine}"
          - Original AI Line: "${lineContent}"`
          );
          continue;
        }

        const comment: ReviewComment = {
          body: reviewComment,
          path: filePath,
          position: position, // Use our calculated, trusted position
        };

        comments.push(comment);
        logger.debug(
          `Created comment for position ${position}: ${reviewComment.substring(
            0,
            100
          )}...`
        );
      } catch (error) {
        logger.error("Error creating comment from AI response:");
        console.error(error, aiResponse);
      }
    }

    return comments;
  }

  private async createReviewComments(
    owner: string,
    repo: string,
    pullNumber: number,
    comments: ReviewComment[]
  ): Promise<void> {
    try {
      logger.processing(`Creating review with ${comments.length} comments`);

      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        body: `${this.modelName} code review comments`,
        comments: comments.map((comment) => ({
          path: comment.path,
          position: comment.position,
          body: comment.body,
        })),
        event: "COMMENT",
      });

      logger.success("Review created successfully");
    } catch (error) {
      logger.error("Error creating review:");
      console.error(error);
      throw error;
    }
  }
}

async function main(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const excludeInput = process.env.INPUT_EXCLUDE || "";

    if (!githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    const excludePatterns = parseExcludePatterns(excludeInput);
    logger.verbose(
      `🚀 Starting Code Review with exclude patterns: ${excludePatterns.join(
        ", "
      )}`
    );

    const codeReviewService = new CodeReviewService(
      githubToken,
      geminiApiKey,
      excludePatterns
    );
    await codeReviewService.processCodeReview();

    logger.success("✨ Code Review completed successfully!");
  } catch (error) {
    logger.error("💥 Error in main:", error as Error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
