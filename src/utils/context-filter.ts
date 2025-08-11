import {
  ConversationContext,
  ResolvedCommentInfo,
} from "../types/conversation";
import { FileData, HunkData } from "../types/diff";
import { logger } from "./logger";

/**
 * Determines if context should be included based on its relevance and size
 */
export function shouldIncludeContext(context: ConversationContext): boolean {
  const totalItems =
    context.previousReviews.length +
    context.previousComments.length +
    context.conversationHistory.length +
    context.commits.length;

  // Include context if there's meaningful previous interaction
  if (totalItems > 0) {
    // Calculate estimated context size
    const estimatedSize = estimateContextSize(context);

    // Don't include if context is too large (>2000 characters)
    if (estimatedSize > 2000) {
      logger.debug(
        `Context too large (${estimatedSize} chars), including summarized version`
      );
      return true; // We'll use summarized version
    }

    return true;
  }

  return false;
}

/**
 * Estimates the size of context in characters for token management
 */
function estimateContextSize(context: ConversationContext): number {
  let size = 0;

  // Reviews
  size += context.previousReviews.reduce(
    (acc, review) => acc + (review.body?.length || 0) + 50, // +50 for metadata
    0
  );

  // Comments
  size += context.previousComments.reduce(
    (acc, comment) => acc + (comment.body?.length || 0) + 30, // +30 for metadata
    0
  );

  // Conversation history
  size += context.conversationHistory.reduce(
    (acc, comment) => acc + (comment.body?.length || 0) + 30,
    0
  );

  // Commits (smaller impact)
  size += context.commits.reduce(
    (acc, commit) => acc + commit.commit.message.length + 20,
    0
  );

  return size;
}

/**
 * Filters out code sections that have been resolved based on previous comments
 */
export function filterResolvedCodeSections(
  files: FileData[],
  resolvedComments: ResolvedCommentInfo[]
): FileData[] {
  if (resolvedComments.length === 0) {
    return files;
  }

  logger.debug(
    `Filtering ${files.length} files against ${resolvedComments.length} resolved comments`
  );

  return files
    .map((file) => {
      const resolvedForFile = resolvedComments.filter(
        (resolved) => resolved.path === file.path
      );

      if (resolvedForFile.length === 0) {
        return file;
      }

      const filteredHunks = file.hunks.filter((hunk) =>
        shouldKeepHunk(hunk, resolvedForFile)
      );

      return {
        ...file,
        hunks: filteredHunks,
      };
    })
    .filter((file) => file.hunks.length > 0); // Remove files with no hunks
}

/**
 * Determines if a hunk should be kept based on resolved comments
 */
function shouldKeepHunk(
  hunk: HunkData,
  resolvedComments: ResolvedCommentInfo[]
): boolean {
  const hunkLines = extractLineNumbers(hunk.header);

  return !resolvedComments.some((resolved) => {
    // If no line number in resolved comment, can't filter
    if (!resolved.line) {
      return false;
    }

    // Check if resolved comment line overlaps with this hunk
    return resolved.line >= hunkLines.start && resolved.line <= hunkLines.end;
  });
}

/**
 * Extracts line numbers from hunk header
 */
function extractLineNumbers(header: string): { start: number; end: number } {
  // Parse hunk header like "@@ -1,7 +1,8 @@"
  const match = header.match(/@@ -\d+,?\d* \+(\d+),?(\d*) @@/);
  if (!match) {
    return { start: 0, end: 0 };
  }

  const start = parseInt(match[1], 10);
  const count = match[2] ? parseInt(match[2], 10) : 1;
  const end = start + count - 1;

  return { start, end };
}
