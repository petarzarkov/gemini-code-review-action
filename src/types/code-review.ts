import { RestEndpointMethodTypes } from "@octokit/rest";

export interface PullRequestDetails {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
}

export interface HunkData {
  header: string;
  lines: string[];
}

export interface FileData {
  path: string;
  hunks: HunkData[];
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

export interface ConversationContext {
  previousReviews: ReviewData[];
  previousComments: ReviewCommentData[];
  conversationHistory: CommentData[];
  commits: CommitData[];
}

export interface AiReviewResponse {
  lineContent: string;
  reviewComment: string;
}

export interface AiResponseData {
  reviews: AiReviewResponse[];
}

export interface BatchAiResponseData {
  reviews: AiReviewResponse[];
}

export interface BatchFileContent {
  path: string;
  content: string;
  estimatedTokens: number;
  originalHunks: HunkData[];
}

export interface BatchReviewRequest {
  files: BatchFileContent[];
  totalEstimatedTokens: number;
}

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
