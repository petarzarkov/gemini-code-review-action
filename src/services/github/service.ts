import { Octokit } from "@octokit/rest";
import {
  PullRequestDetails,
  ReviewComment,
  CommitData,
} from "../../types/github";
import { ConversationContext } from "../../types/conversation";
import { GitHubEventService } from "./event-service";
import { GitHubDiffService } from "./diff-service";
import { GitHubReviewService } from "./review-service";
import { GitHubGraphQLService } from "./graphql-service";
import { logger } from "../../utils/logger";
import pkg from "../../../package.json";

export class GitHubService {
  private readonly octokit: Octokit;
  private readonly eventService: GitHubEventService;
  private readonly diffService: GitHubDiffService;
  private readonly reviewService: GitHubReviewService;
  private readonly graphqlService: GitHubGraphQLService;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
    this.eventService = new GitHubEventService();
    this.diffService = new GitHubDiffService(this.octokit);
    this.reviewService = new GitHubReviewService(this.octokit);
    this.graphqlService = new GitHubGraphQLService(this.octokit, githubToken);
  }

  public getPullRequestDetails(): PullRequestDetails {
    return this.eventService.getPullRequestDetails();
  }

  public isPullRequestDraft(): boolean {
    return this.eventService.isPullRequestDraft();
  }

  public async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    return this.diffService.getPullRequestDiff(owner, repo, pullNumber);
  }

  public async createReviewComments(
    owner: string,
    repo: string,
    pullNumber: number,
    comments: ReviewComment[]
  ): Promise<void> {
    return this.reviewService.createReviewComments(
      owner,
      repo,
      pullNumber,
      comments
    );
  }

  public async getPullRequestCommits(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<CommitData[]> {
    return this.diffService.getPullRequestCommits(owner, repo, pullNumber);
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

      // Get existing reviews, comments, and commits from this PR
      const [reviews, comments, commits] = await Promise.all([
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
        this.getPullRequestCommits(owner, repo, pullNumber),
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

      // Identify resolved comments using the GraphQL service
      const resolvedComments =
        await this.graphqlService.identifyResolvedComments(
          owner,
          repo,
          pullNumber,
          actionComments
        );

      const context: ConversationContext = {
        previousReviews: actionReviews,
        previousComments: actionComments,
        conversationHistory: actionIssueComments,
        commits: commits,
        resolvedComments: resolvedComments,
      };

      logger.info(
        `Retrieved context: ${context.previousReviews.length} reviews, ` +
          `${context.previousComments.length} comments, ` +
          `${context.conversationHistory.length} conversation entries, ` +
          `${context.commits.length} commits`
      );

      return context;
    } catch (error) {
      logger.error("Error retrieving conversation context:", error);
      // Return empty context on error to allow processing to continue
      return {
        previousReviews: [],
        previousComments: [],
        conversationHistory: [],
        commits: [],
        resolvedComments: [],
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
    return this.reviewService.saveConversationContext(
      owner,
      repo,
      pullNumber,
      contextSummary,
      reviewCount
    );
  }
}
