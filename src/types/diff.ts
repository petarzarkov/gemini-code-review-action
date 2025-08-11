export interface HunkData {
  header: string;
  lines: string[];
}

export interface FileData {
  path: string;
  hunks: HunkData[];
}
