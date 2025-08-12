import { ReviewComment } from "../types/github";
import { FileData, HunkData } from "../types/diff";
import { AiReviewResponse } from "../types/ai";
import parseDiff, { ParsedFile, DiffChunk } from "../parsers/diff-parser";
import { DiffChange } from "../parsers/types";

function createPatternRegex(pattern: string): RegExp {
  const escapedPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escapedPattern}$`);
}

export function matchesPattern(filePath: string, pattern: string): boolean {
  const regex = createPatternRegex(pattern);
  return regex.test(filePath);
}

export function parseExcludePatterns(excludeInput: string): string[] {
  if (!excludeInput || !excludeInput.trim()) {
    return [];
  }

  return excludeInput
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export function interpolate(
  template: string,
  variables: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

export function parseDiffToFileData(diffStr: string): FileData[] {
  const parsedFiles = parseDiff(diffStr);
  return convertParsedFilesToFileData(parsedFiles);
}

function convertParsedFilesToFileData(parsedFiles: ParsedFile[]): FileData[] {
  return parsedFiles.map((parsedFile) => {
    const fileData: FileData = {
      path: parsedFile.to === "/dev/null" ? parsedFile.from : parsedFile.to,
      hunks: parsedFile.chunks.map((chunk) => convertChunkToHunkData(chunk)),
    };
    return fileData;
  });
}

function convertChunkToHunkData(chunk: DiffChunk): HunkData {
  return {
    header: chunk.content,
    lines: chunk.changes.map((change) => convertChangeToLine(change)),
  };
}

function convertChangeToLine(change: DiffChange): string {
  switch (change.type) {
    case "add":
      return `+${change.content}`;
    case "del":
      return `-${change.content}`;
    case "normal":
      return ` ${change.content}`;
    default:
      return change.content;
  }
}

export function createCommentsFromAiResponses(
  filePath: string,
  hunk: HunkData,
  aiResponses: AiReviewResponse[]
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  for (const aiResponse of aiResponses) {
    try {
      const { lineContent, reviewComment } = aiResponse;

      // The line content from the AI must be a non-empty string and start with '+'
      if (!lineContent || !lineContent.trim().startsWith("+")) {
        continue;
      }

      const normalizedAiLine = lineContent.trim().replace(/\s+/g, " ");

      const position =
        hunk.lines.findIndex((hunkLine) => {
          // Normalize the hunk line in the exact same way before comparing
          const normalizedHunkLine = hunkLine.trim().replace(/\s+/g, " ");
          return normalizedHunkLine === normalizedAiLine;
        }) + 1;

      // If we couldn't find the line in the hunk, the AI hallucinated. Skip it.
      if (position === 0) {
        continue;
      }

      const comment: ReviewComment = {
        body: reviewComment,
        path: filePath,
        position: position, // Use our calculated, trusted position
      };

      comments.push(comment);
    } catch (error) {
      console.error(
        "Error creating comment from AI response:",
        error,
        aiResponse
      );
    }
  }

  return comments;
}

export function createCommentsFromAiResponsesForMultipleHunks(
  filePath: string,
  hunks: HunkData[],
  aiResponses: AiReviewResponse[]
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  for (const aiResponse of aiResponses) {
    try {
      const { lineContent } = aiResponse;

      // The line content from the AI must be a non-empty string and start with '+'
      if (!lineContent || !lineContent.trim().startsWith("+")) {
        continue;
      }

      const normalizedAiLine = lineContent.trim().replace(/\s+/g, " ");

      // Find the line in the specific hunk and use that hunk's position system
      let found = false;

      for (const hunk of hunks) {
        for (let i = 0; i < hunk.lines.length; i++) {
          const hunkLine = hunk.lines[i];
          const normalizedHunkLine = hunkLine.trim().replace(/\s+/g, " ");

          if (normalizedHunkLine === normalizedAiLine) {
            // Create a comment using the single hunk function to get correct positioning
            const hunkComments = createCommentsFromAiResponses(
              filePath,
              hunk,
              [aiResponse] // Pass just this one response
            );

            if (hunkComments.length > 0) {
              comments.push(...hunkComments);
            }

            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        console.warn(
          `Could not find line "${lineContent}" in any hunk for file ${filePath}`
        );
      }
    } catch (error) {
      console.error(
        "Error creating comment from AI response:",
        error,
        aiResponse
      );
    }
  }

  return comments;
}
