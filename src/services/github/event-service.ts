import fs from "node:fs";
import { PullRequestDetails, GitHubEventData } from "../../types/github";

export class GitHubEventService {
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
      headSha: eventData.pull_request.head?.sha,
    };
  }

  public isPullRequestDraft(): boolean {
    const eventData = this.getEventData();
    return eventData.pull_request?.draft ?? false;
  }

  private getEventData(): GitHubEventData {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error("GITHUB_EVENT_PATH environment variable is not set");
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    return eventData as GitHubEventData;
  }
}
