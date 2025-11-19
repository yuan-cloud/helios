/**
 * Community detection utilities (Louvain).
 */

// Workers don't inherit import maps, so check for globally-provided modules first
// The worker will set self.__graphology and self.__graphologyLouvain before importing
// In main thread (window exists), we'll use the normal imports (via import map)
import GraphDefault from 'graphology';
import louvainDefault from 'graphology-communities-louvain';
// Check for worker context (no window) and global modules
const Graph = (typeof window === 'undefined' && typeof self !== 'undefined' && self.__graphology) || GraphDefault;
const louvain = (typeof window === 'undefined' && typeof self !== 'undefined' && self.__graphologyLouvain) || louvainDefault;
import { assertGraph, mergeNodeMetrics } from './utils.js';

const DEFAULT_ATTRIBUTE = 'community';

/**
 * Compute Louvain communities.
 * @param {Graph} graph
 * @param {Object} [options]
 * @param {boolean} [options.assign=true] - Whether to set node attributes with community ids.
 * @param {string} [options.attribute='community'] - Attribute name to assign.
 * @param {Object} [options.louvainOptions] - Options passed to the Louvain implementation.
 * @returns {{communities: Record<string, number|string>, modularity: number|null, groups: Map<string|number, Array<string>>}}
 */
export function computeCommunities(graph, options = {}) {
  assertGraph(graph);
  const assign = options.assign !== false;
  const attribute = options.attribute || DEFAULT_ATTRIBUTE;
  const louvainOptions = options.louvainOptions || {};

  const tempGraph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });

  graph.forEachNode((node, attributes) => {
    tempGraph.mergeNode(node, attributes);
  });

  graph.forEachEdge((edgeKey, attributes, source, target) => {
    if (source === target) {
      return;
    }
    const weight = typeof attributes?.weight === 'number' ? attributes.weight : 1;
    if (!tempGraph.hasNode(source)) {
      tempGraph.mergeNode(source, graph.getNodeAttributes(source) || {});
    }
    if (!tempGraph.hasNode(target)) {
      tempGraph.mergeNode(target, graph.getNodeAttributes(target) || {});
    }
    if (tempGraph.hasEdge(source, target)) {
      const existingKey = tempGraph.edge(source, target);
      const currentWeight =
        typeof tempGraph.getEdgeAttribute(existingKey, 'weight') === 'number'
          ? tempGraph.getEdgeAttribute(existingKey, 'weight')
          : 0;
      tempGraph.setEdgeAttribute(existingKey, 'weight', currentWeight + weight);
    } else if (tempGraph.hasEdge(target, source)) {
      const existingKey = tempGraph.edge(target, source);
      const currentWeight =
        typeof tempGraph.getEdgeAttribute(existingKey, 'weight') === 'number'
          ? tempGraph.getEdgeAttribute(existingKey, 'weight')
          : 0;
      tempGraph.setEdgeAttribute(existingKey, 'weight', currentWeight + weight);
    } else {
      tempGraph.addEdge(source, target, { weight });
    }
  });

  let assignments = null;
  let modularity = null;

  if (typeof louvain.detailed === 'function') {
    try {
      const detailed = louvain.detailed(tempGraph, louvainOptions);
      assignments = detailed?.communities || detailed?.partition || detailed?.assignments || null;
      modularity = typeof detailed?.modularity === 'number' ? detailed.modularity : null;
    } catch (err) {
      // Fall back to simple assignments.
    }
  }

  if (!assignments) {
    assignments = louvain(tempGraph, louvainOptions);
  }

  if (!assignments) {
    assignments = {};
  }

  if (assign) {
    Object.entries(assignments).forEach(([node, community]) => {
      if (graph.hasNode(node)) {
        graph.setNodeAttribute(node, attribute, community);
      }
    });
  }

  const groups = groupCommunities(assignments);

  groups.forEach((nodes, community) => {
    nodes.forEach((node) => {
      mergeNodeMetrics(graph, node, {
        communities: {
          [attribute]: community,
        },
      });
    });
  });

  return {
    communities: assignments,
    modularity,
    groups,
  };
}

function groupCommunities(assignments) {
  const map = new Map();
  if (!assignments || typeof assignments !== 'object') {
    return map;
  }

  Object.entries(assignments).forEach(([node, community]) => {
    const key = community ?? 'unassigned';
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(node);
  });

  return map;
}

