import fs from "node:fs";
import { Octokit } from "@octokit/rest";
import {
  PullRequestDetails,
  GitHubEventData,
  ReviewComment,
  ConversationContext,
} from "../types/code-review";
import { logger } from "../utils/logger";
import pkg from "../../package.json";

export class GitHubService {
  private readonly octokit: Octokit;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
  }

  public getPullRequestDetails(): PullRequestDetails {
    const eventData = this.getEventData();
    const repoFullName = eventData.repository.full_name;

    if (!eventData.pull_request) {
      throw new Error("No pull request data found in event");
    }

    const [owner, repo] = repoFullName.split("/");

    return {
      owner,
      repo,
      pullNumber: eventData.pull_request.number,
      title: eventData.pull_request.title,
      description: eventData.pull_request.body || "",
    };
  }

  private getEventData(): GitHubEventData {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error("GITHUB_EVENT_PATH environment variable is not set");
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return eventData as GitHubEventData;
  }

  public isPullRequestDraft(): boolean {
    const eventData = this.getEventData();
    return eventData.pull_request?.draft ?? false;
  }

  public async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    try {
      logger.processing(`Fetching diff for ${owner}/${repo} PR#${pullNumber}`);

      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: {
          format: "diff",
        },
      });

      const diff = response.data as unknown as string;
      logger.debug(`Retrieved diff length: ${diff.length}`);
      return diff;
    } catch (error) {
      logger.error("Failed to get pull request diff:", error);
      return "";
    }
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

  public async getConversationContext(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<ConversationContext> {
    try {
      logger.processing(
        `Retrieving conversation context for PR #${pullNumber}`
      );

      // Get existing reviews and comments from this action
      const [reviews, comments] = await Promise.all([
        this.octokit.pulls.listReviews({
          owner,
          repo,
          pull_number: pullNumber,
        }),
        this.octokit.pulls.listReviewComments({
          owner,
          repo,
          pull_number: pullNumber,
        }),
      ]);

      // Filter for comments made by this action
      const actionReviews = reviews.data.filter(
        (review) =>
          review.body?.includes(pkg.name) &&
          review.user?.login === "github-actions[bot]"
      );

      const actionComments = comments.data.filter(
        (comment) => comment.user?.login === "github-actions[bot]"
      );

      // Get PR conversations (issue comments)
      const issueComments = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: pullNumber,
      });

      const actionIssueComments = issueComments.data.filter(
        (comment) =>
          comment.user?.login === "github-actions[bot]" &&
          comment.body?.includes(`<!-- [${pkg.name}:context] -->`)
      );

      const context: ConversationContext = {
        previousReviews: actionReviews,
        previousComments: actionComments,
        conversationHistory: actionIssueComments,
      };

      logger.info(
        `Retrieved context: ${context.previousReviews.length} reviews, ` +
          `${context.previousComments.length} comments, ` +
          `${context.conversationHistory.length} conversation entries`
      );

      return context;
    } catch (error) {
      logger.error("Error retrieving conversation context:", error);
      // Return empty context on error to allow processing to continue
      return {
        previousReviews: [],
        previousComments: [],
        conversationHistory: [],
      };
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
### 🔄 Conversation Context Updated

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
