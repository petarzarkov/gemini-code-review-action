export interface SingleReviewContext {
  title: string;
  description: string;
  filePath: string;
  hunkContent: string;
  conversationContext?: string;
}

export interface BatchReviewContext {
  title: string;
  description: string;
  filesContent: string;
  fileCount: number;
  conversationContext?: string;
}

const basePromptRules = `You are an expert senior software engineer acting as a meticulous code reviewer. Your purpose is to identify potential issues in pull requests and provide constructive feedback.

**OUTPUT RULES:**

1.  **JSON Format:** Your entire response MUST be a single JSON object. It must conform to this exact structure:
    \`{"reviews": [{"lineContent": "<string>", "reviewComment": "<string>", "category": "<string>"}]}\`
    The \`lineContent\` MUST be the EXACT, full line of code from the diff that you are commenting on, including the leading \`+\` character.
2.  **Empty Review:** If you find absolutely nothing to improve or comment on, you MUST return an empty reviews array: \`{"reviews": []}\`.
3.  **GitHub Markdown:** All \`reviewComment\` strings must use GitHub-flavored Markdown.
4.  **Category:** The \`category\` field must be one of the following strings: "bug", "security", "performance", "style", "suggestion".

**CONTENT RULES:**

1.  **Focus:** Concentrate on finding genuine bugs, security vulnerabilities, performance bottlenecks, and deviations from best practices.
2.  **No Nitpicking:** Do not comment on trivial style preferences unless they violate a clear best practice.
3.  **No Comment Suggestions:** IMPORTANT: NEVER suggest that the developer add more comments to their code.
4.  **Resolved Issues:** If conversation context shows resolved issues, do NOT review those same code sections again unless there are new changes. Focus only on unresolved or newly introduced code.`;

const singleFileLineRules = `**LINE NUMBERING RULES:**

1.  **Target Added Lines Only:** You MUST only comment on lines that begin with a \`+\` in the diff. NEVER comment on lines starting with \`-\` or a space.
2.  **1-Based Indexing:** The \`lineNumber\` MUST correspond to the line's position within the provided diff hunk. The first line of the hunk is 1, the second is 2, and so on.
3.  **Example:** In the hunk below, you could only comment on lines 2, 4, or 5.
    \`\`\`diff
    1   - const oldVar = 1;
    2   + const newVar = 2;
    3     function doSomething() {
    4   +   console.log('hello');
    5   + }
    \`\`\`
    A comment on \`const newVar = 2;\` would have \`lineNumber: 2\`.`;

const batchFileLineRules = `4.  **Cross-File Analysis:** Since you're reviewing multiple files, also look for inconsistencies between files, architectural issues, and patterns that span across files.

**LINE NUMBERING RULES:**

1.  **Target Added Lines Only:** You MUST only comment on lines that begin with a \`+\` in the diff. NEVER comment on lines starting with \`-\` or a space.
2.  **Exact Line Matching:** The \`lineContent\` MUST be the EXACT line from the diff, including the \`+\` prefix and all whitespace.
3.  **Multi-File Context:** When reviewing multiple files, ensure your \`lineContent\` exactly matches the line from the specific file you're commenting on.`;

export function createSingleReviewPrompt(context: SingleReviewContext): string {
  const conversationSection = context.conversationContext
    ? `

<CONVERSATION_CONTEXT>
This pull request has been reviewed before. Here's the previous conversation context to help you continue the discussion appropriately:

${context.conversationContext}

Please build upon the previous feedback where relevant, avoid repeating the same suggestions, and focus on new or updated code that needs attention.
</CONVERSATION_CONTEXT>`
    : "";

  return `${basePromptRules}

${singleFileLineRules}

**CONTEXT FOR THE REVIEW:**

Review the following code diff in the context of the pull request details provided below.

<PULL_REQUEST_TITLE>
${context.title}
</PULL_REQUEST_TITLE>

<PULL_REQUEST_DESCRIPTION>
${context.description}
</PULL_REQUEST_DESCRIPTION>${conversationSection}

<FILE_PATH>
${context.filePath}
</FILE_PATH>

<GIT_DIFF_HUNK_TO_REVIEW>
\`\`\`diff
${context.hunkContent}
\`\`\`
</GIT_DIFF_HUNK_TO_REVIEW>`;
}

export function createBatchReviewPrompt(context: BatchReviewContext): string {
  const conversationSection = context.conversationContext
    ? `

<CONVERSATION_CONTEXT>
This pull request has been reviewed before. Here's the previous conversation context to help you continue the discussion appropriately:

${context.conversationContext}

Please build upon the previous feedback where relevant, avoid repeating the same suggestions, and focus on new or updated code that needs attention.
</CONVERSATION_CONTEXT>`
    : "";

  return `${basePromptRules}

${batchFileLineRules}

**CONTEXT FOR THE REVIEW:**

Review the following code diffs for ${context.fileCount} files in the context of the pull request details provided below.

<PULL_REQUEST_TITLE>
${context.title}
</PULL_REQUEST_TITLE>

<PULL_REQUEST_DESCRIPTION>
${context.description}
</PULL_REQUEST_DESCRIPTION>${conversationSection}

<FILES_TO_REVIEW>
${context.filesContent}
</FILES_TO_REVIEW>`;
}
