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

export interface ReviewComment {
  body: string;
  path: string;
  position: number;
}

export interface AiReviewResponse {
  lineContent: string;
  reviewComment: string;
}

export interface AiResponseData {
  reviews: AiReviewResponse[];
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
  };
}
