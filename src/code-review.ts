import { AIService } from "./services/ai-service";
import { GitHubService } from "./services/github-service";
import { BatchProcessor } from "./services/batch-processor";
import {
  PullRequestDetails,
  FileData,
  ReviewComment,
  ConversationContext,
} from "./types/code-review";
import { logger } from "./utils/logger";
import {
  matchesPattern,
  parseExcludePatterns,
  parseDiffToFileData,
  createCommentsFromAiResponses,
} from "./utils/helpers";
import {
  createContextSummary,
  logContextStats,
} from "./utils/conversation-context";
import pkg from "../package.json";

export class CodeReviewService {
  private readonly githubService: GitHubService;
  private readonly aiService: AIService;
  private readonly batchProcessor: BatchProcessor;
  private readonly excludePatterns: string[];

  private readonly enableConversationContext: boolean;
  private readonly skipDraftPrs: boolean;

  constructor(
    githubToken: string,
    geminiApiKey: string,
    excludePatterns: string[] = [],
    model?: string,
    enableConversationContext: boolean = true,
    skipDraftPrs: boolean = true
  ) {
    this.githubService = new GitHubService(githubToken);
    this.aiService = new AIService(geminiApiKey, model);
    this.batchProcessor = new BatchProcessor();
    this.excludePatterns = excludePatterns;
    this.enableConversationContext = enableConversationContext;
    this.skipDraftPrs = skipDraftPrs;
  }

  public async processCodeReview(): Promise<void> {
    try {
      const prDetails = this.githubService.getPullRequestDetails();
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (eventName !== "pull_request") {
        logger.warn(`Unsupported event: ${eventName}`);
        return;
      }

      // Check if PR is draft and should be skipped
      if (this.skipDraftPrs && this.githubService.isPullRequestDraft()) {
        logger.info(
          "Pull request is a draft and skip_draft_prs is enabled, skipping review"
        );
        return;
      }

      // Retrieve conversation context for continuing the discussion (if enabled)
      let conversationContext: ConversationContext | undefined;

      if (this.enableConversationContext) {
        conversationContext = await this.githubService.getConversationContext(
          prDetails.owner,
          prDetails.repo,
          prDetails.pullNumber
        );

        logContextStats(conversationContext);
      } else {
        logger.info("Conversation context is disabled");
      }

      const diff = await this.githubService.getPullRequestDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pullNumber
      );
      if (!diff) {
        logger.warn("No diff found for this pull request");
        return;
      }

      const parsedDiff = parseDiffToFileData(diff);
      const filteredDiff = this.filterFilesByExcludePatterns(parsedDiff);

      logger.info(
        `Files to analyze after filtering: ${filteredDiff
          .map((f) => f.path)
          .join(", ")}`
      );

      const comments = await this.analyzeCodeChanges(
        filteredDiff,
        prDetails,
        conversationContext
      );

      if (comments.length > 0) {
        await this.githubService.createReviewComments(
          prDetails.owner,
          prDetails.repo,
          prDetails.pullNumber,
          comments
        );
        logger.success(`Created ${comments.length} review comments`);

        // Save conversation context for future runs (if enabled)
        if (this.enableConversationContext && conversationContext) {
          const contextSummary = createContextSummary(
            conversationContext,
            `Generated ${comments.length} new comment${
              comments.length > 1 ? "s" : ""
            } on the latest changes`
          );

          const totalReviews = conversationContext.previousReviews.length + 1; // +1 for current review

          await this.githubService.saveConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber,
            contextSummary,
            totalReviews
          );
        }
      } else {
        logger.info("No review comments generated");

        // Still save context if this is a follow-up review (if enabled)
        if (
          this.enableConversationContext &&
          conversationContext &&
          (conversationContext.previousReviews.length > 0 ||
            conversationContext.previousComments.length > 0)
        ) {
          const contextSummary = createContextSummary(
            conversationContext,
            "No new issues found in the latest changes"
          );

          const totalReviews = conversationContext.previousReviews.length + 1; // +1 for current review

          await this.githubService.saveConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber,
            contextSummary,
            totalReviews
          );
        }
      }
    } catch (error) {
      logger.error("Error in code review process:", error);
      throw error;
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
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    logger.processing(`Starting analysis of ${files.length} files`);

    // Decide whether to use batch processing or individual file processing
    if (this.batchProcessor.shouldUseBatching(files)) {
      return this.analyzeBatchMode(files, prDetails, conversationContext);
    } else {
      return this.analyzeIndividualMode(files, prDetails, conversationContext);
    }
  }

  private async analyzeBatchMode(
    files: FileData[],
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    logger.info("Using batch processing mode for performance optimization");

    const batches = this.batchProcessor.createBatches(files);
    const allComments: ReviewComment[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.processing(
        `Processing batch ${i + 1}/${batches.length} (${
          batch.files.length
        } files)`
      );

      try {
        const aiResponses = await this.aiService.reviewBatch(
          batch,
          prDetails,
          conversationContext
        );
        const comments = this.batchProcessor.createCommentsFromBatchResponse(
          batch,
          aiResponses
        );
        allComments.push(...comments);

        logger.info(`Batch ${i + 1} generated ${comments.length} comments`);
      } catch (error) {
        logger.error(`Error processing batch ${i + 1}:`, error);

        // Fallback: try individual file processing for this batch
        logger.info(`Falling back to individual processing for batch ${i + 1}`);
        const fallbackComments = await this.processBatchFilesIndividually(
          batch.files.map((f) => ({ path: f.path, hunks: f.originalHunks })),
          prDetails,
          conversationContext
        );
        allComments.push(...fallbackComments);
      }
    }

    logger.success(
      `Batch processing generated ${allComments.length} total comments`
    );
    return allComments;
  }

  private async analyzeIndividualMode(
    files: FileData[],
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    logger.info("Using individual file processing mode");
    return this.processBatchFilesIndividually(
      files,
      prDetails,
      conversationContext
    );
  }

  private async processBatchFilesIndividually(
    files: FileData[],
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
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

        try {
          const hunkContent = hunk.lines.join("\n");
          const aiResponses = await this.aiService.reviewSingle(
            file.path,
            hunkContent,
            prDetails,
            conversationContext
          );
          const comments = createCommentsFromAiResponses(
            file.path,
            hunk,
            aiResponses
          );
          allComments.push(...comments);
        } catch (error) {
          logger.error(`Error processing hunk ${hunkCount}:`, error);
        }
      }
    }

    logger.success(
      `Individual processing generated ${allComments.length} comments`
    );
    return allComments;
  }
}

async function main(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const excludeInput = process.env.INPUT_EXCLUDE || "";
    const model = process.env.INPUT_MODEL || "gemini-2.5-pro";
    const enableConversationContext =
      (
        process.env.INPUT_ENABLE_CONVERSATION_CONTEXT || "true"
      ).toLowerCase() === "true";
    const skipDraftPrs =
      (process.env.INPUT_SKIP_DRAFT_PRS || "true").toLowerCase() === "true";

    if (!githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    const excludePatterns = parseExcludePatterns(excludeInput);
    logger.verbose(
      `🚀 Starting Code Review Action (@v${
        pkg.version
      }) with model: ${model}, conversation context: ${
        enableConversationContext ? "enabled" : "disabled"
      }, skip draft PRs: ${
        skipDraftPrs ? "enabled" : "disabled"
      }, exclude patterns: ${excludePatterns.join(", ")}`
    );

    const codeReviewService = new CodeReviewService(
      githubToken,
      geminiApiKey,
      excludePatterns,
      model,
      enableConversationContext,
      skipDraftPrs
    );
    await codeReviewService.processCodeReview();

    logger.success("✨ Code Review completed successfully!");
  } catch (error) {
    logger.error("💥 Error in main:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
