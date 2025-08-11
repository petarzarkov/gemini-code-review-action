import { RestEndpointMethodTypes } from "@octokit/rest";

export interface PullRequestDetails {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
}

export type ReviewCommentData =
  RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"][number];

export type ReviewData =
  RestEndpointMethodTypes["pulls"]["listReviews"]["response"]["data"][number];

export type CommentData =
  RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][number];

export type ReviewComment = Exclude<
  RestEndpointMethodTypes["pulls"]["createReview"]["parameters"]["comments"],
  undefined
>[number];

export type CommitData =
  RestEndpointMethodTypes["pulls"]["listCommits"]["response"]["data"][number];

export interface GitHubEventData {
  number?: number;
  repository: {
    full_name: string;
  };
  pull_request?: {
    title: string;
    body: string;
    number: number;
    draft: boolean;
  };
}

// GraphQL types for review thread resolution
export interface GraphQLReviewThread {
  id: string;
  isResolved: boolean;
  resolvedBy?: {
    login: string;
  };
  comments: {
    nodes: GraphQLReviewComment[];
  };
}

export interface GraphQLReviewComment {
  id: string;
  databaseId: number;
  body: string;
  path: string;
  line?: number;
  position?: number;
  createdAt: string;
  updatedAt: string;
  author?: {
    login: string;
  };
}

export interface GraphQLPullRequestReviewThreads {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: GraphQLReviewThread[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor?: string;
        };
      };
    };
  };
}
