import { Octokit } from "@octokit/rest";
import { CommitData } from "../../types/github";
import { logger } from "../../utils/logger";

export class GitHubDiffService {
  private readonly octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  public async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    try {
      logger.processing(`Fetching diff for ${owner}/${repo} PR#${pullNumber}`);

      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: {
          format: "diff",
        },
      });

      const diff = response.data as unknown as string;
      logger.debug(`Retrieved diff length: ${diff.length}`);
      return diff;
    } catch (error) {
      logger.error("Failed to get pull request diff:", error);
      return "";
    }
  }

  public async getPullRequestCommits(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<CommitData[]> {
    try {
      logger.processing(`Fetching commits for PR #${pullNumber}`);

      const response = await this.octokit.pulls.listCommits({
        owner,
        repo,
        pull_number: pullNumber,
      });

      logger.debug(`Retrieved ${response.data.length} commits`);
      return response.data;
    } catch (error) {
      logger.error("Failed to get pull request commits:", error);
      return [];
    }
  }
}
