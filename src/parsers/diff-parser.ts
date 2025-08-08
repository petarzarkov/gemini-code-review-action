import { DiffChange, DiffChunk, ParsedFile } from "./types";

interface FileChanges {
  oldLines: number;
  newLines: number;
}

type LineHandler = (line: string, match?: RegExpMatchArray) => void;

const parseDiff = (input: string): ParsedFile[] => {
  if (!input) return [];
  if (typeof input !== "string" || input.match(/^\s+$/)) return [];

  const lines = input.split("\n");
  if (lines.length === 0) return [];

  const files: ParsedFile[] = [];
  let currentFile: ParsedFile | null = null;
  let currentChunk: DiffChunk | null = null;
  let deletedLineCounter = 0;
  let addedLineCounter = 0;
  let currentFileChanges: FileChanges | null = null;

  const normal = (line: string): void => {
    if (!currentChunk || !currentFileChanges) return;

    currentChunk.changes.push({
      type: "normal",
      normal: true,
      ln1: deletedLineCounter++,
      ln2: addedLineCounter++,
      content: line.slice(1), // slice the space from the line
    });
    currentFileChanges.oldLines--;
    currentFileChanges.newLines--;
  };

  const start = (line: string): void => {
    const [fromFileName, toFileName] = parseFiles(line) ?? [];

    currentFile = {
      chunks: [],
      deletions: 0,
      additions: 0,
      from: fromFileName || "",
      to: toFileName || "",
    };

    files.push(currentFile);
  };

  const restart = (): void => {
    if (!currentFile || currentFile.chunks.length) {
      start("");
    }
  };

  const newFile: LineHandler = (_, match) => {
    restart();
    if (currentFile && match) {
      currentFile.new = true;
      currentFile.newMode = match[1];
      currentFile.from = "/dev/null";
    }
  };

  const deletedFile: LineHandler = (_, match) => {
    restart();
    if (currentFile && match) {
      currentFile.deleted = true;
      currentFile.oldMode = match[1];
      currentFile.to = "/dev/null";
    }
  };

  const oldMode: LineHandler = (_, match) => {
    restart();
    if (currentFile && match) {
      currentFile.oldMode = match[1];
    }
  };

  const newMode: LineHandler = (_, match) => {
    restart();
    if (currentFile && match) {
      currentFile.newMode = match[1];
    }
  };

  const index: LineHandler = (line, match) => {
    restart();
    if (currentFile) {
      currentFile.index = line.split(" ").slice(1);
      if (match && match[1]) {
        currentFile.oldMode = currentFile.newMode = match[1].trim();
      }
    }
  };

  const fromFile = (line: string): void => {
    restart();
    if (currentFile) {
      currentFile.from = parseOldOrNewFile(line);
    }
  };

  const toFile = (line: string): void => {
    restart();
    if (currentFile) {
      currentFile.to = parseOldOrNewFile(line);
    }
  };

  const toNumOfLines = (number: string | undefined): number => +(number || 1);

  const chunk: LineHandler = (line, match) => {
    if (!currentFile) {
      start(line);
    }

    if (!match || !currentFile) return;

    const [, oldStart, oldNumLines, newStart, newNumLines] = match;

    deletedLineCounter = +oldStart;
    addedLineCounter = +newStart;
    currentChunk = {
      content: line,
      changes: [],
      oldStart: +oldStart,
      oldLines: toNumOfLines(oldNumLines),
      newStart: +newStart,
      newLines: toNumOfLines(newNumLines),
    };
    currentFileChanges = {
      oldLines: toNumOfLines(oldNumLines),
      newLines: toNumOfLines(newNumLines),
    };
    currentFile.chunks.push(currentChunk);
  };

  const del = (line: string): void => {
    if (!currentChunk || !currentFile || !currentFileChanges) return;

    currentChunk.changes.push({
      type: "del",
      del: true,
      ln: deletedLineCounter++,
      content: line.slice(1), // slice the - from the line
    });
    currentFile.deletions++;
    currentFileChanges.oldLines--;
  };

  const add = (line: string): void => {
    if (!currentChunk || !currentFile || !currentFileChanges) return;

    currentChunk.changes.push({
      type: "add",
      add: true,
      ln: addedLineCounter++,
      content: line.slice(1), // slice the + from the line
    });
    currentFile.additions++;
    currentFileChanges.newLines--;
  };

  const eof = (line: string): void => {
    if (!currentChunk) return;

    const [mostRecentChange] = currentChunk.changes.slice(-1);
    if (!mostRecentChange) return;

    currentChunk.changes.push({
      type: mostRecentChange.type,
      [mostRecentChange.type]: true,
      ln1: mostRecentChange.ln1,
      ln2: mostRecentChange.ln2,
      ln: mostRecentChange.ln,
      content: line,
    });
  };

  const schemaHeaders: Array<[RegExp, LineHandler]> = [
    [/^diff\s/, start],
    [/^new file mode (\d+)$/, newFile],
    [/^deleted file mode (\d+)$/, deletedFile],
    [/^old mode (\d+)$/, oldMode],
    [/^new mode (\d+)$/, newMode],
    [/^index\s[\da-zA-Z]+\.\.[\da-zA-Z]+(\s(\d+))?$/, index],
    [/^---\s/, fromFile],
    [/^\+\+\+\s/, toFile],
    [/^@@\s+-(\d+),?(\d+)?\s+\+(\d+),?(\d+)?\s@@/, chunk],
    [/^\\ No newline at end of file$/, eof],
  ];

  const schemaContent: Array<[RegExp, LineHandler]> = [
    [/^\\ No newline at end of file$/, eof],
    [/^-/, del],
    [/^\+/, add],
    [/^\s+/, normal],
  ];

  const parseContentLine = (line: string): void => {
    for (const [pattern, handler] of schemaContent) {
      const match = line.match(pattern);
      if (match) {
        handler(line, match);
        break;
      }
    }
    if (
      currentFileChanges &&
      currentFileChanges.oldLines === 0 &&
      currentFileChanges.newLines === 0
    ) {
      currentFileChanges = null;
    }
  };

  const parseHeaderLine = (line: string): void => {
    for (const [pattern, handler] of schemaHeaders) {
      const match = line.match(pattern);
      if (match) {
        handler(line, match);
        break;
      }
    }
  };

  const parseLine = (line: string): void => {
    if (currentFileChanges) {
      parseContentLine(line);
    } else {
      parseHeaderLine(line);
    }
  };

  for (const line of lines) {
    parseLine(line);
  }

  return files;
};

const fileNameDiffRegex =
  /(a|i|w|c|o|1|2)\/.*(?=["']? ["']?(b|i|w|c|o|1|2)\/)|(b|i|w|c|o|1|2)\/.*$/g;
const gitFileHeaderRegex = /^(a|b|i|w|c|o|1|2)\//;

const parseFiles = (line: string): string[] | undefined => {
  const fileNames = line?.match(fileNameDiffRegex);
  return fileNames?.map((fileName) =>
    fileName.replace(gitFileHeaderRegex, "").replace(/("|')$/, "")
  );
};

const quotedFileNameRegex = /^\\?['"]|\\?['"]$/g;

const parseOldOrNewFile = (line: string): string => {
  let fileName = leftTrimChars(line, "-+").trim();
  fileName = removeTimeStamp(fileName);
  return fileName
    .replace(quotedFileNameRegex, "")
    .replace(gitFileHeaderRegex, "");
};

const leftTrimChars = (string: string, trimmingChars?: string): string => {
  const stringValue = makeString(string);
  if (!trimmingChars) {
    return stringValue.trimStart();
  }

  const trimmingString = formTrimmingString(trimmingChars);
  return stringValue.replace(new RegExp(`^${trimmingString}+`), "");
};

const timeStampRegex =
  /\t.*|\d{4}-\d\d-\d\d\s\d\d:\d\d:\d\d(.\d+)?\s(\+|-)\d\d\d\d/;

const removeTimeStamp = (string: string): string => {
  const timeStamp = timeStampRegex.exec(string);
  if (timeStamp) {
    return string.substring(0, timeStamp.index).trim();
  }
  return string;
};

const formTrimmingString = (trimmingChars?: string | RegExp | null): string => {
  if (trimmingChars === null || trimmingChars === undefined) return "\\s";
  if (trimmingChars instanceof RegExp) return trimmingChars.source;
  return `[${makeString(trimmingChars).replace(
    /([.*+?^=!:${}()|[\]/\\])/g,
    "\\$1"
  )}]`;
};

const makeString = (itemToConvert: unknown): string =>
  (itemToConvert ?? "") + "";

export default parseDiff;
export { DiffChange, DiffChunk, ParsedFile } from "./types";
