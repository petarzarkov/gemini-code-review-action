import {
  ConversationContext,
  ResolvedCommentInfo,
} from "../types/conversation";

/**
 * Creates a summarized conversation context string from the full context object.
 * This is used to provide context to the AI without overwhelming it with too much information.
 */
export function summarizeConversationContext(
  context: ConversationContext
): string {
  const parts: string[] = [];

  // Context is now pre-limited at source, so we can be less aggressive
  const reviewLimit = Math.min(context.previousReviews.length, 2);
  const fileLimit = 3;

  // Add summary of previous reviews
  if (context.previousReviews.length > 0) {
    const reviewSummary = context.previousReviews
      .slice(-reviewLimit) // Dynamic limit based on context size
      .map((review, index) => {
        const date = new Date(
          review.submitted_at || new Date().toISOString()
        ).toLocaleDateString();
        const cleanBody = review.body
          .replace(/<!--.*?-->/gs, "") // Remove HTML comments
          .replace(/\[.*?\]/g, "") // Remove markdown links
          .trim();

        const firstLine = cleanBody.split("\n")[0] || cleanBody;
        const preview =
          firstLine.length > 80
            ? firstLine.substring(0, 80) + "..."
            : firstLine;

        return `  ${index + 1}. Review from ${date}: ${preview}`;
      })
      .join("\n");

    parts.push(
      `**Previous Reviews (${context.previousReviews.length} total, showing latest):**\n${reviewSummary}`
    );
  }

  // Add summary of key comments (trim for AI consumption while keeping full context available)
  if (context.previousComments.length > 0) {
    const commentsByFile = new Map<string, typeof context.previousComments>();

    context.previousComments.forEach((comment) => {
      if (!commentsByFile.has(comment.path)) {
        commentsByFile.set(comment.path, []);
      }
      commentsByFile.get(comment.path)!.push(comment);
    });

    const fileSummaries = Array.from(commentsByFile.entries())
      .slice(-fileLimit) // Dynamic limit based on context size
      .map(([filePath, comments]) => {
        const recentComments = comments
          .slice(-1) // Most recent 1 comment per file for AI consumption
          .map((comment) => {
            const body = comment.body || "";
            const cleanBody = body
              .replace(/<!--.*?-->/gs, "")
              .replace(/\[.*?\]/g, "")
              .trim();
            const firstLine = cleanBody.split("\n")[0] || cleanBody;
            const preview =
              firstLine.length > 60
                ? firstLine.substring(0, 60) + "..."
                : firstLine;
            return `    - Line ${comment.line || "?"}: ${preview}`;
          })
          .join("\n");

        return `  **${filePath}** (${comments.length} comments):\n${recentComments}`;
      })
      .join("\n\n");

    parts.push(
      `**Previous Comments (${context.previousComments.length} total, showing recent):**\n${fileSummaries}`
    );
  }

  // Add resolved comments summary
  if (context.resolvedComments.length > 0) {
    const resolvedSummary = createResolvedCommentsSummary(
      context.resolvedComments
    );
    parts.push(resolvedSummary);
  }

  // Add conversation history
  if (context.conversationHistory.length > 0) {
    const conversationSummary = context.conversationHistory
      .slice(-3) // Show last 3 conversation entries
      .map((comment, index) => {
        const date = new Date(comment.created_at).toLocaleDateString();
        const body = comment.body || "";
        const cleanBody = body
          .replace(/<!--.*?-->/gs, "")
          .replace(/#{1,6}\s*/g, "") // Remove markdown headers
          .trim();

        const firstLine = cleanBody.split("\n")[0] || cleanBody;
        const preview =
          firstLine.length > 120
            ? firstLine.substring(0, 120) + "..."
            : firstLine;

        return `  ${index + 1}. ${date}: ${preview}`;
      })
      .join("\n");

    parts.push(
      `**Conversation Updates (${context.conversationHistory.length} total):**\n${conversationSummary}`
    );
  }

  // Add commit information
  if (context.commits.length > 0) {
    const recentCommits = context.commits
      .slice(-3) // Show last 3 commits
      .map((commit, index) => {
        const message = commit.commit.message.split("\n")[0]; // First line only
        const shortSha = commit.sha.substring(0, 7);
        const preview =
          message.length > 60 ? message.substring(0, 60) + "..." : message;
        return `  ${index + 1}. ${shortSha}: ${preview}`;
      })
      .join("\n");

    parts.push(
      `**Recent Commits (${context.commits.length} total):**\n${recentCommits}`
    );
  }

  return parts.length > 0
    ? parts.join("\n\n")
    : "No previous context available.";
}

/**
 * Creates a comprehensive context summary for saving in GitHub comments
 */
export function createContextSummary(
  context: ConversationContext,
  additionalInfo?: string
): string {
  const sections: string[] = [];

  // Review summary
  if (context.previousReviews.length > 0) {
    sections.push(
      `📝 **Reviews**: ${context.previousReviews.length} previous review${
        context.previousReviews.length > 1 ? "s" : ""
      }`
    );
  }

  // Comments summary
  if (context.previousComments.length > 0) {
    const uniqueFiles = [
      ...new Set(context.previousComments.map((c) => c.path)),
    ];
    sections.push(
      `💬 **Comments**: ${context.previousComments.length} comment${
        context.previousComments.length > 1 ? "s" : ""
      } across ${uniqueFiles.length} file${uniqueFiles.length > 1 ? "s" : ""}`
    );
  }

  // Resolved comments summary
  if (context.resolvedComments.length > 0) {
    const resolvedFiles = [
      ...new Set(context.resolvedComments.map((c) => c.path)),
    ];
    sections.push(
      `✅ **Resolved**: ${context.resolvedComments.length} issue${
        context.resolvedComments.length > 1 ? "s" : ""
      } resolved across ${resolvedFiles.length} file${
        resolvedFiles.length > 1 ? "s" : ""
      }`
    );
  }

  // Commits summary
  if (context.commits.length > 0) {
    sections.push(
      `🔄 **Commits**: ${context.commits.length} commit${
        context.commits.length > 1 ? "s" : ""
      } in this PR`
    );
  }

  // Conversation history
  if (context.conversationHistory.length > 0) {
    sections.push(
      `💭 **Discussion**: ${
        context.conversationHistory.length
      } conversation update${context.conversationHistory.length > 1 ? "s" : ""}`
    );
  }

  let summary = sections.length > 0 ? sections.join(", ") : "No prior context";

  if (additionalInfo) {
    summary += `\n\n**Latest Update**: ${additionalInfo}`;
  }

  return summary;
}

/**
 * Creates a summary of resolved comments for display
 */
export function createResolvedCommentsSummary(
  resolvedComments: ResolvedCommentInfo[]
): string {
  if (resolvedComments.length === 0) {
    return "";
  }

  const resolvedByFile = new Map<string, ResolvedCommentInfo[]>();
  resolvedComments.forEach((comment) => {
    if (!resolvedByFile.has(comment.path)) {
      resolvedByFile.set(comment.path, []);
    }
    resolvedByFile.get(comment.path)!.push(comment);
  });

  const fileSummaries = Array.from(resolvedByFile.entries())
    .slice(-3) // Show last 3 files with resolutions
    .map(([filePath, comments]) => {
      const resolvers = [...new Set(comments.map((c) => c.resolvedBy))];
      return `  **${filePath}**: ${comments.length} issue${
        comments.length > 1 ? "s" : ""
      } resolved by ${resolvers.join(", ")}`;
    })
    .join("\n");

  return `**Resolved Issues (${resolvedComments.length} total):**\n${fileSummaries}`;
}
