/**
 * Function chunking utilities for PLAN.md §3.4
 *
 * Splits function sources into semantically sensible chunks (~100-200 tokens)
 * while preserving source offsets for precise highlighting.
 */

const DEFAULT_MAX_TOKENS = 180;
const DEFAULT_MIN_TOKENS = 60;
const TOKEN_REGEX = /[^\s]+/g;

/**
 * Estimate the token count for a snippet using a lightweight heuristic.
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text) {
    return 0;
  }
  const matches = text.match(TOKEN_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Compute indentation column (number of leading whitespace chars).
 * @param {string} line
 * @returns {number}
 */
function getIndentColumn(line) {
  if (!line) {
    return 0;
  }
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/**
 * Produce chunks for a single function.
 * @param {Object} func - Function metadata from parser extractors.
 * @param {Object} options
 * @param {number} [options.maxTokens]
 * @param {number} [options.minTokens]
 * @returns {Array<Object>}
 */
export function chunkFunction(func, options = {}) {
  if (!func || typeof func.source !== 'string') {
    return [];
  }

  const maxTokens = Math.max(40, options.maxTokens ?? DEFAULT_MAX_TOKENS);
  const minTokens = Math.min(
    Math.max(20, options.minTokens ?? DEFAULT_MIN_TOKENS),
    maxTokens
  );

  const source = func.source;
  const lines = source.split('\n');
  const chunks = [];

  let offset = 0;
  let chunkLines = [];
  let chunkTokenCount = 0;
  let chunkStartOffset = 0;
  let chunkStartLineIndex = 0;
  let chunkFirstLineIndent = 0;

  /**
   * Flush current chunk into the accumulator.
   * @param {number} currentLineIndex - Index of the last line in the chunk.
   * @param {boolean} force - Force flush even if below minTokens.
   */
  const flushChunk = (currentLineIndex, force = false) => {
    if (!chunkLines.length) {
      return;
    }

    const relativeStart = chunkStartOffset;
    const relativeEnd = offset;
    const startLine = func.startLine + chunkStartLineIndex;
    const endLine = func.startLine + currentLineIndex;
    const chunkEndLineIndex = chunkStartLineIndex + chunkLines.length - 1;
    const lastLine = chunkLines[chunkLines.length - 1] ?? '';
    const endColumn =
      chunkEndLineIndex === lines.length - 1
        ? func.endColumn
        : lastLine.length;
    const startColumn =
      chunkStartLineIndex === 0
        ? func.startColumn
        : chunkFirstLineIndent;
    const chunkText = chunkLines.join('\n');

    if (!force && chunkTokenCount < minTokens && chunks.length > 0) {
      const previous = chunks[chunks.length - 1];
      previous.text = `${previous.text}\n${chunkText}`;
      previous.end = func.start + relativeEnd;
      previous.endLine = endLine;
      previous.endColumn = endColumn;
      previous.relativeEnd = relativeEnd;
      previous.tokenCount += chunkTokenCount;
    } else {
      const chunkId = `${func.id}::chunk-${chunks.length}`;
      chunks.push({
        id: chunkId,
        chunkIndex: chunks.length,
        functionId: func.id,
        filePath: func.filePath,
        lang: func.lang,
        start: func.start + relativeStart,
        end: func.start + relativeEnd,
        relativeStart,
        relativeEnd,
        startLine,
        endLine,
        startColumn,
        endColumn,
        tokenCount: chunkTokenCount,
        text: chunkText
      });
    }

    chunkLines = [];
    chunkTokenCount = 0;
    chunkStartOffset = offset;
    chunkStartLineIndex = currentLineIndex + 1;
    chunkFirstLineIndent = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineStartOffset = offset;

    if (!chunkLines.length) {
      chunkStartOffset = lineStartOffset;
      chunkStartLineIndex = lineIndex;
      chunkFirstLineIndent =
        lineIndex === 0 ? func.startColumn : getIndentColumn(line);
    }

    chunkLines.push(line);

    const tokensInLine = estimateTokenCount(line);
    chunkTokenCount += tokensInLine;

    offset += line.length;
    if (lineIndex < lines.length - 1) {
      offset += 1; // Account for newline
    }

    const isBlankLine = line.trim().length === 0;
    const reachedMax = chunkTokenCount >= maxTokens;

    if ((reachedMax || isBlankLine) && chunkLines.length) {
      if (chunkTokenCount === 0 && isBlankLine) {
        // Skip leading blank lines in new chunk
        chunkLines = [];
        chunkStartOffset = offset;
        chunkStartLineIndex = lineIndex + 1;
        chunkFirstLineIndent = 0;
        continue;
      }
      flushChunk(lineIndex, reachedMax);
    }
  }

  if (chunkLines.length) {
    flushChunk(lines.length - 1, true);
  }

  return chunks;
}

/**
 * Chunk a collection of functions.
 * @param {Array<Object>} functions
 * @param {Object} options
 * @returns {{chunks: Array<Object>, stats: Object}}
 */
export function chunkFunctions(functions, options = {}) {
  if (!Array.isArray(functions) || !functions.length) {
    return { chunks: [], stats: { processedFunctions: 0, chunkCount: 0, totalTokens: 0 } };
  }

  const allChunks = [];
  let processedFunctions = 0;
  let totalTokens = 0;

  for (const func of functions) {
    const funcChunks = chunkFunction(func, options);
    if (funcChunks.length) {
      processedFunctions++;
    }
    funcChunks.forEach(chunk => {
      totalTokens += chunk.tokenCount;
      allChunks.push(chunk);
    });
  }

  const chunkCount = allChunks.length;
  const averageTokens = chunkCount ? totalTokens / chunkCount : 0;
  const averageChunksPerFunction = processedFunctions
    ? chunkCount / processedFunctions
    : 0;

  return {
    chunks: allChunks,
    stats: {
      processedFunctions,
      chunkCount,
      totalTokens,
      averageTokens,
      averageChunksPerFunction
    }
  };
}

export const chunkingDefaults = {
  maxTokens: DEFAULT_MAX_TOKENS,
  minTokens: DEFAULT_MIN_TOKENS
};

