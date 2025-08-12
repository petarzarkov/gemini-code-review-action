import { HunkData } from "./diff";

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
  fullFileContent?: string; // Complete file content for better AI context
}

export interface BatchReviewRequest {
  files: BatchFileContent[];
  totalEstimatedTokens: number;
}
