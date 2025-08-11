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
}

export interface BatchReviewRequest {
  files: BatchFileContent[];
  totalEstimatedTokens: number;
}
