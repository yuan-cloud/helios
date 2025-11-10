/**
 * Graph ingestion and analysis pipeline for HELIOS.
 *
 * Combines parser + embeddings outputs, builds the Graphology instance,
 * and runs network analysis so downstream layers (viz/storage) can
 * consume enriched metrics.
 */

import { buildFunctionGraph } from './graph-builder.js';
import { computeCentralities } from '../analysis/centralities.js';
import { computeCommunities } from '../analysis/communities.js';
import { analyzeCliquesAndCores } from '../analysis/cliques.js';

const DEFAULT_GLOBAL_SOURCES = {
  functions: ['heliosFunctions', 'heliosCallGraph?.nodes'],
  callEdges: ['heliosCallGraph?.edges', 'heliosCallEdges'],
  similarityEdges: ['heliosSimilarityEdges', 'heliosFunctionSimilarity?.edges']
};

/**
 * Collect payload pieces from explicit sources or window globals.
 * @param {Object} [sources]
 * @param {Array<Object>} [sources.functions]
 * @param {Array<Object>} [sources.callEdges]
 * @param {Array<Object>} [sources.similarityEdges]
 * @returns {{functions:Array, callEdges:Array, similarityEdges:Array}}
 */
export function collectGraphPayload(sources = {}) {
  const fromSources = {
    functions: normalizeArray(sources.functions),
    callEdges: normalizeArray(sources.callEdges),
    similarityEdges: normalizeArray(sources.similarityEdges)
  };

  if (!isBrowser() || isCompletePayload(fromSources)) {
    return fromSources;
  }

  const globalObject = getGlobalObject();
  if (!globalObject) {
    return fromSources;
  }

  const resolved = { ...fromSources };

  if (!resolved.functions) {
    resolved.functions = resolveFromGlobals(globalObject, DEFAULT_GLOBAL_SOURCES.functions);
  }
  if (!resolved.callEdges) {
    resolved.callEdges = resolveFromGlobals(globalObject, DEFAULT_GLOBAL_SOURCES.callEdges);
  }
  if (!resolved.similarityEdges) {
    resolved.similarityEdges = resolveFromGlobals(globalObject, DEFAULT_GLOBAL_SOURCES.similarityEdges);
  }

  return resolved;
}

/**
 * Build the Graphology instance and run network analysis.
 * @param {Object} payload - Combined graph payload (functions, callEdges, similarityEdges).
 * @param {Object} [options]
 * @param {boolean} [options.assignMetrics=true] - Whether to write computed metrics back to graph nodes.
 * @param {Object} [options.analysis] - Per-metric options (centrality, communities, cliques).
 * @returns {{
 *   graph: import('graphology').default,
 *   summary: {
 *     build: Object,
 *     centrality: Object,
 *     communities: Object,
 *     cliques: Object
 *   }
 * }}
 */
export function buildAnalyzedGraph(payload, options = {}) {
  const { assignMetrics = true, analysis = {} } = options;
  const { functions = [], callEdges = [], similarityEdges = [] } = payload || {};

  const buildResult = buildFunctionGraph({
    functions,
    callEdges,
    similarityEdges,
    options: analysis.builder
  });

  const { graph, summary: buildSummary } = buildResult;

  const centrality = computeCentralities(graph, {
    assign: assignMetrics,
    pageRank: analysis.pageRank
  });

  const communities = computeCommunities(graph, {
    assign: assignMetrics,
    ...analysis.communities
  });

  const cliques = analyzeCliquesAndCores(graph, {
    assign: assignMetrics,
    ...analysis.cliques
  });

  return {
    graph,
    summary: {
      build: buildSummary,
      centrality,
      communities,
      cliques
    }
  };
}

/**
 * Extract a serializable representation of the analyzed graph for viz/storage.
 * @param {import('graphology').default} graph
 * @returns {{nodes:Array<Object>, edges:Array<Object>}}
 */
export function serializeGraph(graph) {
  if (!graph || typeof graph.forEachNode !== 'function') {
    return { nodes: [], edges: [] };
  }

  const nodes = [];
  graph.forEachNode((node, attributes) => {
    nodes.push({
      id: node,
      ...attributes
    });
  });

  const edges = [];
  graph.forEachEdge((edgeKey, attributes, source, target, sourceAttr, targetAttr, undirected) => {
    edges.push({
      key: edgeKey,
      source,
      target,
      undirected: Boolean(undirected),
      ...attributes,
      sourceAttributes: sourceAttr || null,
      targetAttributes: targetAttr || null
    });
  });

  return { nodes, edges };
}

function normalizeArray(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object' && typeof value.length === 'number') {
    return Array.from(value);
  }
  return null;
}

function isCompletePayload(payload) {
  return Boolean(payload.functions && payload.callEdges && payload.similarityEdges);
}

function resolveFromGlobals(globalObject, paths) {
  for (const path of paths) {
    const value = resolvePath(globalObject, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function resolvePath(root, path) {
  if (!path) {
    return undefined;
  }
  const segments = path.split('.');
  let current = root;
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.endsWith('?')) {
      const clean = segment.slice(0, -1);
      current = current?.[clean];
    } else {
      current = current?.[segment];
    }
    if (current === undefined || current === null) {
      return undefined;
    }
  }
  return current;
}

function isBrowser() {
  return typeof window !== 'undefined' || typeof self !== 'undefined';
}

function getGlobalObject() {
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof self !== 'undefined') {
    return self;
  }
  return null;
}


