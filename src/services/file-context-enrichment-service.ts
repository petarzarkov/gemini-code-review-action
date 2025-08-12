import { FileData } from "../types/diff";
import { PullRequestDetails } from "../types/github";
import { GitHubService } from "./github/index";
import { logger } from "../utils/logger";

/**
 * Service for enriching FileData with complete file contents to provide better context to AI
 */
export class FileContextEnrichmentService {
  private readonly githubService: GitHubService;
  private enableFullContext: boolean;
  private readonly maxFileSize: number = 5000; // Max characters per file for context

  constructor(githubService: GitHubService, enableFullContext: boolean = true) {
    this.githubService = githubService;
    this.enableFullContext = enableFullContext;
  }

  /**
   * Enriches file data with complete file contents for better AI context
   */
  public async enrichFilesWithContext(
    files: FileData[],
    prDetails: PullRequestDetails
  ): Promise<FileData[]> {
    if (!this.enableFullContext) {
      logger.debug("Full context enrichment is disabled");
      return files;
    }

    if (!prDetails.headSha) {
      logger.warn(
        "No head SHA available, cannot enrich files with full context"
      );
      return files;
    }

    logger.processing(`Enriching ${files.length} files with full context`);

    try {
      // Extract file paths that are not deleted
      const filePaths = files
        .filter((file) => file.path && file.path !== "/dev/null")
        .map((file) => file.path);

      if (filePaths.length === 0) {
        logger.debug("No valid file paths to enrich");
        return files;
      }

      // Fetch all file contents in parallel
      const fileContents = await this.githubService.getMultipleFileContents(
        prDetails.owner,
        prDetails.repo,
        filePaths,
        prDetails.headSha
      );

      // Enrich each file with its content (with size limits)
      const enrichedFiles = files.map((file) => {
        if (!file.path || file.path === "/dev/null") {
          return file;
        }

        const content = fileContents.get(file.path);
        if (content) {
          // Smart content truncation for large files
          const optimizedContent = this.optimizeFileContent(content, file);

          return {
            ...file,
            fullContent: optimizedContent,
            encoding: "utf-8",
          };
        } else {
          logger.debug(`Could not fetch content for ${file.path}`);
          return file;
        }
      });

      const enrichedCount = enrichedFiles.filter((f) => f.fullContent).length;
      logger.success(
        `Successfully enriched ${enrichedCount}/${files.length} files with full context`
      );

      return enrichedFiles;
    } catch (error) {
      logger.error("Error enriching files with context:", error);
      logger.warn("Falling back to diff-only mode");
      return files;
    }
  }

  /**
   * Enable or disable full context enrichment
   */
  public setEnabled(enabled: boolean): void {
    this.enableFullContext = enabled;
    logger.info(`Full context enrichment ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Check if full context enrichment is enabled
   */
  public isEnabled(): boolean {
    return this.enableFullContext;
  }

  /**
   * Optimizes file content for AI context by truncating large files intelligently
   */
  private optimizeFileContent(content: string, file: FileData): string {
    if (content.length <= this.maxFileSize) {
      return content; // Small file, include everything
    }

    logger.debug(
      `Optimizing large file content for ${file.path} (${content.length} chars)`
    );

    // For large files, try to include:
    // 1. Top of file (imports, types, etc.)
    // 2. Areas around the changed lines
    // 3. Key structural elements

    const lines = content.split("\n");
    const totalLines = lines.length;
    const keepLines = new Set<number>();

    // Always include top of file (imports, interfaces, etc.)
    const topLines = Math.min(50, Math.floor(totalLines * 0.1));
    for (let i = 0; i < topLines; i++) {
      keepLines.add(i);
    }

    // Find changed line ranges from hunks
    for (const hunk of file.hunks) {
      const hunkHeader = hunk.header;
      // Extract line numbers from hunk header like "@@-20,6 +21,7 @@"
      const match = hunkHeader.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
      if (match) {
        const startLine = parseInt(match[1]) - 1; // Convert to 0-based

        // Include context around changed lines
        const contextRadius = 25; // Lines before and after changes
        for (
          let i = Math.max(0, startLine - contextRadius);
          i <
          Math.min(totalLines, startLine + contextRadius + hunk.lines.length);
          i++
        ) {
          keepLines.add(i);
        }
      }
    }

    // Include key structural lines (class/function definitions)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        line.match(
          /^(export\s+)?(class|interface|function|const\s+\w+\s*=|type\s+)/
        )
      ) {
        keepLines.add(i);
        // Include a few lines after class/function definitions
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          keepLines.add(j);
        }
      }
    }

    // Convert set to sorted array and build optimized content
    const linesToKeep = Array.from(keepLines).sort((a, b) => a - b);
    const optimizedLines: string[] = [];
    let lastIncludedLine = -2;

    for (const lineNum of linesToKeep) {
      if (lineNum > lastIncludedLine + 1) {
        // Add ellipsis for gaps
        optimizedLines.push("// ... [truncated] ...");
      }
      optimizedLines.push(lines[lineNum]);
      lastIncludedLine = lineNum;
    }

    const optimizedContent = optimizedLines.join("\n");
    logger.debug(
      `Optimized ${file.path}: ${content.length} → ${optimizedContent.length} chars`
    );

    return optimizedContent;
  }
}
