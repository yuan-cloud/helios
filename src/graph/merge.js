/**
 * Helpers to consolidate parser and embedding outputs into a single payload
 * that can be consumed by the Graphology pipeline.
 */

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // fall through to JSON clone
    }
  }
  if (value === null || value === undefined) {
    return value ?? null;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeFunction(fn) {
  if (!fn || typeof fn !== 'object') {
    return null;
  }
  const copy = cloneValue(fn);
  copy.id = copy.id ?? copy.functionId ?? null;
  copy.functionId = copy.functionId ?? copy.id ?? null;
  copy.name = copy.name || copy.fqName || copy.id || '';
  copy.lang = copy.lang || null;
  copy.filePath = copy.filePath || null;
  copy.moduleId = copy.moduleId || null;
  if (copy.range && typeof copy.range === 'object') {
    copy.range = {
      start: copy.range.start ?? null,
      end: copy.range.end ?? null,
      startLine: copy.range.startLine ?? copy.startLine ?? null,
      endLine: copy.range.endLine ?? copy.endLine ?? null,
      startColumn: copy.range.startColumn ?? copy.startColumn ?? null,
      endColumn: copy.range.endColumn ?? copy.endColumn ?? null
    };
  }
  return copy;
}

function upsertFunction(map, fn) {
  const normalized = normalizeFunction(fn);
  if (!normalized || !normalized.id) {
    return;
  }
  if (!map.has(normalized.id)) {
    map.set(normalized.id, normalized);
    return;
  }
  const existing = map.get(normalized.id);
  const merged = {
    ...existing,
    ...normalized,
    metrics: {
      ...(existing.metrics || {}),
      ...(normalized.metrics || {})
    }
  };
  map.set(normalized.id, merged);
}

function cloneEdge(edge) {
  if (!edge || typeof edge !== 'object') {
    return null;
  }
  const copy = cloneValue(edge);
  if (copy.source === undefined) {
    copy.source = copy.from ?? null;
  }
  if (copy.target === undefined) {
    copy.target = copy.to ?? null;
  }
  return copy;
}

/**
 * Merge parser + embedding payloads into unified graph payload.
 * @param {Object} input
 * @param {Object} [input.parser]
 * @param {Object} [input.embeddings]
 * @param {Array} [input.overrides.functions]
 * @param {Array} [input.overrides.callEdges]
 * @param {Array} [input.overrides.similarityEdges]
 * @returns {{
 *   functions: Array<Object>,
 *   callEdges: Array<Object>,
 *   similarityEdges: Array<Object>,
 *   extras: {
 *     parserStats?: Object,
 *     symbolTables?: Object,
 *     parserPayload?: Object,
 *     embeddingSummary?: Object
 *   }
 * }}
 */
export function mergeGraphPayload({
  parser = {},
  embeddings = {},
  overrides = {}
} = {}) {
  const functionMap = new Map();

  const parserFunctions = Array.isArray(parser.functions) ? parser.functions : [];
  parserFunctions.forEach(fn => upsertFunction(functionMap, fn));

  const embeddingFunctions = Array.isArray(embeddings.functionEmbeddings)
    ? embeddings.functionEmbeddings.map(entry => entry.function)
    : Array.isArray(embeddings.functions)
      ? embeddings.functions
      : [];
  embeddingFunctions.forEach(fn => upsertFunction(functionMap, fn));

  const overrideFunctions = Array.isArray(overrides.functions) ? overrides.functions : [];
  overrideFunctions.forEach(fn => upsertFunction(functionMap, fn));

  const callEdges = [];
  const parserCallEdges = Array.isArray(parser.callEdges) ? parser.callEdges : [];
  parserCallEdges.forEach(edge => {
    const cloned = cloneEdge(edge);
    if (cloned?.source && cloned?.target) {
      callEdges.push(cloned);
    }
  });

  const overrideCallEdges = Array.isArray(overrides.callEdges) ? overrides.callEdges : [];
  overrideCallEdges.forEach(edge => {
    const cloned = cloneEdge(edge);
    if (cloned?.source && cloned?.target) {
      callEdges.push(cloned);
    }
  });

  const similarityEdges = [];
  const embeddingEdges = Array.isArray(embeddings.similarityEdges)
    ? embeddings.similarityEdges
    : [];
  embeddingEdges.forEach(edge => {
    const cloned = cloneEdge(edge);
    if (cloned?.source && cloned?.target) {
      similarityEdges.push(cloned);
    }
  });

  const overrideSimilarityEdges = Array.isArray(overrides.similarityEdges)
    ? overrides.similarityEdges
    : [];
  overrideSimilarityEdges.forEach(edge => {
    const cloned = cloneEdge(edge);
    if (cloned?.source && cloned?.target) {
      similarityEdges.push(cloned);
    }
  });

  return {
    functions: Array.from(functionMap.values()),
    callEdges,
    similarityEdges,
    extras: {
      parserStats: parser.stats ? cloneValue(parser.stats) : null,
      symbolTables: parser.symbolTables ? cloneValue(parser.symbolTables) : null,
      parserPayload: parser ? cloneValue(parser) : null,
      embeddingSummary: embeddings.metadata
        ? cloneValue({
            metadata: embeddings.metadata,
            stats: embeddings.stats || embeddings.summary || null
          })
        : null
    }
  };
}


