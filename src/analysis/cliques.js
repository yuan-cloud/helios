/**
 * Clique and k-core analysis utilities.
 */

import { assertGraph, buildNeighborSets, mergeNodeMetrics } from './utils.js';

const DEFAULT_MAX_CLIQUES = 1000;

/**
 * Compute core numbers (k-core) and maximal cliques.
 * @param {Graph} graph
 * @param {Object} [options]
 * @param {boolean} [options.assign=true] - Whether to store metrics back onto nodes.
 * @param {number} [options.maxCliques=1000] - Maximum cliques to enumerate.
 * @returns {{
 *   coreNumbers: Record<string, number>,
 *   degeneracy: number,
 *   cliques: Array<Array<string>>
 * }}
 */
export function analyzeCliquesAndCores(graph, options = {}) {
  assertGraph(graph);
  const assign = options.assign !== false;
  const maxCliques = Number.isInteger(options.maxCliques) && options.maxCliques > 0
    ? options.maxCliques
    : DEFAULT_MAX_CLIQUES;

  const neighborSets = buildNeighborSets(graph);
  const coreNumbers = computeCoreNumbers(neighborSets);
  const degeneracy = Object.values(coreNumbers).reduce((max, value) => Math.max(max, value), 0);
  const cliques = enumerateMaximalCliques(neighborSets, { maxCliques });

  if (assign) {
    Object.entries(coreNumbers).forEach(([node, core]) => {
      mergeNodeMetrics(graph, node, {
        cores: {
          coreNumber: core,
          degeneracy
        }
      });
    });
  }

  return {
    coreNumbers,
    degeneracy,
    cliques
  };
}

function computeCoreNumbers(neighborSets) {
  const core = {};
  const degrees = new Map();
  const remaining = new Set(neighborSets.keys());

  remaining.forEach(node => {
    degrees.set(node, neighborSets.get(node)?.size || 0);
  });

  while (remaining.size) {
    let minNode = null;
    let minDegree = Infinity;

    remaining.forEach(node => {
      const degree = degrees.get(node) ?? 0;
      if (degree < minDegree) {
        minDegree = degree;
        minNode = node;
      }
    });

    if (minNode === null) {
      break;
    }

    core[minNode] = minDegree;
    remaining.delete(minNode);

    const neighbors = neighborSets.get(minNode);
    if (neighbors) {
      neighbors.forEach(neighbor => {
        if (remaining.has(neighbor)) {
          const current = degrees.get(neighbor) ?? 0;
          degrees.set(neighbor, Math.max(0, current - 1));
        }
      });
    }
  }

  return core;
}

function enumerateMaximalCliques(neighborSets, options) {
  const cliques = [];
  const maxCliques = options.maxCliques;

  const P = new Set(neighborSets.keys());
  const R = new Set();
  const X = new Set();

  bronKerbosch(neighborSets, R, P, X, cliques, maxCliques);
  return cliques;
}

function bronKerbosch(neighborSets, R, P, X, cliques, maxCliques) {
  if (cliques.length >= maxCliques) {
    return;
  }

  if (P.size === 0 && X.size === 0) {
    cliques.push(Array.from(R));
    return;
  }

  const pivot = choosePivot(neighborSets, P, X);
  const candidates = new Set(P);

  if (pivot) {
    const pivotNeighbors = neighborSets.get(pivot) || new Set();
    pivotNeighbors.forEach(node => {
      candidates.delete(node);
    });
  }

  for (const node of candidates) {
    if (cliques.length >= maxCliques) {
      break;
    }

    R.add(node);
    const neighbors = neighborSets.get(node) || new Set();

    const newP = intersectSets(P, neighbors);
    const newX = intersectSets(X, neighbors);
    bronKerbosch(neighborSets, R, newP, newX, cliques, maxCliques);

    R.delete(node);
    P.delete(node);
    X.add(node);
  }
}

function choosePivot(neighborSets, P, X) {
  let pivot = null;
  let maxNeighbors = -1;

  for (const node of unionSets(P, X)) {
    const neighborCount = neighborSets.get(node)?.size ?? 0;
    if (neighborCount > maxNeighbors) {
      maxNeighbors = neighborCount;
      pivot = node;
    }
  }

  return pivot;
}

function unionSets(a, b) {
  const result = new Set(a);
  b.forEach(value => result.add(value));
  return result;
}

function intersectSets(a, b) {
  const result = new Set();
  a.forEach(value => {
    if (b.has(value)) {
      result.add(value);
    }
  });
  return result;
}


