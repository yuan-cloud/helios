// High-level helpers for persisting and restoring analysis snapshots so the UI
// can resume instantly from OPFS-backed SQLite without re-running the full
// pipeline. Snapshots are stored in the KV table as JSON blobs and capture
// just enough information for the visualization layer to hydrate graph data,
// similarity edges, and embedding summaries.

import { StorageWorkerClient } from "./client.js";

const SNAPSHOT_KEY = "analysis.snapshot.v1";
export const SNAPSHOT_VERSION = 1;
const MAX_SOURCE_CHAR_LENGTH = 8_192;
const MAX_SOURCE_LINES = 400;

function cloneStructured(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return null;
  }
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function sanitizeSourceFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }
  const moduleAliases = Array.isArray(file.moduleAliases)
    ? Array.from(new Set(file.moduleAliases.filter(Boolean)))
    : [];
  return {
    path: file.path || "",
    language: file.language || null,
    moduleId: file.moduleId || null,
    moduleAliases,
  };
}

function sanitizeFunction(fn, options = {}) {
  if (!fn || typeof fn !== "object") {
    return null;
  }
  const {
    includeSource = true,
    sourceCharLimit = MAX_SOURCE_CHAR_LENGTH,
    sourceLineLimit = MAX_SOURCE_LINES,
  } = options;

  let source = null;
  let sourceTruncated = false;

  if (includeSource && typeof fn.source === "string" && fn.source.length) {
    const trimmed = trimSource(fn.source, sourceCharLimit, sourceLineLimit);
    source = trimmed.text;
    sourceTruncated = trimmed.truncated;
  }

  return {
    id: fn.id,
    name: fn.name || "<anonymous>",
    filePath: fn.filePath || "",
    lang: fn.lang || null,
    moduleId: fn.moduleId || null,
    isVirtual: !!fn.isVirtual,
    start: Number.isFinite(fn.start) ? fn.start : null,
    end: Number.isFinite(fn.end) ? fn.end : null,
    startLine: Number.isFinite(fn.startLine) ? fn.startLine : null,
    endLine: Number.isFinite(fn.endLine) ? fn.endLine : null,
    startColumn: Number.isFinite(fn.startColumn) ? fn.startColumn : null,
    endColumn: Number.isFinite(fn.endColumn) ? fn.endColumn : null,
    loc: Number.isFinite(fn.loc) ? fn.loc : null,
    doc: fn.doc || null,
    metrics: fn.metrics || null,
    source,
    sourceTruncated: source ? sourceTruncated : false,
  };
}

function sanitizeCallSites(sites) {
  if (!Array.isArray(sites)) {
    return null;
  }
  const sanitized = [];
  for (let i = 0; i < sites.length && sanitized.length < 10; i += 1) {
    const site = sites[i];
    if (!site || typeof site !== "object") {
      continue;
    }
    sanitized.push({
      file: site.file || null,
      line: Number.isFinite(site.line) ? site.line : null,
      column: Number.isFinite(site.column) ? site.column : null,
    });
  }
  return sanitized.length ? sanitized : null;
}

function sanitizeResolution(resolution) {
  if (!resolution || typeof resolution !== "object") {
    return null;
  }
  const matches = Array.isArray(resolution.matches)
    ? resolution.matches.slice(0, 12).map((match) => ({
        id: match?.id ?? null,
        name: match?.name ?? null,
        filePath: match?.filePath ?? null,
        moduleId: match?.moduleId ?? null,
        matchType: match?.matchType ?? null,
        confidence: match?.confidence ?? null,
      }))
    : null;
  return {
    status: resolution.status || null,
    reason: resolution.reason || null,
    matchCount: Number.isFinite(resolution.matchCount)
      ? resolution.matchCount
      : matches
        ? matches.length
        : null,
    matches,
    selectedMatch: resolution.selectedMatch || null,
    importInfo: resolution.importInfo || null,
    calleeName: resolution.calleeName || null,
  };
}

function sanitizeCallEdge(edge) {
  if (!edge || typeof edge !== "object") {
    return null;
  }
  const metadata = edge.metadata || null;
  const sanitizedResolution = sanitizeResolution(edge.resolution || metadata?.resolution);
  const sanitizedCallSites = sanitizeCallSites(edge.callSites || metadata?.callSiteSamples);

  const sanitizedMetadata =
    metadata || sanitizedCallSites || sanitizedResolution
      ? {
          callSites: sanitizedCallSites,
          resolution: sanitizedResolution,
        }
      : null;

  return {
    source: edge.source,
    target: edge.target,
    weight: Number.isFinite(edge.weight) ? edge.weight : 1,
    isDynamic: !!edge.isDynamic,
    resolution: sanitizedResolution,
    callSites: sanitizedCallSites,
    metadata: sanitizedMetadata,
  };
}

function sanitizeCallGraph(callGraph = {}) {
  const nodes = toArray(callGraph.nodes)
    .map((fn) => sanitizeFunction(fn))
    .filter(Boolean);
  const edges = toArray(callGraph.edges)
    .map((edge) => sanitizeCallEdge(edge))
    .filter(Boolean);
  return {
    nodes,
    edges,
    stats: callGraph.stats || null,
  };
}

function sanitizeSimilarityEdge(edge) {
  if (!edge || typeof edge !== "object") {
    return null;
  }
  return {
    source: edge.source,
    target: edge.target,
    similarity: Number.isFinite(edge.similarity)
      ? edge.similarity
      : Number.isFinite(edge.representativeSimilarity)
        ? edge.representativeSimilarity
        : 0,
    representativeSimilarity: Number.isFinite(edge.representativeSimilarity)
      ? edge.representativeSimilarity
      : null,
    method: edge.method || null,
    topPairs: Array.isArray(edge.topPairs) ? edge.topPairs.slice(0, 20) : null,
  };
}

function sanitizeEmbeddingSummary(summary = {}) {
  return {
    cached: !!summary.cached,
    metadata: summary.metadata || null,
    reuse: summary.reuse || null,
    chunkCount: Number.isFinite(summary.chunkCount) ? summary.chunkCount : null,
    similarityEdgeCount: Number.isFinite(summary.similarityEdges)
      ? summary.similarityEdges
      : null,
    stats: summary.stats || null,
    error: summary.error || null,
  };
}

function sanitizeSnapshotPayload(data = {}) {
  const sourceFiles = toArray(data.sourceFiles)
    .map(sanitizeSourceFile)
    .filter(Boolean);

  const callGraph = sanitizeCallGraph(data.callGraph || {});
  const similarityEdges = toArray(data.similarityEdges)
    .map(sanitizeSimilarityEdge)
    .filter(Boolean);

  const nonVirtualFunctions = callGraph.nodes.filter((fn) => !fn.isVirtual);

  const embeddingSummary = sanitizeEmbeddingSummary({
    cached: data.embedding?.cached ?? data.usedCachedEmbeddings ?? false,
    metadata: data.embedding?.metadata || data.embeddingMetadata || null,
    reuse:
      data.embedding?.reuse ||
      data.embeddingReuseCounts || {
        reused: 0,
        embedded: 0,
      },
    chunkCount:
      data.embedding?.chunkCount ?? data.embeddingChunksLength ?? null,
    similarityEdges: similarityEdges.length,
    stats: data.embedding?.stats || data.embeddingStats || null,
    error: data.embedding?.error || data.embeddingError || null,
  });

  const graph = sanitizeGraphSnapshot(data.graph || {});

  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    fingerprint: data.embeddingFingerprint || null,
    functionFingerprints: data.functionFingerprintMap || null,
    layoutKey: data.layoutKey || null,
    project: {
      label: data.projectLabel || null,
    },
    sourceFiles,
    functions: nonVirtualFunctions,
    callGraph,
    similarityEdges,
    embedding: embeddingSummary,
    graph,
    stats: {
      functionCount: nonVirtualFunctions.length,
      callEdgeCount: callGraph.edges.length,
      similarityEdgeCount: similarityEdges.length,
      callGraphStats: callGraph.stats || null,
      graphSummary: graph?.summary || null,
    },
  };
}

function resolveClient(input) {
  if (input instanceof StorageWorkerClient) {
    return input;
  }
  if (
    input &&
    typeof input.ensureInitialized === "function" &&
    typeof input.setKv === "function" &&
    typeof input.getKv === "function"
  ) {
    return input;
  }
  return new StorageWorkerClient(input || {});
}

export async function saveAnalysisSnapshot(clientInput, payload) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("Snapshot payload must be an object");
  }
  const client = resolveClient(clientInput);
  await client.ensureInitialized();
  const snapshot = sanitizeSnapshotPayload(payload);
  await client.setKv(SNAPSHOT_KEY, snapshot);
  return snapshot;
}

export async function loadAnalysisSnapshot(clientInput) {
  const client = resolveClient(clientInput);
  await client.ensureInitialized();
  const snapshot = await client.getKv(SNAPSHOT_KEY);
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  // Validate snapshot version - return null if version mismatch to trigger regeneration
  if (snapshot.version !== SNAPSHOT_VERSION) {
    console.warn(
      `[Resume] Snapshot version mismatch: stored ${snapshot.version}, expected ${SNAPSHOT_VERSION}. Snapshot will be regenerated.`
    );
    // Clear incompatible snapshot
    await clearAnalysisSnapshot(client);
    return null;
  }
  return snapshot;
}

export async function clearAnalysisSnapshot(clientInput) {
  const client = resolveClient(clientInput);
  await client.ensureInitialized();
  // Set to null rather than deleting the row to keep schema simple.
  await client.setKv(SNAPSHOT_KEY, null);
}

export const ANALYSIS_SNAPSHOT_KEY = SNAPSHOT_KEY;

function trimSource(source, maxChars, maxLines) {
  let truncated = false;
  let text = source;

  if (Number.isFinite(maxLines) && maxLines > 0) {
    const lines = text.split(/\r?\n/);
    if (lines.length > maxLines) {
      text = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }
  }

  if (Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return { text, truncated };
}

function sanitizeGraphSnapshot(graph = {}) {
  if (!graph || typeof graph !== "object") {
    return null;
  }

  const payloadFunctions = toArray(graph.payload?.functions)
    .map((fn) => sanitizeFunction(fn))
    .filter(Boolean);
  const payloadCallEdges = toArray(graph.payload?.callEdges)
    .map((edge) => sanitizeCallEdge(edge))
    .filter(Boolean);
  const payloadSimilarity = toArray(graph.payload?.similarityEdges)
    .map((edge) => sanitizeSimilarityEdge(edge))
    .filter(Boolean);
  const payloadExtras = graph.payload?.extras
    ? cloneStructured(graph.payload.extras)
    : null;

  const payload =
    payloadFunctions.length || payloadCallEdges.length || payloadSimilarity.length || payloadExtras
      ? {
          functions: payloadFunctions,
          callEdges: payloadCallEdges,
          similarityEdges: payloadSimilarity,
          extras: payloadExtras,
        }
      : null;

  const summary =
    graph.summary && typeof graph.summary === "object"
      ? cloneStructured(graph.summary)
      : null;

  const serialized =
    graph.serialized && typeof graph.serialized === "object"
      ? {
          nodes: Array.isArray(graph.serialized.nodes)
            ? cloneStructured(graph.serialized.nodes)
            : [],
          edges: Array.isArray(graph.serialized.edges)
            ? cloneStructured(graph.serialized.edges)
            : [],
        }
      : null;

  const extras =
    graph.extras && typeof graph.extras === "object"
      ? cloneStructured(graph.extras)
      : payloadExtras;

  if (!payload && !summary && !serialized && !extras) {
    return null;
  }

  return {
    payload,
    summary,
    serialized,
    extras,
  };
}

