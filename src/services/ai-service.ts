import { GoogleGenAI } from "@google/genai";
import {
  PullRequestDetails,
  FileData,
  AiReviewResponse,
  AiResponseData,
  BatchReviewRequest,
  BatchAiResponseData,
  ConversationContext,
} from "../types/code-review";
import { logger } from "../utils/logger";
import {
  createSingleReviewPrompt,
  createBatchReviewPrompt,
} from "../config/prompts";
import {
  summarizeConversationContext,
  shouldIncludeContext,
} from "../utils/conversation-context";

export class AIService {
  private readonly genAi: GoogleGenAI;
  private currentModelName: string;
  private readonly rpmLimits: Record<string, number>;
  private readonly modelHierarchy: string[];
  private lastRequestTime: number = 0;
  private rateLimitDelay: number = 0;

  constructor(geminiApiKey: string, model?: string) {
    this.genAi = new GoogleGenAI({ apiKey: geminiApiKey });
    this.currentModelName =
      model || process.env.GEMINI_MODEL || "gemini-2.5-pro";

    this.rpmLimits = {
      "gemini-2.5-pro": 5,
      "gemini-2.5-flash": 10,
      "gemini-2.5-flash-lite": 15,
      "gemini-2.0-flash": 15,
      "gemini-2.0-flash-lite": 30,
    };

    this.modelHierarchy = Object.keys(this.rpmLimits).sort(
      (a, b) => this.rpmLimits[b] - this.rpmLimits[a]
    );

    this.updateRateLimitDelay();

    logger.info(
      `AI Service initialized with model: ${this.currentModelName} (${
        this.rpmLimits[this.currentModelName] || 5
      } RPM, ${this.rateLimitDelay}ms delay)`
    );
  }

  private updateRateLimitDelay(): void {
    const rpm = this.rpmLimits[this.currentModelName] || 5;
    this.rateLimitDelay = Math.ceil(60000 / rpm);
  }

  private getNextLowerModel(): string | null {
    const currentIndex = this.modelHierarchy.indexOf(this.currentModelName);

    if (
      currentIndex === -1 ||
      currentIndex === this.modelHierarchy.length - 1
    ) {
      return null;
    }

    return this.modelHierarchy[currentIndex + 1];
  }

  private derankModel(): boolean {
    const nextModel = this.getNextLowerModel();

    if (!nextModel) {
      logger.warn(
        `Already using the lowest model (${this.currentModelName}), cannot derank further`
      );
      return false;
    }

    const oldModel = this.currentModelName;
    this.currentModelName = nextModel;
    this.updateRateLimitDelay();

    logger.warn(
      `Deranked from ${oldModel} to ${this.currentModelName} due to rate limits`
    );
    logger.info(
      `New rate limit: ${this.rpmLimits[this.currentModelName]} RPM (${
        this.rateLimitDelay
      }ms delay)`
    );

    return true;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms before next request`);

      for (let remaining = waitTime; remaining > 0; remaining -= 1000) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1000, remaining))
        );
        if (remaining > 1000)
          logger.debug(`Rate limiting: ${remaining - 1000}ms remaining`);
      }
    }

    this.lastRequestTime = Date.now();
  }

  public async reviewBatch(
    batch: BatchReviewRequest,
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<AiReviewResponse[]> {
    const prompt = this.createBatchReviewPrompt(
      batch,
      prDetails,
      conversationContext
    );
    const aiResponses = await this.getAiResponse(prompt, true);
    return aiResponses;
  }

  public async reviewSingle(
    filePath: string,
    hunkContent: string,
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<AiReviewResponse[]> {
    const prompt = this.createSingleReviewPrompt(
      filePath,
      hunkContent,
      prDetails,
      conversationContext
    );
    const aiResponses = await this.getAiResponse(prompt, false);
    return aiResponses;
  }

  private createBatchReviewPrompt(
    batch: BatchReviewRequest,
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): string {
    const filesContent = batch.files
      .map(
        (file, index) =>
          `File ${index + 1}: ${file.path}\n\`\`\`diff\n${file.content}\n\`\`\``
      )
      .join("\n\n");

    const contextString =
      conversationContext && shouldIncludeContext(conversationContext)
        ? summarizeConversationContext(conversationContext)
        : undefined;

    return createBatchReviewPrompt({
      title: prDetails.title,
      description: prDetails.description || "No description provided",
      filesContent,
      fileCount: batch.files.length,
      conversationContext: contextString,
    });
  }

  private createSingleReviewPrompt(
    filePath: string,
    hunkContent: string,
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): string {
    const contextString =
      conversationContext && shouldIncludeContext(conversationContext)
        ? summarizeConversationContext(conversationContext)
        : undefined;

    return createSingleReviewPrompt({
      filePath,
      title: prDetails.title,
      description: prDetails.description || "No description provided",
      hunkContent,
      conversationContext: contextString,
    });
  }

  private async getAiResponse(
    prompt: string,
    isBatch: boolean,
    retryCount = 0
  ): Promise<AiReviewResponse[]> {
    const maxRetries = 3;

    try {
      await this.enforceRateLimit();

      const generationConfig = {
        maxOutputTokens: isBatch ? 16384 : 8192, // Increase token limit for batch requests
        temperature: 0.8,
        topP: 0.95,
      };

      logger.processing(
        `Sending ${
          isBatch ? "batch" : "single"
        } prompt to Gemini AI... (attempt ${retryCount + 1})`
      );

      const result = await this.genAi.models.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        model: this.currentModelName,
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

      const data = JSON.parse(responseText) as
        | AiResponseData
        | BatchAiResponseData;

      if (data.reviews && Array.isArray(data.reviews)) {
        return data.reviews.filter(
          (review) => review.lineContent && review.reviewComment
        );
      }

      logger.warn("Invalid response format from AI");
      return [];
    } catch (error) {
      logger.error(
        `Error calling Gemini AI (attempt ${retryCount + 1}):`,
        error
      );

      // Check if it's a rate limit error and retry with exponential backoff or deranking
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 429
      ) {
        if (retryCount < maxRetries) {
          // Try deranking to a lower model first
          if (retryCount === 0 && this.derankModel()) {
            logger.info(
              `Retrying with deranked model: ${this.currentModelName}`
            );
            return this.getAiResponse(prompt, isBatch, retryCount + 1);
          }

          // Fall back to exponential backoff if deranking not possible or already tried
          const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          logger.warn(
            `Rate limit exceeded. Retrying in ${backoffDelay}ms... (${
              retryCount + 1
            }/${maxRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          return this.getAiResponse(prompt, isBatch, retryCount + 1);
        } else {
          logger.error("Max retries exceeded. Skipping this request.");
        }
      }

      return [];
    }
  }
}
