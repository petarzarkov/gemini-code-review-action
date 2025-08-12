import { AIService } from "./services/ai-service";
import { GitHubService } from "./services/github/index";
import { BatchProcessor } from "./services/batch-processor";
import { FileFilterService } from "./services/file-filter-service";
import { CodeAnalysisService } from "./services/code-analysis-service";
import { FileContextEnrichmentService } from "./services/file-context-enrichment-service";
import { ConversationContext } from "./types/conversation";
import { logger } from "./utils/logger";
import { parseExcludePatterns, parseDiffToFileData } from "./utils/helpers";
import {
  createContextSummary,
  logContextStats,
  filterResolvedCodeSections,
} from "./utils/conversation-context";
import pkg from "../package.json";

export class CodeReviewService {
  private readonly githubService: GitHubService;
  private readonly fileFilterService: FileFilterService;
  private readonly codeAnalysisService: CodeAnalysisService;
  private readonly enableConversationContext: boolean;
  private readonly skipDraftPrs: boolean;

  constructor(
    githubToken: string,
    geminiApiKey: string,
    excludePatterns: string[] = [],
    model?: string,
    enableConversationContext: boolean = true,
    skipDraftPrs: boolean = true,
    language?: string,
    enableFullContext: boolean = true
  ) {
    this.githubService = new GitHubService(githubToken);
    this.fileFilterService = new FileFilterService(excludePatterns);

    const aiService = new AIService(geminiApiKey, model, language);
    const batchProcessor = new BatchProcessor();

    // Create file enrichment service if full context is enabled
    const fileEnrichmentService = enableFullContext
      ? new FileContextEnrichmentService(this.githubService, enableFullContext)
      : undefined;

    this.codeAnalysisService = new CodeAnalysisService(
      aiService,
      batchProcessor,
      fileEnrichmentService
    );

    this.enableConversationContext = enableConversationContext;
    this.skipDraftPrs = skipDraftPrs;
  }

  public async processCodeReview(): Promise<void> {
    try {
      const prDetails = this.githubService.getPullRequestDetails();
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (eventName !== "pull_request") {
        logger.warn(`Unsupported event: ${eventName}`);
        return;
      }

      // Check if PR is draft and should be skipped
      if (this.skipDraftPrs && this.githubService.isPullRequestDraft()) {
        logger.info(
          "Pull request is a draft and skip_draft_prs is enabled, skipping review"
        );
        return;
      }

      // Retrieve conversation context for continuing the discussion (if enabled)
      let conversationContext: ConversationContext | undefined;
      let limitedConversationContext: ConversationContext | undefined;

      if (this.enableConversationContext) {
        // Get full context for filtering operations
        conversationContext =
          await this.githubService.getFullConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber
          );

        // Get limited context for AI consumption
        limitedConversationContext =
          await this.githubService.getLimitedConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber
          );

        logContextStats(conversationContext);
      } else {
        logger.info("Conversation context is disabled");
      }

      const diff = await this.githubService.getPullRequestDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pullNumber
      );
      if (!diff) {
        logger.warn("No diff found for this pull request");
        return;
      }

      const parsedDiff = parseDiffToFileData(diff);
      let filteredDiff =
        this.fileFilterService.filterFilesByExcludePatterns(parsedDiff);

      // Filter out resolved code sections if conversation context is enabled
      if (
        this.enableConversationContext &&
        conversationContext?.resolvedComments
      ) {
        const beforeCount = filteredDiff.reduce(
          (acc, file) => acc + file.hunks.length,
          0
        );
        filteredDiff = filterResolvedCodeSections(
          filteredDiff,
          conversationContext.resolvedComments
        );
        const afterCount = filteredDiff.reduce(
          (acc, file) => acc + file.hunks.length,
          0
        );

        if (beforeCount > afterCount) {
          logger.info(
            `Filtered out ${beforeCount - afterCount} resolved code hunks`
          );
        }
      }

      logger.info(
        `Files to analyze after filtering: ${filteredDiff
          .map((f) => f.path)
          .join(", ")}`
      );

      const comments = await this.codeAnalysisService.analyzeCodeChanges(
        filteredDiff,
        prDetails,
        conversationContext,
        limitedConversationContext
      );

      if (comments.length > 0) {
        await this.githubService.createReviewComments(
          prDetails.owner,
          prDetails.repo,
          prDetails.pullNumber,
          comments
        );
        logger.success(`Created ${comments.length} review comments`);

        // Save conversation context for future runs (if enabled)
        if (this.enableConversationContext && conversationContext) {
          const contextSummary = createContextSummary(
            conversationContext,
            `Generated ${comments.length} new comment${
              comments.length > 1 ? "s" : ""
            } on the latest changes`
          );

          const totalReviews = conversationContext.previousReviews.length + 1; // +1 for current review

          await this.githubService.saveConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber,
            contextSummary,
            totalReviews
          );
        }
      } else {
        logger.info("No review comments generated");

        // Still save context if this is a follow-up review (if enabled)
        if (
          this.enableConversationContext &&
          conversationContext &&
          (conversationContext.previousReviews.length > 0 ||
            conversationContext.previousComments.length > 0)
        ) {
          const contextSummary = createContextSummary(
            conversationContext,
            "No new issues found in the latest changes"
          );

          const totalReviews = conversationContext.previousReviews.length + 1; // +1 for current review

          await this.githubService.saveConversationContext(
            prDetails.owner,
            prDetails.repo,
            prDetails.pullNumber,
            contextSummary,
            totalReviews
          );
        }
      }
    } catch (error) {
      logger.error("Error in code review process:", error);
      throw error;
    }
  }
}

async function main(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const excludeInput = process.env.INPUT_EXCLUDE || "";
    const model = process.env.INPUT_MODEL || "gemini-2.5-pro";
    const enableConversationContext =
      (
        process.env.INPUT_ENABLE_CONVERSATION_CONTEXT || "true"
      ).toLowerCase() === "true";
    const skipDraftPrs =
      (process.env.INPUT_SKIP_DRAFT_PRS || "true").toLowerCase() === "true";
    const enableFullContext =
      (process.env.INPUT_ENABLE_FULL_CONTEXT || "true").toLowerCase() ===
      "true";
    const language = process.env.INPUT_LANGUAGE;

    if (!githubToken) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    const excludePatterns = parseExcludePatterns(excludeInput);
    logger.verbose(
      `🚀 Starting Code Review Action (@v${
        pkg.version
      }) with model: ${model}, conversation context: ${
        enableConversationContext ? "enabled" : "disabled"
      }, full context: ${
        enableFullContext ? "enabled" : "disabled"
      }, skip draft PRs: ${
        skipDraftPrs ? "enabled" : "disabled"
      }, exclude patterns: ${excludePatterns.join(", ")}`
    );

    const codeReviewService = new CodeReviewService(
      githubToken,
      geminiApiKey,
      excludePatterns,
      model,
      enableConversationContext,
      skipDraftPrs,
      language,
      enableFullContext
    );
    await codeReviewService.processCodeReview();

    logger.success("✨ Code Review completed successfully!");
  } catch (error) {
    logger.error("💥 Error in main:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
