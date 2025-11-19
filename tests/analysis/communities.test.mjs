import { test } from "node:test";
import assert from "node:assert/strict";
import Graph from "graphology";

import { computeCommunities } from "../../src/analysis/communities.js";

test("computeCommunities projects mixed graphs to undirected", () => {
  const graph = new Graph({ type: "mixed", multi: true, allowSelfLoops: true });
  graph.addNode("a");
  graph.addNode("b");
  graph.addNode("c");
  graph.addDirectedEdge("a", "b", { weight: 2 });
  graph.addDirectedEdge("b", "a", { weight: 1 });
  graph.addUndirectedEdge("a", "c", { weight: 3 });

  assert.doesNotThrow(() => computeCommunities(graph));

  const community = graph.getNodeAttribute("a", "community");
  assert.ok(community !== undefined, "expected community attribute to be assigned");
});


