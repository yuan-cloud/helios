/**
 * Community detection utilities (Louvain).
 */

import louvain from 'graphology-communities-louvain';
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

  let assignments = null;
  let modularity = null;

  if (typeof louvain.detailed === 'function') {
    try {
      const detailed = louvain.detailed(graph, louvainOptions);
      assignments = detailed?.communities || detailed?.partition || detailed?.assignments || null;
      modularity = typeof detailed?.modularity === 'number' ? detailed.modularity : null;
    } catch (err) {
      // Fall back to simple assignments.
    }
  }

  if (!assignments) {
    assignments = louvain(graph, louvainOptions);
  }

  if (!assignments) {
    assignments = {};
  }

  if (assign) {
    if (typeof louvain.assign === 'function') {
      louvain.assign(graph, {
        communityAttribute: attribute,
        ...louvainOptions
      });
    } else {
      Object.entries(assignments).forEach(([node, community]) => {
        graph.setNodeAttribute(node, attribute, community);
      });
    }
  }

  const groups = groupCommunities(assignments);

  groups.forEach((nodes, community) => {
    nodes.forEach(node => {
      mergeNodeMetrics(graph, node, {
        communities: {
          [attribute]: community
        }
      });
    });
  });

  return {
    communities: assignments,
    modularity,
    groups
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


