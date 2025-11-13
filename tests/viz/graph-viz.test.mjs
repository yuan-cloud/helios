import assert from "node:assert/strict";
import test from "node:test";

import { GraphVisualization } from "../../src/viz/graph-viz.js";

test("exportJSON serializes current graph data", () => {
  const viz = new GraphVisualization(null);
  viz.data = {
    nodes: [
      {
        id: "fn:alpha",
        fqName: "alpha",
        name: "alpha",
        filePath: "src/alpha.js",
        x: 1,
        y: 2,
        z: 3,
      },
    ],
    links: [
      {
        source: "fn:alpha",
        target: "fn:beta",
        type: "call",
        weight: 1.5,
      },
    ],
  };

  const serialized = viz.exportJSON();
  const payload = JSON.parse(serialized);

  assert.equal(payload.nodes.length, 1);
  assert.equal(payload.links.length, 1);
  assert.equal(payload.nodes[0].id, "fn:alpha");
  assert.equal(payload.links[0].type, "call");
});

test("exportJSON handles missing graph data gracefully", () => {
  const viz = new GraphVisualization(null);
  viz.data = null;

  const payload = JSON.parse(viz.exportJSON());
  assert.deepEqual(payload, { nodes: [], links: [] });
});

test("exportPNG rejects when graph renderer not ready", async () => {
  const viz = new GraphVisualization(null);
  await assert.rejects(viz.exportPNG(), /Graph renderer is not ready/);
});

