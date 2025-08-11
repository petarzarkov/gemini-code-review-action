import {
  ReviewData,
  ReviewCommentData,
  CommentData,
  CommitData,
} from "./github";

export interface ConversationContext {
  previousReviews: ReviewData[];
  previousComments: ReviewCommentData[];
  conversationHistory: CommentData[];
  commits: CommitData[];
  resolvedComments: ResolvedCommentInfo[];
}

export interface ResolvedCommentInfo {
  id: number;
  path: string;
  line: number | null;
  position: number | null;
  resolvedAt: string;
  resolvedBy: string;
  originalComment: string;
  isResolved: boolean;
}
