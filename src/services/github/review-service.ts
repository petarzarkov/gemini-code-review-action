import { Octokit } from "@octokit/rest";
import { ReviewComment } from "../../types/github";
import { logger } from "../../utils/logger";
import pkg from "../../../package.json";

export class GitHubReviewService {
  private readonly octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  public async createReviewComments(
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
        body: `${pkg.name} comments`,
        comments,
        event: "COMMENT",
      });

      logger.success("Review created successfully");
    } catch (error) {
      logger.error("Error creating review:", error);
      throw error;
    }
  }

  public async saveConversationContext(
    owner: string,
    repo: string,
    pullNumber: number,
    contextSummary: string,
    reviewCount: number = 1
  ): Promise<void> {
    try {
      logger.processing("Saving conversation context summary");

      const reviewText =
        reviewCount === 1
          ? "This PR has been reviewed for the first time"
          : `This PR has been reviewed ${reviewCount} times`;

      const contextComment = `<!-- [${pkg.name}:context] -->
### 🔄 Conversation Context Updated ${new Date().toUTCString()}

${reviewText}. Here's a summary of the ongoing conversation:

${contextSummary}

---
*This comment helps maintain context across multiple review runs.*`;

      // Check if a context comment already exists
      const issueComments = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: pullNumber,
      });

      const existingContextComment = issueComments.data.find(
        (comment) =>
          comment.user?.login === "github-actions[bot]" &&
          comment.body?.includes(`<!-- [${pkg.name}:context] -->`)
      );

      if (existingContextComment) {
        // Update existing comment
        await this.octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existingContextComment.id,
          body: contextComment,
        });
        logger.success("Conversation context updated in existing comment");
      } else {
        // Create new comment
        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: contextComment,
        });
        logger.success("Conversation context saved in new comment");
      }
    } catch (error) {
      logger.error("Error saving conversation context:", error);
      // Don't throw - context saving is nice-to-have, not critical
    }
  }
}
