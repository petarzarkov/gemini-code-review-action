import { AIService } from "./ai-service";
import { BatchProcessor } from "./batch-processor";
import { PullRequestDetails, ReviewComment } from "../types/github";
import { FileData } from "../types/diff";
import { ConversationContext } from "../types/conversation";
import { createCommentsFromAiResponses } from "../utils/helpers";
import { logger } from "../utils/logger";

/**
 * Service for analyzing code changes and generating review comments
 */
export class CodeAnalysisService {
  private readonly aiService: AIService;
  private readonly batchProcessor: BatchProcessor;

  constructor(aiService: AIService, batchProcessor: BatchProcessor) {
    this.aiService = aiService;
    this.batchProcessor = batchProcessor;
  }

  public async analyzeCodeChanges(
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

        // Check if we got empty responses (likely due to AI service failures)
        if (aiResponses.length === 0 && batch.files.length > 0) {
          logger.warn(
            `Batch ${
              i + 1
            } returned no AI responses, falling back to individual processing`
          );
          const fallbackComments = await this.processFilesIndividually(
            batch.files.map((f) => ({ path: f.path, hunks: f.originalHunks })),
            prDetails,
            conversationContext
          );
          allComments.push(...fallbackComments);
          logger.info(
            `Batch ${i + 1} fallback generated ${
              fallbackComments.length
            } comments`
          );
        } else {
          allComments.push(...comments);
          logger.info(`Batch ${i + 1} generated ${comments.length} comments`);
        }
      } catch (error) {
        logger.error(`Error processing batch ${i + 1}:`, error);

        // Fallback: try individual file processing for this batch
        logger.info(`Falling back to individual processing for batch ${i + 1}`);
        const fallbackComments = await this.processFilesIndividually(
          batch.files.map((f) => ({ path: f.path, hunks: f.originalHunks })),
          prDetails,
          conversationContext
        );
        allComments.push(...fallbackComments);
        logger.info(
          `Batch ${i + 1} fallback generated ${
            fallbackComments.length
          } comments`
        );
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
    return this.processFilesIndividually(files, prDetails, conversationContext);
  }

  public async processFilesIndividually(
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
