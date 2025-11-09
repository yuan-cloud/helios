// High-level helpers for persisting and restoring analysis snapshots so the UI
// can resume instantly from OPFS-backed SQLite without re-running the full
// pipeline. Snapshots are stored in the KV table as JSON blobs and capture
// just enough information for the visualization layer to hydrate graph data,
// similarity edges, and embedding summaries.

import { StorageWorkerClient } from "./client.js";

const SNAPSHOT_KEY = "analysis.snapshot.v1";
const SNAPSHOT_VERSION = 1;

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

function sanitizeFunction(fn) {
  if (!fn || typeof fn !== "object") {
    return null;
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
  };
}

function sanitizeCallGraph(callGraph = {}) {
  const nodes = toArray(callGraph.nodes)
    .map(sanitizeFunction)
    .filter(Boolean);
  const edges = toArray(callGraph.edges).map((edge) => {
    if (!edge || typeof edge !== "object") {
      return null;
    }
    const metadata = edge.metadata || null;
    const resolution = metadata?.resolution || null;
    return {
      source: edge.source,
      target: edge.target,
      weight: Number.isFinite(edge.weight) ? edge.weight : 1,
      isDynamic: !!edge.isDynamic,
      metadata: metadata
        ? {
            callSites: Array.isArray(metadata.callSiteSamples)
              ? metadata.callSiteSamples.slice(0, 10)
              : null,
            resolution: resolution
              ? {
                  status: resolution.status || null,
                  reason: resolution.reason || null,
                  matchCount: Number.isFinite(resolution.matchCount)
                    ? resolution.matchCount
                    : null,
                  matches: Array.isArray(resolution.matches)
                    ? resolution.matches.slice(0, 12).map((match) => ({
                        id: match.id,
                        name: match.name,
                        filePath: match.filePath,
                        moduleId: match.moduleId || null,
                        matchType: match.matchType || null,
                        confidence: match.confidence || null,
                      }))
                    : null,
                  selectedMatch: resolution.selectedMatch || null,
                  importInfo: resolution.importInfo || null,
                  calleeName: resolution.calleeName || null,
                }
              : null,
          }
        : null,
    };
  });
  return {
    nodes,
    edges: edges.filter(Boolean),
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
    stats: {
      functionCount: nonVirtualFunctions.length,
      callEdgeCount: callGraph.edges.length,
      similarityEdgeCount: similarityEdges.length,
      callGraphStats: callGraph.stats || null,
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
  if (snapshot.version !== SNAPSHOT_VERSION) {
    return snapshot;
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

