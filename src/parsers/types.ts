export interface DiffChange {
  type: "normal" | "del" | "add";
  normal?: boolean;
  del?: boolean;
  add?: boolean;
  ln1?: number;
  ln2?: number;
  ln?: number;
  content: string;
}

export interface DiffChunk {
  content: string;
  changes: DiffChange[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface ParsedFile {
  chunks: DiffChunk[];
  deletions: number;
  additions: number;
  from: string;
  to: string;
  new?: boolean;
  deleted?: boolean;
  oldMode?: string;
  newMode?: string;
  index?: string[];
}
