/**
 * Embedding similarity benchmarking helpers (PLAN.md §3.5).
 *
 * Provides utilities to compare exact and approximate similarity configurations
 * so we can tune defaults against real-world repositories.
 */

import { computeSimilarityGraph } from './similarity.js';

/**
 * Run benchmarking between exact similarity and one or more approximate configs.
 * @param {Object} options
 * @param {Array<Object>} options.functionEmbeddings - Aggregated function embeddings.
 * @param {Object} [options.exactOptions] - Options forwarded to the exact similarity run.
 * @param {Array<Object>} [options.approximateConfigs] - List of approximate configuration objects.
 * @param {number} [options.iterations=1] - Iterations per configuration (averaged).
 * @returns {{baseline: Object, variants: Array<Object>}}
 */
export function runApproximateBenchmark({
  functionEmbeddings,
  exactOptions = {},
  approximateConfigs = [],
  iterations = 1
} = {}) {
  if (!Array.isArray(functionEmbeddings) || functionEmbeddings.length < 2) {
    throw new Error('functionEmbeddings must contain at least two entries.');
  }

  const sanitizedIterations = Math.max(1, Math.floor(iterations));
  const baselineResult = measureSimilarity(functionEmbeddings, {
    ...exactOptions,
    approximate: false,
    approximateThreshold: 0
  });

  const baselineSet = createEdgeSet(baselineResult.edges);
  const variants = (approximateConfigs.length ? approximateConfigs : [buildDefaultApproximateConfig()]).map(
    (config) => {
      const summary = aggregateRuns(sanitizedIterations, () =>
        measureSimilarity(functionEmbeddings, {
          ...exactOptions,
          approximate: true,
          approximateThreshold: 0,
          ...config
        })
      );

      const edgeSet = createEdgeSet(summary.edges);
      const overlap = countOverlap(baselineSet, edgeSet);

      const recall = baselineSet.size ? overlap / baselineSet.size : 1;
      const precision = edgeSet.size ? overlap / edgeSet.size : 1;
      const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
      const jaccard =
        baselineSet.size + edgeSet.size - overlap === 0
          ? 1
          : overlap / (baselineSet.size + edgeSet.size - overlap);

      return {
        name: config?.name ?? 'approximate',
        config,
        stats: summary.stats,
        elapsedMs: summary.elapsedMs,
        averageElapsedMs: summary.elapsedMs / sanitizedIterations,
        speedup: baselineResult.elapsedMs / (summary.elapsedMs / sanitizedIterations),
        edges: summary.edges,
        precision,
        recall,
        f1Score: f1,
        jaccard,
        overlap,
        totalApproximateEdges: edgeSet.size
      };
    }
  );

  return {
    baseline: {
      elapsedMs: baselineResult.elapsedMs,
      stats: baselineResult.stats,
      edges: baselineResult.edges,
      averageElapsedMs: baselineResult.elapsedMs,
      name: 'exact'
    },
    variants
  };
}

/**
 * Helper to aggregate multiple runs (for averaging).
 * @param {number} iterations
 * @param {Function} runner
 * @returns {{elapsedMs: number, stats: Object, edges: Array<Object>}}
 */
function aggregateRuns(iterations, runner) {
  let totalMs = 0;
  let latestStats = null;
  let latestEdges = null;

  for (let i = 0; i < iterations; i++) {
    const result = runner();
    totalMs += result.elapsedMs;
    latestStats = result.stats;
    latestEdges = result.edges;
  }

  return {
    elapsedMs: totalMs,
    stats: latestStats,
    edges: latestEdges
  };
}

/**
 * Execute computeSimilarityGraph while measuring elapsed time.
 * @param {Array<Object>} functionEmbeddings
 * @param {Object} options
 * @returns {{elapsedMs: number, stats: Object, edges: Array<Object>}}
 */
function measureSimilarity(functionEmbeddings, options) {
  const start = now();
  const { edges, stats } = computeSimilarityGraph(functionEmbeddings, options);
  const end = now();
  return {
    edges,
    stats,
    elapsedMs: end - start
  };
}

/**
 * Build a deterministic approximate config that matches default runtime settings.
 */
function buildDefaultApproximateConfig() {
  return {
    name: 'default'
  };
}

/**
 * Create a Set of canonical edge identifiers for overlap comparison.
 * @param {Array<Object>} edges
 * @returns {Set<string>}
 */
function createEdgeSet(edges = []) {
  const set = new Set();
  edges.forEach((edge) => {
    if (!edge?.source || !edge?.target) {
      return;
    }
    set.add(canonicalEdgeKey(edge.source, edge.target));
  });
  return set;
}

/**
 * Count overlapping edges between baseline and approximate results.
 * @param {Set<string>} baseline
 * @param {Set<string>} candidate
 */
function countOverlap(baseline, candidate) {
  if (!baseline.size || !candidate.size) {
    return 0;
  }
  let overlap = 0;
  candidate.forEach((edge) => {
    if (baseline.has(edge)) {
      overlap += 1;
    }
  });
  return overlap;
}

/**
 * Generate a canonical key for an undirected edge.
 * Exported for tests and external tooling.
 * @param {string} source
 * @param {string} target
 * @returns {string}
 */
export function canonicalEdgeKey(source, target) {
  if (typeof source !== 'string' || typeof target !== 'string') {
    return '';
  }
  return source < target ? `${source}::${target}` : `${target}::${source}`;
}

/**
 * Cross-platform high-resolution timestamp.
 */
function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

