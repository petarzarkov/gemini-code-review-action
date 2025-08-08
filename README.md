# Gemini AI Code Review Action

[](https://www.google.com/search?q=https://github.com/marketplace/actions/gemini-ai-code-review-action) [](https://opensource.org/licenses/MIT)

This GitHub Action uses Google's powerful Gemini family of models to perform an automated, AI-powered code review on your pull requests. It analyzes the code changes (diffs) and posts review comments directly on the relevant lines, helping you catch potential issues, improve code quality, and accelerate the review process.

## How It Works

The action triggers on pull requests, fetches the diff, and sends each changed hunk of code to the Gemini API with a specialized prompt. The AI's feedback is then formatted and posted back to the pull request as review comments.

## Inputs

The action's behavior can be customized with the following input:

| Input     | Description                                                                   | Default                                                                                         |
| :-------- | :---------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `exclude` | A comma-separated list of glob patterns for files to exclude from the review. | `*.md,*.json,package-lock.json,*.yaml,*.test.ts,migrations/*,*.spec.ts,*.e2e.ts,test/*,tests/*` |

## Secrets

This action requires the following secrets to be set in your repository:

| Secret           | Description                                                                                                                                                                      |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | **Required.** Your API key for the Google Gemini API. You can obtain one from [Google AI Studio](https://aistudio.google.com/app/apikey).                                        |
| `GITHUB_TOKEN`   | **Provided by GitHub.** This token is used to post comments on your pull request. The workflow needs `pull-requests: write` permissions for this to work. See the example below. |

To add the `GEMINI_API_KEY`, go to your repository's `Settings` \> `Secrets and variables` \> `Actions`, and create a new repository secret.

## Usage Example

Create a new workflow file in your repository at `.github/workflows/ai-review.yml`:

```yaml
name: "AI Code Review"

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
        # Replace 'petar-zarkov/gemini-code-review-action@v1' with your repository and version
        uses: petar-zarkov/gemini-code-review-action@v1
        with:
          # Optional: Override the default exclude patterns
          # exclude: 'dist/*,**/*.lock,**/*.md'
        env:
          # The API key you stored in your repository secrets
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}

          # The token is automatically provided by GitHub
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Author

Created by **Petar Zarkov**.

## License

This project is licensed under the MIT License.
