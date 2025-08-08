import path from "node:path";
import fs from "node:fs";
import { CodeReviewService } from "./code-review";

async function testCodeReview(): Promise<void> {
  try {
    console.log("=== Manual Code Review Test ===\n");

    // Check required environment variables
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const excludeInput = process.env.INPUT_EXCLUDE || "";

    if (!githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    // Mock GitHub event data for testing
    const mockEventData = {
      repository: {
        full_name: process.env.TEST_REPO || "owner/repo",
      },
      pull_request: {
        number: parseInt(process.env.TEST_PR_NUMBER || "1"),
        title: process.env.TEST_PR_TITLE || "Test Pull Request",
        body:
          process.env.TEST_PR_DESCRIPTION ||
          "Test PR description for manual testing",
      },
    };

    // Create temporary event file for testing
    const tempEventPath = path.join(__dirname, "temp-github-event.json");
    fs.writeFileSync(tempEventPath, JSON.stringify(mockEventData, null, 2));

    // Set required environment variables for the test
    process.env.GITHUB_EVENT_PATH = tempEventPath;
    process.env.GITHUB_EVENT_NAME = "pull_request";

    console.log("Test Configuration:");
    console.log(`- Repository: ${mockEventData.repository.full_name}`);
    console.log(`- PR Number: ${mockEventData.pull_request.number}`);
    console.log(`- PR Title: ${mockEventData.pull_request.title}`);
    console.log(`- Exclude patterns: ${excludeInput || "None"}`);
    console.log("");

    // Parse exclude patterns
    const excludePatterns = excludeInput
      .split(",")
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0);

    // Create and run code review service
    const codeReviewService = new CodeReviewService(
      githubToken,
      geminiApiKey,
      excludePatterns
    );

    console.log("Starting code review process...\n");
    await codeReviewService.processCodeReview();

    console.log("\n=== Code review test run completed successfully ===");

    // Clean up temporary file
    if (fs.existsSync(tempEventPath)) {
      fs.unlinkSync(tempEventPath);
      console.log("Cleaned up temporary files");
    }
  } catch (error) {
    console.error("Error in test:", error);

    // Clean up temporary file on error
    const tempEventPath = path.join(__dirname, "temp-github-event.json");
    if (fs.existsSync(tempEventPath)) {
      fs.unlinkSync(tempEventPath);
    }

    process.exit(1);
  }
}

function printUsage(): void {
  console.log(`
Usage: npm run test:code-review

Required environment variables in .env file:
- GITHUB_TOKEN: Your GitHub personal access token
- GEMINI_API_KEY: Your Google Gemini API key

Optional environment variables:
- TEST_REPO: Repository to test (default: "owner/repo")
- TEST_PR_NUMBER: PR number to test (default: 1)
- TEST_PR_TITLE: PR title for testing (default: "Test Pull Request")
- TEST_PR_DESCRIPTION: PR description for testing
- INPUT_EXCLUDE: Comma-separated list of file patterns to exclude
- GEMINI_MODEL: Gemini model to use (default: "gemini-2.0-flash-001")

Example .env file:
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxx
TEST_REPO=myorg/myrepo
TEST_PR_NUMBER=123
INPUT_EXCLUDE=*.md,*.json,package-lock.json
  `);
}

// Check if help is requested
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(0);
}

// Run the test
if (require.main === module) {
  testCodeReview();
}

export { testCodeReview };
