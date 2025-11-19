/**
 * Graphology-based construction utilities for HELIOS graph analysis.
 * Follows PLAN.md §3.6 and §10.4 specifications for assembling
 * function nodes plus call and similarity edges into a single graph.
 */

// Workers don't inherit import maps, so check for globally-provided graphology first
// The worker will set self.__graphology before importing this module
// In main thread, this will be undefined and we'll use the normal import (via import map)
import GraphDefault from 'graphology';
const Graph = (typeof self !== 'undefined' && self.__graphology) || GraphDefault;

export const EDGE_LAYERS = {
  CALL: 'call',
  SIMILARITY: 'similarity'
};

const DEFAULT_GRAPH_OPTIONS = {
  allowVirtualNodes: true,
  dropDanglingEdges: true,
  normalizeNodeId: id => String(id)
};

/**
 * Build a mixed Graphology graph from parser + embedding outputs.
 *
 * @param {Object} payload
 * @param {Array<Object>} payload.functions - Function metadata.
 * @param {Array<Object>} payload.callEdges - Directed call edges (parser output).
 * @param {Array<Object>} payload.similarityEdges - Undirected similarity edges (embedding output).
 * @param {Object} [payload.options] - Builder options.
 * @returns {{ graph: Graph, summary: Object, idLookup: Map<string, string> }}
 */
export function buildFunctionGraph(payload) {
  const {
    functions = [],
    callEdges = [],
    similarityEdges = [],
    options = {}
  } = payload || {};

  const config = {
    ...DEFAULT_GRAPH_OPTIONS,
    ...(options || {})
  };

  const graph = new Graph({
    type: 'mixed',
    multi: true,
    allowSelfLoops: false
  });

  const idLookup = new Map(); // rawId (stringified) -> graph node key
  const nodeStats = new Map(); // nodeKey -> metrics accumulator
  const summary = {
    nodes: {
      total: Array.isArray(functions) ? functions.length : 0,
      added: 0,
      skipped: 0,
      duplicates: 0
    },
    callEdges: {
      total: Array.isArray(callEdges) ? callEdges.length : 0,
      added: 0,
      skippedMissingNode: 0,
      skippedSelfLoop: 0
    },
    similarityEdges: {
      total: Array.isArray(similarityEdges) ? similarityEdges.length : 0,
      added: 0,
      skippedMissingNode: 0,
      skippedSelfLoop: 0
    }
  };

  if (!Array.isArray(functions) || !Array.isArray(callEdges) || !Array.isArray(similarityEdges)) {
    throw new TypeError('Invalid graph input: expected arrays for functions, callEdges, and similarityEdges');
  }

  functions.forEach(fn => {
    const rawId = fn?.id ?? fn?.functionId ?? null;
    const normalizedId = rawId !== null ? config.normalizeNodeId(rawId) : null;

    if (!normalizedId) {
      summary.nodes.skipped += 1;
      return;
    }

    if (idLookup.has(normalizedId)) {
      summary.nodes.duplicates += 1;
      return;
    }

    if (fn.isVirtual && config.allowVirtualNodes === false) {
      summary.nodes.skipped += 1;
      return;
    }

    const attributes = buildNodeAttributes(fn);
    graph.addNode(normalizedId, attributes);
    idLookup.set(normalizedId, normalizedId);
    nodeStats.set(normalizedId, createEmptyNodeStats());
    summary.nodes.added += 1;
  });

  for (const edge of callEdges) {
    addCallEdge(graph, nodeStats, idLookup, edge, summary, config);
  }

  for (const edge of similarityEdges) {
    addSimilarityEdge(graph, nodeStats, idLookup, edge, summary, config);
  }

  // Persist accumulated metrics back onto nodes.
  for (const [nodeKey, stats] of nodeStats.entries()) {
    if (!graph.hasNode(nodeKey)) {
      continue;
    }
    graph.setNodeAttribute(nodeKey, 'metrics', {
      ...(graph.getNodeAttribute(nodeKey, 'metrics') || {}),
      callInDegree: stats.callInDegree,
      callOutDegree: stats.callOutDegree,
      callInWeight: stats.callInWeight,
      callOutWeight: stats.callOutWeight,
      similarityDegree: stats.similarityDegree,
      layers: {
        call: {
          in: stats.callInDegree,
          out: stats.callOutDegree,
          inWeight: stats.callInWeight,
          outWeight: stats.callOutWeight
        },
        similarity: {
          degree: stats.similarityDegree,
          weight: stats.similarityWeight
        }
      }
    });
  }

  return {
    graph,
    summary,
    idLookup
  };
}

function buildNodeAttributes(fn) {
  const fqName = fn?.fqName || fn?.name || fn?.id || '';
  return {
    functionId: fn?.id ?? null,
    name: fn?.name || fqName,
    fqName,
    filePath: fn?.filePath || null,
    moduleId: fn?.moduleId || null,
    lang: fn?.lang || 'unknown',
    isVirtual: Boolean(fn?.isVirtual),
    loc: fn?.loc ?? null,
    range: {
      start: fn?.start ?? null,
      end: fn?.end ?? null,
      startLine: fn?.startLine ?? null,
      endLine: fn?.endLine ?? null
    },
    doc: fn?.doc || '',
    metrics: {
      callInDegree: 0,
      callOutDegree: 0,
      callInWeight: 0,
      callOutWeight: 0,
      similarityDegree: 0,
      similarityWeight: 0
    },
    metadata: fn?.metadata || null,
    tags: fn?.tags || [],
    source: fn?.source || null
  };
}

function createEmptyNodeStats() {
  return {
    callInDegree: 0,
    callOutDegree: 0,
    callInWeight: 0,
    callOutWeight: 0,
    similarityDegree: 0,
    similarityWeight: 0
  };
}

function addCallEdge(graph, nodeStats, idLookup, edge, summary, config) {
  if (!edge) {
    summary.callEdges.skippedMissingNode += 1;
    return;
  }

  const sourceKey = idLookup.get(config.normalizeNodeId(edge.source));
  const targetKey = idLookup.get(config.normalizeNodeId(edge.target));

  if (!sourceKey || !targetKey) {
    if (config.dropDanglingEdges !== false) {
      summary.callEdges.skippedMissingNode += 1;
      return;
    }
    return;
  }

  if (sourceKey === targetKey) {
    summary.callEdges.skippedSelfLoop += 1;
    return;
  }

  const weight = Number.isFinite(edge.weight) ? Number(edge.weight) : 1;
  const isDynamic = Boolean(edge.isDynamic);

  const {
    source: _ignoredSource,
    target: _ignoredTarget,
    weight: _ignoredWeight,
    isDynamic: _ignoredDynamic,
    metadata,
    ...rest
  } = edge;

  const extraAttributes = {};
  Object.keys(rest || {}).forEach(key => {
    const value = rest[key];
    if (value !== undefined) {
      extraAttributes[key] = value;
    }
  });

  if (!extraAttributes.resolution && metadata?.resolution) {
    extraAttributes.resolution = metadata.resolution;
  }
  if (!extraAttributes.callSites && metadata?.callSiteSamples) {
    extraAttributes.callSites = metadata.callSiteSamples;
  }

  const attributes = {
    layer: EDGE_LAYERS.CALL,
    weight,
    isDynamic,
    metadata: metadata || null,
    ...extraAttributes
  };

  const edgeKey = `call:${sourceKey}->${targetKey}`;
  graph.mergeDirectedEdgeWithKey(edgeKey, sourceKey, targetKey, attributes);
  summary.callEdges.added += 1;

  const sourceStats = nodeStats.get(sourceKey);
  if (sourceStats) {
    sourceStats.callOutDegree += 1;
    sourceStats.callOutWeight += weight;
  }

  const targetStats = nodeStats.get(targetKey);
  if (targetStats) {
    targetStats.callInDegree += 1;
    targetStats.callInWeight += weight;
  }
}

function addSimilarityEdge(graph, nodeStats, idLookup, edge, summary, config) {
  if (!edge) {
    summary.similarityEdges.skippedMissingNode += 1;
    return;
  }

  const sourceKey = idLookup.get(config.normalizeNodeId(edge.source));
  const targetKey = idLookup.get(config.normalizeNodeId(edge.target));

  if (!sourceKey || !targetKey) {
    if (config.dropDanglingEdges !== false) {
      summary.similarityEdges.skippedMissingNode += 1;
      return;
    }
    return;
  }

  if (sourceKey === targetKey) {
    summary.similarityEdges.skippedSelfLoop += 1;
    return;
  }

  const similarity = Number.isFinite(edge.similarity) ? Number(edge.similarity) : null;
  const attributes = {
    layer: EDGE_LAYERS.SIMILARITY,
    similarity,
    method: edge.method || null,
    representativeSimilarity: Number.isFinite(edge.representativeSimilarity)
      ? Number(edge.representativeSimilarity)
      : null,
    topPairs: Array.isArray(edge.topPairs) ? edge.topPairs : null
  };

  const edgeKey = sourceKey < targetKey
    ? `sim:${sourceKey}::${targetKey}`
    : `sim:${targetKey}::${sourceKey}`;

  graph.mergeUndirectedEdgeWithKey(edgeKey, sourceKey, targetKey, attributes);
  summary.similarityEdges.added += 1;

  const sourceStats = nodeStats.get(sourceKey);
  if (sourceStats) {
    sourceStats.similarityDegree += 1;
    sourceStats.similarityWeight += similarity ?? 0;
  }

  const targetStats = nodeStats.get(targetKey);
  if (targetStats) {
    targetStats.similarityDegree += 1;
    targetStats.similarityWeight += similarity ?? 0;
  }
}


