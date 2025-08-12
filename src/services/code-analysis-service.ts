import { AIService } from "./ai-service";
import { BatchProcessor } from "./batch-processor";
import { PullRequestDetails, ReviewComment } from "../types/github";
import { FileData, HunkData } from "../types/diff";
import { ConversationContext } from "../types/conversation";
import {
  createCommentsFromAiResponses,
  createCommentsFromAiResponsesForMultipleHunks,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { FileContextEnrichmentService } from "./file-context-enrichment-service";

/**
 * Service for analyzing code changes and generating review comments
 */
export class CodeAnalysisService {
  private readonly aiService: AIService;
  private readonly batchProcessor: BatchProcessor;
  private readonly fileEnrichmentService?: FileContextEnrichmentService;

  constructor(
    aiService: AIService,
    batchProcessor: BatchProcessor,
    fileEnrichmentService?: FileContextEnrichmentService
  ) {
    this.aiService = aiService;
    this.batchProcessor = batchProcessor;
    this.fileEnrichmentService = fileEnrichmentService;
  }

  public async analyzeCodeChanges(
    files: FileData[],
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext,
    limitedConversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    logger.processing(`Starting analysis of ${files.length} files`);

    // Enrich files with full context if service is available
    let enrichedFiles = files;
    if (this.fileEnrichmentService) {
      enrichedFiles = await this.fileEnrichmentService.enrichFilesWithContext(
        files,
        prDetails
      );
    }

    // Use limited context for AI consumption, full context for filtering
    const contextForAI = limitedConversationContext || conversationContext;

    // Decide whether to use batch processing or individual file processing
    if (this.batchProcessor.shouldUseBatching(enrichedFiles)) {
      return this.analyzeBatchMode(enrichedFiles, prDetails, contextForAI);
    } else {
      return this.analyzeIndividualMode(enrichedFiles, prDetails, contextForAI);
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

    logger.info(`Processing ${files.length} files individually`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      logger.processing(
        `Processing file ${i + 1}/${files.length}: ${file.path}`
      );

      if (!file.path || file.path === "/dev/null") {
        continue;
      }

      const validHunks = file.hunks.filter((hunk) => hunk.lines.length > 0);
      if (validHunks.length === 0) {
        continue;
      }

      try {
        const comments = await this.processFileWithAllHunks(
          file,
          prDetails,
          conversationContext
        );
        allComments.push(...comments);

        logger.info(`File ${file.path} generated ${comments.length} comments`);
      } catch (error) {
        logger.error(`Error processing file ${file.path}:`, error);
      }
    }

    logger.success(
      `Individual processing generated ${allComments.length} comments`
    );
    return allComments;
  }

  /**
   * Process a single file with all its hunks in one AI call to avoid sending
   * full file content multiple times
   */
  private async processFileWithAllHunks(
    file: FileData,
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    const validHunks = file.hunks.filter((hunk) => hunk.lines.length > 0);

    if (validHunks.length === 1) {
      // Single hunk - use existing single review method
      const hunkContent = validHunks[0].lines.join("\n");
      const aiResponses = await this.aiService.reviewSingle(
        file.path,
        hunkContent,
        prDetails,
        conversationContext,
        file.fullContent
      );
      return createCommentsFromAiResponses(
        file.path,
        validHunks[0],
        aiResponses
      );
    } else {
      // Multiple hunks - combine them but send full file content only once
      return this.processMultipleHunksForFile(
        file,
        validHunks,
        prDetails,
        conversationContext
      );
    }
  }

  /**
   * Process multiple hunks for a single file by combining them into one request
   */
  private async processMultipleHunksForFile(
    file: FileData,
    hunks: HunkData[],
    prDetails: PullRequestDetails,
    conversationContext?: ConversationContext
  ): Promise<ReviewComment[]> {
    // Combine all hunks into a single diff content
    const combinedHunkContent = hunks
      .map((hunk) => `${hunk.header}\n${hunk.lines.join("\n")}`)
      .join("\n\n");

    const aiResponses = await this.aiService.reviewSingle(
      file.path,
      combinedHunkContent,
      prDetails,
      conversationContext,
      file.fullContent
    );

    // Map AI responses back to individual hunks using the specialized function
    return createCommentsFromAiResponsesForMultipleHunks(
      file.path,
      hunks,
      aiResponses
    );
  }
}
