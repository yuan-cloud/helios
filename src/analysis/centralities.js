/**
 * Centrality metrics for HELIOS graph analysis.
 * Implements degree, betweenness (Brandes), and PageRank centralities.
 */

import { assertGraph, buildNeighborSets, mergeNodeMetrics } from './utils.js';

const DEFAULT_PAGERANK_OPTIONS = {
  damping: 0.85,
  tolerance: 1e-6,
  maxIterations: 100
};

/**
 * Compute degree, betweenness, and PageRank centralities.
 * @param {Graph} graph
 * @param {Object} [options]
 * @param {boolean} [options.assign=true] - Whether to write metrics back to node attributes.
 * @returns {{
 *   degree: Record<string, {in: number, out: number, total: number, normalized: number}>,
 *   betweenness: Record<string, number>,
 *   pageRank: Record<string, number>
 * }}
 */
export function computeCentralities(graph, options = {}) {
  assertGraph(graph);
  const assign = options.assign !== false;
  const nodes = graph.nodes();
  const order = nodes.length;

  if (!order) {
    return {
      degree: {},
      betweenness: {},
      pageRank: {}
    };
  }

  const degree = computeDegreeCentrality(graph, nodes, order);
  const betweenness = computeBetweennessCentrality(graph, nodes);
  const pageRank = computePageRankCentrality(graph, nodes, options.pageRank);

  if (assign) {
    nodes.forEach(node => {
      mergeNodeMetrics(graph, node, {
        centrality: {
          degree: degree[node] || {
            in: 0,
            out: 0,
            total: 0,
            normalized: 0
          },
          betweenness: betweenness[node] ?? 0,
          pageRank: pageRank[node] ?? 0
        }
      });
    });
  }

  return {
    degree,
    betweenness,
    pageRank
  };
}

function computeDegreeCentrality(graph, nodes, order) {
  const maxDegree = Math.max(order - 1, 1);
  const result = {};

  nodes.forEach(node => {
    const inDegree = graph.inDegree ? graph.inDegree(node) || 0 : 0;
    const outDegree = graph.outDegree ? graph.outDegree(node) || 0 : 0;
    const undirectedDegree = graph.undirectedDegree ? graph.undirectedDegree(node) || 0 : 0;
    const total = inDegree + outDegree + undirectedDegree;
    result[node] = {
      in: inDegree,
      out: outDegree,
      undirected: undirectedDegree,
      total,
      normalized: total / maxDegree
    };
  });

  return result;
}

function computeBetweennessCentrality(graph, nodes) {
  const betweenness = {};
  const order = nodes.length;

  nodes.forEach(node => {
    betweenness[node] = 0;
  });

  if (order < 3) {
    return betweenness;
  }

  const neighborSets = buildNeighborSets(graph);

  nodes.forEach(source => {
    const stack = [];
    const predecessors = new Map();
    const sigma = new Map();
    const distance = new Map();
    const queue = [];

    nodes.forEach(node => {
      predecessors.set(node, []);
      sigma.set(node, 0);
      distance.set(node, -1);
    });

    sigma.set(source, 1);
    distance.set(source, 0);
    queue.push(source);

    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      const neighbors = neighborSets.get(v);
      if (!neighbors) continue;
      neighbors.forEach(w => {
        if (distance.get(w) < 0) {
          distance.set(w, distance.get(v) + 1);
          queue.push(w);
        }
        if (distance.get(w) === distance.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          predecessors.get(w).push(v);
        }
      });
    }

    const delta = new Map();
    nodes.forEach(node => {
      delta.set(node, 0);
    });

    while (stack.length) {
      const w = stack.pop();
      const coeff = (1 + delta.get(w)) / (sigma.get(w) || 1);
      const preds = predecessors.get(w);
      preds.forEach(v => {
        const contribution = sigma.get(v) * coeff;
        delta.set(v, delta.get(v) + contribution);
      });
      if (w !== source) {
        betweenness[w] += delta.get(w);
      }
    }
  });

  const normalizationFactor = 2 / ((order - 1) * (order - 2));
  nodes.forEach(node => {
    betweenness[node] *= normalizationFactor;
  });

  return betweenness;
}

function computePageRankCentrality(graph, nodes, overrides = {}) {
  const options = {
    ...DEFAULT_PAGERANK_OPTIONS,
    ...(overrides || {})
  };
  const damping = typeof options.damping === 'number' ? options.damping : DEFAULT_PAGERANK_OPTIONS.damping;
  const tolerance = typeof options.tolerance === 'number' ? options.tolerance : DEFAULT_PAGERANK_OPTIONS.tolerance;
  const maxIterations = Number.isInteger(options.maxIterations) ? options.maxIterations : DEFAULT_PAGERANK_OPTIONS.maxIterations;
  const order = nodes.length;
  const initialValue = 1 / order;

  const neighborSets = buildNeighborSets(graph);
  const ranks = new Map();
  const nextRanks = new Map();

  nodes.forEach(node => {
    ranks.set(node, initialValue);
  });

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let diff = 0;
    let sinkRank = 0;

    nodes.forEach(node => {
      const neighbors = neighborSets.get(node);
      if (!neighbors || neighbors.size === 0) {
        sinkRank += ranks.get(node);
      }
    });

    nodes.forEach(node => {
      const neighbors = neighborSets.get(node);
      let rank = (1 - damping) / order;
      rank += damping * (sinkRank / order);

      if (neighbors && neighbors.size) {
        neighbors.forEach(neighbor => {
          const neighborSet = neighborSets.get(neighbor);
          const outDegree = neighborSet ? neighborSet.size : 0;
          if (outDegree > 0) {
            rank += (damping * ranks.get(neighbor)) / outDegree;
          }
        });
      }

      nextRanks.set(node, rank);
    });

    nodes.forEach(node => {
      const newRank = nextRanks.get(node);
      diff += Math.abs(newRank - ranks.get(node));
      ranks.set(node, newRank);
    });

    if (diff < tolerance) {
      break;
    }
  }

  const result = {};
  let total = 0;
  nodes.forEach(node => {
    total += ranks.get(node);
  });

  nodes.forEach(node => {
    const value = ranks.get(node) / (total || 1);
    result[node] = value;
  });

  return result;
}


