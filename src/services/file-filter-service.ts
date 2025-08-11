import { FileData } from "../types/diff";
import { matchesPattern } from "../utils/helpers";
import { logger } from "../utils/logger";

export class FileFilterService {
  private readonly excludePatterns: string[];

  constructor(excludePatterns: string[] = []) {
    this.excludePatterns = excludePatterns;
  }

  public filterFilesByExcludePatterns(files: FileData[]): FileData[] {
    if (this.excludePatterns.length === 0) {
      return files;
    }

    return files.filter((file) => {
      const shouldExclude = this.excludePatterns.some((pattern) =>
        matchesPattern(file.path, pattern)
      );

      if (shouldExclude) {
        logger.debug(`Excluding file: ${file.path}`);
        return false;
      }

      return true;
    });
  }
}
