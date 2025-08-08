# Gemini AI Code Review Action

## Free to use, deranks the model if rate limits are hit

[](https://www.google.com/search?q=https://github.com/marketplace/actions/gemini-ai-code-review-action) [](https://opensource.org/licenses/MIT)

This GitHub Action uses Google's powerful Gemini family of models to perform an automated, AI-powered code review on your pull requests. It analyzes the code changes (diffs) and posts review comments directly on the relevant lines, helping you catch potential issues, improve code quality, and accelerate the review process.

- handles the Gemini API limits
- provides multiple comments for everything reviewed under one parent comment
- no need to trigger the action by writing comments in your PR, it happens automatically on PR events

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
        uses: petar-zarkov/gemini-code-review-action@latest
        with:
          # Optional: Override the default exclude patterns
          # exclude: '*.md,*.json,package-lock.json,*.test.ts,migrations/*,*.spec.ts,*.e2e.ts,test/*,tests/*'
          model: gemini-2.0-flash-lite # default is gemini-2.5-pro
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
```

## How It Works

The action triggers on pull requests, fetches the diff, and sends a batch of changed hunks of code to the Gemini API with a specialized prompt. The AI's feedback is then formatted and posted back to the pull request as review comments for the relevant changes.

## Inputs

The action's behavior can be customized with the following input:

| Input     | Description                                                                   | Default                                                                                         |
| :-------- | :---------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `exclude` | A comma-separated list of glob patterns for files to exclude from the review. | `*.md,*.json,package-lock.json,*.yaml,*.test.ts,migrations/*,*.spec.ts,*.e2e.ts,test/*,tests/*` |

## Secrets

This action requires the following secrets to be set in your repository:

| Secret           | Description                                                                                                                                                                                              |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | **Required.** Your API key for the Google Gemini API. You can obtain one with a free tier from [Google AI Studio](https://aistudio.google.com/app/apikey).                                               |
| `GITHUB_TOKEN`   | **Provided by GitHub.** This token is used to post comments on your pull request. The workflow needs `pull-requests: write` permissions for this to work. The token is automatically provided by GitHub. |

To add the `GEMINI_API_KEY`, go to your repository's `Settings` \> `Secrets and variables` \> `Actions`, and create a new repository secret.
