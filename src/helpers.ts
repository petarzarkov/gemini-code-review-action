function createPatternRegex(pattern: string): RegExp {
  const escapedPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escapedPattern}$`);
}

export function matchesPattern(filePath: string, pattern: string): boolean {
  const regex = createPatternRegex(pattern);
  return regex.test(filePath);
}

export function parseExcludePatterns(excludeInput: string): string[] {
  if (!excludeInput || !excludeInput.trim()) {
    return [];
  }

  return excludeInput
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export function interpolate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}
