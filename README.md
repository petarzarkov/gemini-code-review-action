# Gemini AI Code Review Action

## Free to use, deranks the model if rate limits are hit

[](https://www.google.com/search?q=github,gemini-ai-code-review-action,"petarzarkov")

This GitHub Action uses Google's powerful Gemini family of models to perform an automated, AI-powered code review on your pull requests. It analyzes the code changes (diffs) and posts review comments directly on the relevant lines, helping you catch potential issues, improve code quality, and accelerate the review process.

## Key Features

- 🔄 **Conversation Continuity**: Maintains context across multiple PR reviews - the AI remembers previous discussions and builds upon them
- 🎯 **Smart Rate Limiting**: Automatically handles Gemini API limits by deranking to faster models when needed
- 📝 **Contextual Comments**: Provides multiple detailed comments grouped under parent reviews
- ⚡ **Automatic Triggering**: No manual intervention needed - runs automatically on PR events
- 🔧 **Highly Configurable**: Customizable file exclusions, models, and conversation settings

## Setup

Create a new workflow file in your repository at `.github/workflows/code-review.yml`:

```yaml
name: "Code Review"

on:
  pull_request:
    types: [opened, synchronize]

# This is required for the action to be able to post comments on the PR.
permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: "Run AI Code Review"
        uses: petarzarkov/gemini-code-review-action@latest
        with:
          # Optional: Override the default exclude patterns
          # exclude: '*.md,*.json,package-lock.json,*.test.ts,migrations/*,*.spec.ts,*.e2e.ts,test/*,tests/*'

          # Optional: Choose your preferred model
          model: gemini-2.0-flash-lite # default is gemini-2.5-pro

          # Optional: Enable/disable conversation continuity (default: true)
          enable_conversation_context: true
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## How It Works

The action triggers on pull requests and:

1. **Fetches Context**: Retrieves previous review history and comments for conversation continuity
2. **Analyzes Changes**: Examines the diff and identifies code changes that need review
3. **AI Review**: Sends code to Gemini AI with specialized prompts that include conversation context
4. **Posts Comments**: Formats AI feedback and posts review comments on relevant lines
5. **Saves Context**: Stores conversation summary for future review runs

### Conversation Continuity

When enabled (default), the action maintains context across multiple reviews:

- Remembers previous AI comments and suggestions
- Avoids repeating the same feedback
- Builds upon previous discussions
- Tracks review history for each PR
- Provides contextual understanding of the ongoing code review conversation

## Inputs

The action's behavior can be customized with the following inputs:

| Input                         | Description                                                                                                    | Default                                                                                         |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `exclude`                     | A comma-separated list of glob patterns for files to exclude from the review.                                  | `*.md,*.json,package-lock.json,*.yaml,*.test.ts,migrations/*,*.spec.ts,*.e2e.ts,test/*,tests/*` |
| `model`                       | The Gemini model to use for code review. See [available models](https://ai.google.dev/gemini-api/docs/models). | `gemini-2.5-pro`                                                                                |
| `enable_conversation_context` | Enable conversation context to maintain discussion continuity across multiple PR reviews.                      | `true`                                                                                          |

## Secrets

This action requires the following secrets to be set in your repository:

| Secret           | Description                                                                                                                                                |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | **Required.** Your API key for the Google Gemini API. You can obtain one with a free tier from [Google AI Studio](https://aistudio.google.com/app/apikey). |
| `GITHUB_TOKEN`   | **Provided by GitHub.** This token is used to post comments on your pull request. The workflow needs `pull-requests: write` permissions for this to work.  |

To add the `GEMINI_API_KEY`, go to your repository's `Settings` \> `Secrets and variables` \> `Actions`, and create a new repository secret.
