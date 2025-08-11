// ANSI color codes for console logging
export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
} as const;

export const logger = {
  verbose: (message: string, meta?: unknown): void => {
    console.log(`${colors.magenta}ℹ ${message}${colors.reset}`, meta || "");
  },
  info: (message: string, meta?: unknown): void => {
    console.log(`${colors.blue}ℹ ${message}${colors.reset}`, meta || "");
  },
  success: (message: string, meta?: unknown): void => {
    console.log(`${colors.green}✓ ${message}${colors.reset}`, meta || "");
  },
  warn: (message: string, meta?: unknown): void => {
    console.log(`${colors.yellow}⚠ ${message}${colors.reset}`, meta || "");
  },
  error: (message: string, meta?: unknown): void => {
    console.log(`${colors.red}✗ ${message}${colors.reset}`, meta || "");
  },
  processing: (message: string, meta?: unknown): void => {
    console.log(`${colors.cyan}⚙ ${message}${colors.reset}`, meta || "");
  },
  debug: (message: string, meta?: unknown): void => {
    console.log(`${colors.gray}🔍 ${message}${colors.reset}`, meta || "");
  },
};
