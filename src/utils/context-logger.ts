import { ConversationContext } from "../types/conversation";
import { logger } from "./logger";

/**
 * Logs statistics about the conversation context for debugging
 */
export function logContextStats(context: ConversationContext): void {
  const stats = {
    reviews: context.previousReviews.length,
    comments: context.previousComments.length,
    conversations: context.conversationHistory.length,
    commits: context.commits.length,
    resolved: context.resolvedComments.length,
  };

  logger.debug(
    `Context stats: ${stats.reviews} reviews, ${stats.comments} comments, ` +
      `${stats.conversations} conversations, ${stats.commits} commits, ` +
      `${stats.resolved} resolved`
  );

  if (stats.resolved > 0) {
    const resolvedFiles = [
      ...new Set(context.resolvedComments.map((c) => c.path)),
    ];
    logger.info(
      `Found ${stats.resolved} resolved comments across ${resolvedFiles.length} files`
    );
  }
}
