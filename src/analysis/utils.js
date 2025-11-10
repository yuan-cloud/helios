/**
 * Utility helpers shared by analysis modules.
 */

/**
 * Ensure a graph instance is provided.
 * @param {Graph} graph
 */
export function assertGraph(graph) {
  if (!graph || typeof graph.forEachNode !== 'function') {
    throw new TypeError('A valid Graphology graph instance is required.');
  }
}

/**
 * Build a neighbor map treating the graph as undirected.
 * @param {Graph} graph
 * @returns {Map<string, Set<string>>}
 */
export function buildNeighborSets(graph) {
  assertGraph(graph);
  const neighbors = new Map();

  graph.forEachNode(node => {
    neighbors.set(node, new Set());
  });

  graph.forEachNode(node => {
    const set = neighbors.get(node);
    graph.forEachNeighbor(node, neighbor => {
      if (!neighbors.has(neighbor)) {
        neighbors.set(neighbor, new Set());
      }
      set.add(neighbor);
    });
  });

  return neighbors;
}

/**
 * Shallow-merge metrics onto the node's existing metrics attribute.
 * @param {Graph} graph
 * @param {string} node
 * @param {Object} patch
 */
export function mergeNodeMetrics(graph, node, patch) {
  assertGraph(graph);
  if (!isPlainObject(patch)) {
    return;
  }
  const current = graph.getNodeAttribute(node, 'metrics');
  const updated = {
    ...(isPlainObject(current) ? current : {}),
    ...patch
  };
  graph.setNodeAttribute(node, 'metrics', updated);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}


