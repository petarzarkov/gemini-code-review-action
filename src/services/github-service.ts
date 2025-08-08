import fs from "node:fs";
import { Octokit } from "@octokit/rest";
import {
  PullRequestDetails,
  GitHubEventData,
  ReviewComment,
} from "../types/code-review";
import { logger } from "../utils/logger";
import pkg from "../../package.json";

export class GitHubService {
  private readonly octokit: Octokit;

  constructor(githubToken: string) {
    this.octokit = new Octokit({ auth: githubToken });
  }

  public getPullRequestDetails(): PullRequestDetails {
    const eventData = this.getEventData();
    const repoFullName = eventData.repository.full_name;

    if (!eventData.pull_request) {
      throw new Error("No pull request data found in event");
    }

    const [owner, repo] = repoFullName.split("/");

    return {
      owner,
      repo,
      pullNumber: eventData.pull_request.number,
      title: eventData.pull_request.title,
      description: eventData.pull_request.body || "",
    };
  }

  private getEventData(): GitHubEventData {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error("GITHUB_EVENT_PATH environment variable is not set");
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return eventData as GitHubEventData;
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

  public async createReviewComments(
    owner: string,
    repo: string,
    pullNumber: number,
    comments: ReviewComment[]
  ): Promise<void> {
    try {
      logger.processing(`Creating review with ${comments.length} comments`);

      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        body: `${pkg.name} comments`,
        comments: comments.map((comment) => ({
          path: comment.path,
          position: comment.position,
          body: comment.body,
        })),
        event: "COMMENT",
      });

      logger.success("Review created successfully");
    } catch (error) {
      logger.error("Error creating review:", error);
      throw error;
    }
  }
}
