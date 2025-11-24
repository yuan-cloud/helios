/**
 * Community detection utilities (Louvain).
 */

// Workers don't inherit import maps, so we need conditional imports
// Top-level static imports fail in workers before fallback logic can execute
// Use dynamic imports conditionally based on environment
let GraphDefault = null;
let louvainDefault = null;

// Handle three cases:
// 1. Node.js (tests): use normal import (no import maps, but Node.js resolves modules)
// 2. Main thread (browser with window): use import map via dynamic import
// 3. Worker (browser without window): use global (set by worker) or try to import
if (typeof window !== 'undefined') {
  // Main thread (browser): use import map via dynamic imports
  try {
    const [graphologyModule, louvainModule] = await Promise.all([
      import('graphology'),
      import('graphology-communities-louvain')
    ]);
    GraphDefault = graphologyModule.default || graphologyModule;
    louvainDefault = louvainModule.default || louvainModule;
  } catch (err) {
    console.error('[communities] Failed to import modules:', err);
    // Try fallback to direct paths
    try {
      const [graphologyModule, louvainModule] = await Promise.all([
        import('/public/vendor/graphology/graphology.esm.js'),
        import('https://esm.run/graphology-communities-louvain@2.0.2')
      ]);
      GraphDefault = graphologyModule.default || graphologyModule;
      louvainDefault = louvainModule.default || louvainModule;
    } catch (fallbackErr) {
      console.error('[communities] Fallback import also failed:', fallbackErr);
    }
  }
} else if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js (tests): use normal imports
  try {
    const [graphologyModule, louvainModule] = await Promise.all([
      import('graphology'),
      import('graphology-communities-louvain')
    ]);
    GraphDefault = graphologyModule.default || graphologyModule;
    louvainDefault = louvainModule.default || louvainModule;
  } catch (err) {
    console.error('[communities] Node.js import failed:', err);
  }
} else if (typeof self !== 'undefined') {
  // Worker context: MUST use global (set by graph-worker.js)
  // CRITICAL: Never try local vendor file in workers - it has "events" dependency that workers can't resolve
  // The worker (graph-worker.js) loads graphology from ESM.run and sets self.__graphology before importing this module
  if (self.__graphology) {
    GraphDefault = self.__graphology;
    console.log('[communities] Using graphology from worker global (self.__graphology)');
  } else {
    // Fallback: try ESM.run directly (shouldn't happen if worker loaded correctly)
    console.warn('[communities] self.__graphology not set, trying ESM.run fallback');
    try {
      const graphologyModule = await import('https://esm.run/graphology@0.25.4');
      GraphDefault = graphologyModule.default || graphologyModule;
      console.log('[communities] Worker ESM.run fallback succeeded');
    } catch (err) {
      console.error('[communities] Worker ESM.run graphology import failed:', err);
      // The worker should have loaded graphology via graph-worker.js before this module is imported
      throw new Error('Graphology not available in worker. Worker initialization may have failed.');
    }
  }
  
  if (self.__graphologyLouvain) {
    louvainDefault = self.__graphologyLouvain;
    console.log('[communities] Using louvain from worker global (self.__graphologyLouvain)');
  } else {
    // Try to load louvain from ESM.run (it handles dependencies better)
    console.warn('[communities] self.__graphologyLouvain not set, trying ESM.run fallback');
    try {
      const louvainModule = await import('https://esm.run/graphology-communities-louvain@2.0.2');
      louvainDefault = louvainModule.default || louvainModule;
      console.log('[communities] Worker ESM.run louvain fallback succeeded');
    } catch (err) {
      console.warn('[communities] Worker louvain import failed:', err);
      // Louvain is optional, continue without it
    }
  }
}

// Check for worker context (no window, no Node.js) and global modules, fall back to imported modules
const Graph = (typeof window === 'undefined' && typeof process === 'undefined' && typeof self !== 'undefined' && self.__graphology) || GraphDefault;
const louvain = (typeof window === 'undefined' && typeof process === 'undefined' && typeof self !== 'undefined' && self.__graphologyLouvain) || louvainDefault;

// Defensive runtime checks to catch module loading issues early
if (!Graph) {
  throw new Error('Graphology module not available - check worker initialization or import map. GraphDefault=' + GraphDefault + ', window=' + typeof window + ', process=' + typeof process + ', self=' + typeof self + ', self.__graphology=' + (typeof self !== 'undefined' ? self.__graphology : 'N/A'));
}
if (!louvain) {
  console.warn('[communities] Louvain module not available - community detection will be disabled');
  // Louvain is optional, don't throw - just disable community detection
}
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

  if (!louvain) {
    console.warn('[communities] Louvain module not available - skipping community detection');
    return { communities: null, modularity: null };
  }

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

