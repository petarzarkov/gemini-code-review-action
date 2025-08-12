import { ReviewComment } from "../types/github";
import { FileData, HunkData } from "../types/diff";
import {
  AiReviewResponse,
  BatchReviewRequest,
  BatchFileContent,
} from "../types/ai";
import { logger } from "../utils/logger";

export class BatchProcessor {
  private readonly maxBatchSize: number;
  private readonly maxTokensPerBatch: number;

  constructor(maxBatchSize = 10, maxTokensPerBatch = 12000) {
    this.maxBatchSize = maxBatchSize;
    this.maxTokensPerBatch = maxTokensPerBatch;
  }

  public createBatches(files: FileData[]): BatchReviewRequest[] {
    const batches: BatchReviewRequest[] = [];
    let currentBatch: BatchFileContent[] = [];
    let currentTokenCount = 0;

    logger.processing(`Creating batches from ${files.length} files`);

    for (const file of files) {
      if (!file.path || file.path === "/dev/null") {
        continue;
      }

      // Combine all hunks for this file
      const fileContent = this.combineHunksToContent(file.hunks);
      const estimatedTokens = this.estimateTokens(fileContent);

      // Check if adding this file would exceed limits
      const wouldExceedTokens =
        currentTokenCount + estimatedTokens > this.maxTokensPerBatch;
      const wouldExceedSize = currentBatch.length >= this.maxBatchSize;

      if ((wouldExceedTokens || wouldExceedSize) && currentBatch.length > 0) {
        // Create a batch with current files
        batches.push({
          files: [...currentBatch],
          totalEstimatedTokens: currentTokenCount,
        });

        // Start new batch
        currentBatch = [];
        currentTokenCount = 0;
      }

      // Add current file to batch
      currentBatch.push({
        path: file.path,
        content: fileContent,
        estimatedTokens,
        originalHunks: file.hunks,
        fullFileContent: file.fullContent,
      });
      currentTokenCount += estimatedTokens;
    }

    // Add remaining files as the last batch
    if (currentBatch.length > 0) {
      batches.push({
        files: [...currentBatch],
        totalEstimatedTokens: currentTokenCount,
      });
    }

    logger.info(`Created ${batches.length} batches from ${files.length} files`);
    batches.forEach((batch, index) => {
      logger.debug(
        `Batch ${index + 1}: ${batch.files.length} files, ~${
          batch.totalEstimatedTokens
        } tokens`
      );
    });

    return batches;
  }

  private combineHunksToContent(hunks: HunkData[]): string {
    return hunks
      .filter((hunk) => hunk.lines.length > 0)
      .map((hunk) => hunk.lines.join("\n"))
      .join("\n\n");
  }

  private estimateTokens(content: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    // This is a conservative estimate for code content
    return Math.ceil(content.length / 3.5);
  }

  public createCommentsFromBatchResponse(
    batch: BatchReviewRequest,
    aiResponses: AiReviewResponse[]
  ): ReviewComment[] {
    logger.processing(
      `Creating comments from batch response with ${aiResponses.length} AI responses`
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

        // Find which file and position this comment belongs to
        const matchResult = this.findFileAndPosition(batch, lineContent);
        if (!matchResult) {
          logger.warn(
            `AI provided lineContent that was not found in any batch file, skipping: "${lineContent}"`
          );
          continue;
        }

        const comment: ReviewComment = {
          body: reviewComment,
          path: matchResult.filePath,
          position: matchResult.position,
        };

        comments.push(comment);
        logger.debug(
          `Created comment for ${matchResult.filePath}:${
            matchResult.position
          }: ${reviewComment.substring(0, 100)}...`
        );
      } catch (error) {
        logger.error("Error creating comment from batch AI response:");
        console.error(error, aiResponse);
      }
    }

    return comments;
  }

  private findFileAndPosition(
    batch: BatchReviewRequest,
    lineContent: string
  ): { filePath: string; position: number } | null {
    const normalizedAiLine = lineContent.trim().replace(/\s+/g, " ");

    for (const file of batch.files) {
      // Search through the original hunks for this file
      for (const hunk of file.originalHunks) {
        const position =
          hunk.lines.findIndex((hunkLine) => {
            const normalizedHunkLine = hunkLine.trim().replace(/\s+/g, " ");
            return normalizedHunkLine === normalizedAiLine;
          }) + 1;

        if (position > 0) {
          return {
            filePath: file.path,
            position,
          };
        }
      }
    }

    return null;
  }

  public shouldUseBatching(files: FileData[]): boolean {
    // Use batching if we have more than 3 files or if total content is substantial
    if (files.length <= 2) {
      return false;
    }

    const totalHunks = files.reduce(
      (total, file) => total + file.hunks.length,
      0
    );
    return totalHunks > 5; // Use batching for more than 5 hunks total
  }
}
