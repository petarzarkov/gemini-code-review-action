import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import {
  GraphQLPullRequestReviewThreads,
  GraphQLReviewThread,
} from "../../types/github";
import { ResolvedCommentInfo } from "../../types/conversation";
import { logger } from "../../utils/logger";

export class GitHubGraphQLService {
  private readonly octokit: Octokit;
  private readonly graphqlClient: typeof graphql;

  constructor(octokit: Octokit, githubToken: string) {
    this.octokit = octokit;
    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });
  }

  /**
   * Identifies resolved comments using the actual GitHub GraphQL API resolution status.
   * This is more accurate than the heuristics-based approach using REST API.
   */
  public async identifyResolvedComments(
    owner: string,
    repo: string,
    pullNumber: number,
    comments: RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"]
  ): Promise<ResolvedCommentInfo[]> {
    const resolvedComments: ResolvedCommentInfo[] = [];

    try {
      // Get review threads with actual resolution status from GraphQL
      const reviewThreads = await this.getReviewThreadsWithResolutionStatus(
        owner,
        repo,
        pullNumber
      );

      // Create a map of comment database ID to comment data for faster lookup
      const commentMap = new Map<number, (typeof comments)[0]>();
      for (const comment of comments) {
        if (comment.user?.login === "github-actions[bot]") {
          commentMap.set(comment.id, comment);
        }
      }
      logger.debug(
        `Found ${commentMap.size} bot comments to check for resolution`
      );

      // Process each resolved thread
      for (const thread of reviewThreads) {
        if (!thread.isResolved) {
          continue;
        }

        // Find ALL comments in this resolved thread (not just bot comments)
        for (const graphqlComment of thread.comments.nodes) {
          // Check if this comment exists in our bot comments map
          if (commentMap.has(graphqlComment.databaseId)) {
            const restComment = commentMap.get(graphqlComment.databaseId)!;

            resolvedComments.push({
              id: restComment.id,
              path: restComment.path,
              line: restComment.line || null,
              position: restComment.position || null,
              resolvedAt: graphqlComment.updatedAt,
              resolvedBy: thread.resolvedBy?.login || "unknown",
              originalComment: restComment.body || "",
              isResolved: true,
            });
          }
        }
      }

      logger.debug(
        `Identified ${resolvedComments.length} resolved comments using GraphQL API`
      );
      return resolvedComments;
    } catch (error) {
      logger.error("Error identifying resolved comments:", error);
      // Fallback to heuristics-based approach if GraphQL fails
      logger.warn("Falling back to heuristics-based resolution detection");
      return this.identifyResolvedCommentsUsingHeuristics(
        owner,
        repo,
        pullNumber,
        comments
      );
    }
  }

  /**
   * Fetches review threads for a pull request using GraphQL API to get actual resolution status
   */
  private async getReviewThreadsWithResolutionStatus(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<GraphQLReviewThread[]> {
    try {
      logger.debug(
        `Fetching review threads for PR #${pullNumber} using GraphQL`
      );

      const query = `
        query GetPullRequestReviewThreads($owner: String!, $repo: String!, $pullNumber: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              reviewThreads(first: 100, after: $cursor) {
                nodes {
                  id
                  isResolved
                  resolvedBy {
                    login
                  }
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      path
                      line
                      position
                      createdAt
                      updatedAt
                      author {
                        login
                      }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `;

      let allThreads: GraphQLReviewThread[] = [];
      let cursor: string | undefined;
      let hasNextPage = true;

      // Handle pagination
      while (hasNextPage) {
        const response: GraphQLPullRequestReviewThreads =
          await this.graphqlClient(query, {
            owner,
            repo,
            pullNumber,
            cursor,
          });

        const threads = response.repository.pullRequest.reviewThreads.nodes;
        allThreads = allThreads.concat(threads);

        hasNextPage =
          response.repository.pullRequest.reviewThreads.pageInfo.hasNextPage;
        cursor =
          response.repository.pullRequest.reviewThreads.pageInfo.endCursor;
      }

      logger.debug(`Retrieved ${allThreads.length} review threads via GraphQL`);
      return allThreads;
    } catch (error) {
      logger.error("Error fetching review threads via GraphQL:", error);
      return [];
    }
  }

  /**
   * Fallback method that uses heuristics to identify resolved comments
   * when GraphQL API is not available or fails
   */
  private async identifyResolvedCommentsUsingHeuristics(
    owner: string,
    repo: string,
    pullNumber: number,
    comments: RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"]
  ): Promise<ResolvedCommentInfo[]> {
    const resolvedComments: ResolvedCommentInfo[] = [];

    try {
      for (const comment of comments) {
        if (!comment.user || comment.user.login !== "github-actions[bot]") {
          continue;
        }

        // Check for resolution indicators using heuristics
        const isResolved =
          await this.checkCommentResolutionStatusUsingHeuristics(
            owner,
            repo,
            pullNumber,
            comment
          );

        if (isResolved.resolved) {
          resolvedComments.push({
            id: comment.id,
            path: comment.path,
            line: comment.line || null,
            position: comment.position || null,
            resolvedAt: isResolved.resolvedAt || comment.updated_at,
            resolvedBy: isResolved.resolvedBy || "unknown",
            originalComment: comment.body || "",
            isResolved: true,
          });
        }
      }

      logger.debug(
        `Identified ${resolvedComments.length} resolved comments using heuristics`
      );
      return resolvedComments;
    } catch (error) {
      logger.error(
        "Error identifying resolved comments using heuristics:",
        error
      );
      return [];
    }
  }

  /**
   * Checks if a specific comment has been resolved using various heuristics
   * This is a fallback method when GraphQL API is not available
   */
  private async checkCommentResolutionStatusUsingHeuristics(
    owner: string,
    repo: string,
    pullNumber: number,
    comment: RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number]
  ): Promise<{ resolved: boolean; resolvedAt?: string; resolvedBy?: string }> {
    try {
      // Get reactions to the comment
      const reactions =
        await this.octokit.reactions.listForPullRequestReviewComment({
          owner,
          repo,
          comment_id: comment.id,
        });

      // Check for "thumbs up" or "hooray" reactions which often indicate resolution
      const positiveReactions = reactions.data.filter(
        (reaction) => reaction.content === "+1" || reaction.content === "hooray"
      );

      // Check for resolution indicators in comment replies
      // Note: This is a simplified approach since getting threaded conversations requires GraphQL
      const recentComments = await this.octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pullNumber,
        since: comment.created_at,
      });

      // Look for replies that indicate resolution
      const resolutionReplies = recentComments.data.filter((reply) => {
        if (reply.in_reply_to_id !== comment.id) return false;
        const body = reply.body?.toLowerCase() || "";
        return (
          body.includes("resolved") ||
          body.includes("fixed") ||
          body.includes("addressed") ||
          body.includes("done") ||
          body.includes("👍") ||
          body.includes("✅")
        );
      });

      // Determine if comment is resolved
      const hasPositiveReactions = positiveReactions.length > 0;
      const hasResolutionReplies = resolutionReplies.length > 0;

      if (hasPositiveReactions || hasResolutionReplies) {
        const resolvedBy =
          positiveReactions[0]?.user?.login ||
          resolutionReplies[0]?.user?.login ||
          "unknown";
        const resolvedAt =
          resolutionReplies[0]?.created_at ||
          positiveReactions[0]?.created_at ||
          comment.updated_at;

        return {
          resolved: true,
          resolvedAt,
          resolvedBy,
        };
      }

      return { resolved: false };
    } catch (error) {
      logger.error(
        `Error checking resolution status for comment ${comment.id} using heuristics:`,
        error
      );
      return { resolved: false };
    }
  }
}
