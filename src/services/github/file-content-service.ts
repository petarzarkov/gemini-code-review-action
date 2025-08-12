import { Octokit } from "@octokit/rest";
import { logger } from "../../utils/logger";

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
  sha: string;
}

/**
 * Service for fetching file contents from GitHub repository
 */
export class GitHubFileContentService {
  private readonly octokit: Octokit;
  private readonly fileContentCache = new Map<string, FileContent>();

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Get the complete content of a file at a specific commit SHA
   */
  public async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<FileContent | null> {
    const cacheKey = `${owner}/${repo}/${path}@${ref}`;

    // Check cache first
    if (this.fileContentCache.has(cacheKey)) {
      return this.fileContentCache.get(cacheKey)!;
    }

    try {
      logger.debug(`Fetching file content for ${path} at ${ref}`);

      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      // GitHub API returns different structures for files vs directories
      if (Array.isArray(response.data)) {
        logger.warn(`Path ${path} is a directory, not a file`);
        return null;
      }

      const data = response.data;
      if (data.type !== "file") {
        logger.warn(`Path ${path} is not a file (type: ${data.type})`);
        return null;
      }

      let content: string;
      if (data.encoding === "base64") {
        content = Buffer.from(data.content, "base64").toString("utf-8");
      } else {
        content = data.content;
      }

      const fileContent: FileContent = {
        path,
        content,
        encoding: data.encoding,
        sha: data.sha,
      };

      // Cache the result
      this.fileContentCache.set(cacheKey, fileContent);

      return fileContent;
    } catch (error: any) {
      if (error.status === 404) {
        logger.debug(`File not found: ${path} at ${ref}`);
        return null;
      }

      logger.error(`Error fetching file content for ${path}:`, error);
      return null;
    }
  }

  /**
   * Get multiple file contents in parallel
   */
  public async getMultipleFileContents(
    owner: string,
    repo: string,
    filePaths: string[],
    ref: string
  ): Promise<Map<string, FileContent>> {
    const results = new Map<string, FileContent>();

    const promises = filePaths.map(async (path) => {
      const content = await this.getFileContent(owner, repo, path, ref);
      if (content) {
        results.set(path, content);
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Clear the internal cache
   */
  public clearCache(): void {
    this.fileContentCache.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.fileContentCache.size,
      keys: Array.from(this.fileContentCache.keys()),
    };
  }
}
