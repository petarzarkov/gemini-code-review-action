import { ConversationContext } from "../types/code-review";
import { logger } from "./logger";

/**
 * Creates a summarized conversation context string from the full context object.
 * This is used to provide context to the AI without overwhelming it with too much information.
 */
export function summarizeConversationContext(
  context: ConversationContext
): string {
  const parts: string[] = [];

  // Add summary of previous reviews
  if (context.previousReviews.length > 0) {
    const reviewSummary = context.previousReviews
      .slice(-3) // Only include last 3 reviews to avoid token limit
      .map((review, index) => {
        const date = new Date(review.createdAt).toLocaleDateString();
        const cleanBody = review.body
          .replace(/<!--.*?-->/gs, "") // Remove HTML comments
          .replace(/\[.*?\]/g, "") // Remove markdown links
          .trim();

        const firstLine = cleanBody.split("\n")[0] || cleanBody;
        const preview =
          firstLine.length > 100
            ? firstLine.substring(0, 100) + "..."
            : firstLine;

        return `  ${index + 1}. Review from ${date}: ${preview}`;
      })
      .join("\n");

    parts.push(
      `**Previous Reviews (${context.previousReviews.length} total, showing latest):**\n${reviewSummary}`
    );
  }

  // Add summary of key comments
  if (context.previousComments.length > 0) {
    const uniqueFiles = new Set(context.previousComments.map((c) => c.path));
    const commentsByFile = new Map<string, typeof context.previousComments>();

    context.previousComments.forEach((comment) => {
      if (!commentsByFile.has(comment.path)) {
        commentsByFile.set(comment.path, []);
      }
      commentsByFile.get(comment.path)!.push(comment);
    });

    const fileSummaries = Array.from(commentsByFile.entries())
      .slice(-5) // Limit to 5 most recent files
      .map(([filePath, comments]) => {
        const recentComments = comments
          .slice(-2) // Last 2 comments per file
          .map((comment) => {
            const preview =
              comment.body.length > 80
                ? comment.body.substring(0, 80) + "..."
                : comment.body;
            return `    - Line ${comment.line}: ${preview}`;
          })
          .join("\n");

        return `  **${filePath}** (${comments.length} comment${
          comments.length > 1 ? "s" : ""
        }):\n${recentComments}`;
      })
      .join("\n\n");

    parts.push(
      `**Previous Comments on Code (${context.previousComments.length} total across ${uniqueFiles.size} files):**\n${fileSummaries}`
    );
  }

  // Add conversation history summary
  if (context.conversationHistory.length > 0) {
    const historyPreview = context.conversationHistory
      .slice(-2) // Last 2 conversation entries
      .map((entry, index) => {
        const date = new Date(entry.createdAt).toLocaleDateString();
        const cleanBody = entry.body
          .replace(/<!--.*?-->/gs, "") // Remove HTML comments
          .replace(/###.*$/gm, "") // Remove headers
          .replace(/---.*$/gm, "") // Remove separators
          .replace(/\*This comment.*$/gm, "") // Remove footer text
          .trim();

        const preview =
          cleanBody.length > 150
            ? cleanBody.substring(0, 150) + "..."
            : cleanBody;

        return `  ${index + 1}. ${date}: ${preview}`;
      })
      .join("\n");

    parts.push(
      `**Conversation History (${context.conversationHistory.length} entries, showing latest):**\n${historyPreview}`
    );
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n\n");
}

/**
 * Creates a context summary for saving to GitHub comments.
 * This provides a human-readable summary of the conversation state.
 */
export function createContextSummary(
  context: ConversationContext,
  currentReviewSummary: string
): string {
  const parts: string[] = [];

  if (context.previousReviews.length > 0) {
    parts.push(
      `📋 **Review History**: ${
        context.previousReviews.length
      } previous review${context.previousReviews.length > 1 ? "s" : ""}`
    );
  }

  if (context.previousComments.length > 0) {
    const uniqueFiles = new Set(context.previousComments.map((c) => c.path));
    parts.push(
      `💬 **Comments**: ${context.previousComments.length} comment${
        context.previousComments.length > 1 ? "s" : ""
      } across ${uniqueFiles.size} file${uniqueFiles.size > 1 ? "s" : ""}`
    );
  }

  if (currentReviewSummary) {
    parts.push(`🔍 **Latest Review**: ${currentReviewSummary}`);
  }

  const lastActivity = getLastActivityDate(context);
  if (lastActivity) {
    parts.push(`🕒 **Last Activity**: ${lastActivity.toLocaleDateString()}`);
  }

  return parts.join("\n");
}

/**
 * Determines if context should be included based on the age and amount of previous activity.
 */
export function shouldIncludeContext(context: ConversationContext): boolean {
  const totalActivity =
    context.previousReviews.length +
    context.previousComments.length +
    context.conversationHistory.length;

  if (totalActivity === 0) {
    return false;
  }

  // Always include context if there's recent activity
  const lastActivity = getLastActivityDate(context);
  if (lastActivity) {
    const daysSinceLastActivity =
      (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

    // Include context if last activity was within 30 days
    if (daysSinceLastActivity <= 30) {
      return true;
    }

    // For older activity, only include if there's substantial history
    return totalActivity >= 5;
  }

  return totalActivity >= 3;
}

/**
 * Gets the date of the most recent activity in the conversation context.
 */
function getLastActivityDate(context: ConversationContext): Date | null {
  const dates: Date[] = [];

  context.previousReviews.forEach((review) => {
    dates.push(new Date(review.updatedAt || review.createdAt));
  });

  context.previousComments.forEach((comment) => {
    dates.push(new Date(comment.updatedAt || comment.createdAt));
  });

  context.conversationHistory.forEach((entry) => {
    dates.push(new Date(entry.createdAt));
  });

  if (dates.length === 0) {
    return null;
  }

  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/**
 * Logs conversation context statistics for debugging.
 */
export function logContextStats(context: ConversationContext): void {
  const stats = {
    reviews: context.previousReviews.length,
    comments: context.previousComments.length,
    conversations: context.conversationHistory.length,
    shouldInclude: shouldIncludeContext(context),
    lastActivity: getLastActivityDate(context)?.toISOString() || "none",
  };

  logger.info(`Conversation context stats: ${JSON.stringify(stats)}`);
}
