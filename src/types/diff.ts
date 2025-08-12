export interface HunkData {
  header: string;
  lines: string[];
}

export interface FileData {
  path: string;
  hunks: HunkData[];
  fullContent?: string; // Complete file content for better AI context
  encoding?: string; // File encoding (e.g., 'utf-8', 'base64')
}
