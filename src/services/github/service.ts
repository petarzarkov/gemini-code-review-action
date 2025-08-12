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
import { GitHubFileContentService } from "./file-content-service";
import { logger } from "../../utils/logger";
import pkg from "../../../package.json";

export class GitHubService {
  private readonly octokit: Octokit;
  private readonly eventService: GitHubEventService;
  private readonly diffService: GitHubDiffService;
  private readonly reviewService: GitHubReviewService;
  private readonly graphqlService: GitHubGraphQLService;
  private readonly fileContentService: GitHubFileContentService;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
    this.eventService = new GitHubEventService();
    this.diffService = new GitHubDiffService(this.octokit);
    this.reviewService = new GitHubReviewService(this.octokit);
    this.graphqlService = new GitHubGraphQLService(this.octokit, githubToken);
    this.fileContentService = new GitHubFileContentService(this.octokit);
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
    return this.getFullConversationContext(owner, repo, pullNumber);
  }

  async getFullConversationContext(
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
        previousReviews: actionReviews, // Keep all reviews for full context
        previousComments: actionComments, // Keep all comments for full context
        conversationHistory: actionIssueComments, // Keep all conversations for full context
        commits: commits, // Keep all commits for full context
        resolvedComments: resolvedComments, // Keep all resolved comments for filtering
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

  async getLimitedConversationContext(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<ConversationContext> {
    try {
      logger.processing(
        `Retrieving limited conversation context for PR #${pullNumber}`
      );

      // Get commits for the PR
      const commits = await this.getPullRequestCommits(owner, repo, pullNumber);

      // Get all reviews and comments for the PR
      const reviews = await this.octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: pullNumber,
      });

      const comments = await this.octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pullNumber,
      });

      // Filter to only include bot reviews and comments
      const actionReviews = reviews.data.filter(
        (review) =>
          review.state === "COMMENTED" &&
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

      // Apply limits for AI consumption
      const maxReviews = 2;
      const maxComments = 15;
      const maxConversations = 2;
      const maxCommits = 10;

      const context: ConversationContext = {
        previousReviews: actionReviews.slice(-maxReviews), // Limited for AI
        previousComments: actionComments.slice(-maxComments), // Limited for AI
        conversationHistory: actionIssueComments.slice(-maxConversations), // Limited for AI
        commits: commits.slice(-maxCommits), // Limited for AI
        resolvedComments: resolvedComments, // Keep all resolved comments for filtering
      };

      logger.info(
        `Retrieved limited context: ${context.previousReviews.length} reviews, ` +
          `${context.previousComments.length} comments, ` +
          `${context.conversationHistory.length} conversation entries, ` +
          `${context.commits.length} commits`
      );

      return context;
    } catch (error) {
      logger.error("Error retrieving limited conversation context:", error);
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

  public async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null> {
    const fileContent = await this.fileContentService.getFileContent(
      owner,
      repo,
      path,
      ref
    );
    return fileContent?.content || null;
  }

  public async getMultipleFileContents(
    owner: string,
    repo: string,
    filePaths: string[],
    ref: string
  ): Promise<Map<string, string>> {
    const fileContents = await this.fileContentService.getMultipleFileContents(
      owner,
      repo,
      filePaths,
      ref
    );

    const result = new Map<string, string>();
    for (const [path, content] of fileContents.entries()) {
      result.set(path, content.content);
    }
    return result;
  }
}
