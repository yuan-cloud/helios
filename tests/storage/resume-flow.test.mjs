import test from "node:test";
import assert from "node:assert/strict";

import {
  saveAnalysisSnapshot,
  loadAnalysisSnapshot,
  clearAnalysisSnapshot,
  ANALYSIS_SNAPSHOT_KEY,
} from "../../src/storage/resume-flow.js";

class MockStorageClient {
  constructor() {
    this.initialized = false;
    this.store = new Map();
  }

  async ensureInitialized() {
    this.initialized = true;
  }

  async setKv(key, value) {
    if (!this.initialized) {
      throw new Error("Client not initialized");
    }
    const cloned =
      value === null || value === undefined
        ? null
        : JSON.parse(JSON.stringify(value));
    this.store.set(key, cloned);
  }

  async getKv(key) {
    if (!this.initialized) {
      throw new Error("Client not initialized");
    }
    if (!this.store.has(key)) {
      return null;
    }
    const value = this.store.get(key);
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }
}

test("save/load/clear analysis snapshot", async (t) => {
  const client = new MockStorageClient();

  const longSource = Array.from({ length: 1200 }, (_, idx) => `line ${idx}`).join("\n");

  const payload = {
    projectLabel: "sample-project",
    sourceFiles: [
      {
        path: "src/foo.js",
        language: "javascript",
        moduleId: "src/foo",
        moduleAliases: ["foo", "src/foo"],
      },
      {
        path: "src/bar.py",
        language: "python",
        moduleId: "src.bar",
        moduleAliases: ["src.bar"],
      },
    ],
    callGraph: {
      nodes: [
        {
          id: "src/foo.js:10:42",
          name: "foo",
          filePath: "src/foo.js",
          lang: "javascript",
          moduleId: "src/foo",
          start: 10,
          end: 42,
          startLine: 1,
          endLine: 10,
          startColumn: 0,
          endColumn: 2,
          loc: 40,
          doc: "Foo docs",
        source: longSource,
        },
        {
          id: "virtual:missing:src/foo.js",
          name: "missing",
          filePath: "src/foo.js",
          lang: "javascript",
          isVirtual: true,
          start: 0,
          end: 0,
        },
      ],
      edges: [
        {
          source: "src/foo.js:10:42",
          target: "virtual:missing:src/foo.js",
          weight: 3,
          isDynamic: false,
          metadata: {
            callSiteSamples: [
              { file: "src/foo.js", line: 5, column: 2 },
              { file: "src/foo.js", line: 8, column: 4 },
            ],
            resolution: {
              status: "unresolved",
              reason: "No candidates",
              matchCount: 0,
              matches: [
                {
                  id: "virtual:missing:src/foo.js",
                  name: "[unresolved] missing",
                  filePath: "src/foo.js",
                  matchType: "virtual",
                  confidence: "low",
                },
              ],
              selectedMatch: null,
              importInfo: null,
              calleeName: "missing",
            },
          },
        },
      ],
      stats: {
        totalEdges: 1,
        staticEdges: 1,
        dynamicEdges: 0,
        resolvedEdges: 0,
        ambiguousEdges: 0,
        unresolvedEdges: 1,
      },
    },
    similarityEdges: [
      {
        source: "src/foo.js:10:42",
        target: "src/bar.py:0:10",
        similarity: 0.87,
        method: "topk-avg",
        topPairs: [
          { chunkA: "a1", chunkB: "b1", score: 0.9 },
          { chunkA: "a2", chunkB: "b3", score: 0.86 },
        ],
      },
    ],
    embeddingMetadata: {
      backend: "wasm",
      modelId: "miniLM",
      dimension: 384,
      quantized: false,
    },
    embeddingReuseCounts: {
      reused: 12,
      embedded: 3,
    },
    embeddingStats: {
      chunkCount: 24,
    },
    embeddingFingerprint: "fingerprint123",
    functionFingerprintMap: {
      "src/foo.js:10:42": "fp-foo",
    },
    layoutKey: "helios:v1:layout:abcd",
    graph: {
      payload: {
        functions: [
          {
            id: "graph:src/foo.js:10:42",
            name: "graphFoo",
            filePath: "src/foo.js",
            lang: "javascript",
            moduleId: "src/foo",
            startLine: 1,
            endLine: 10,
            metrics: { centrality: 0.92 },
            doc: "Graph node docs",
          },
        ],
        callEdges: [
          {
            source: "graph:src/foo.js:10:42",
            target: "src/foo.js:10:42",
            weight: 1,
            isDynamic: false,
            resolution: {
              status: "resolved",
              reason: "Rehydrate from snapshot",
            },
            callSites: [{ file: "src/foo.js", line: 3, column: 2 }],
          },
        ],
        similarityEdges: [
          {
            source: "graph:src/foo.js:10:42",
            target: "src/bar.py:0:10",
            similarity: 0.73,
            method: "topk-avg",
          },
        ],
        extras: {
          summary: {
            topCentral: ["graph:src/foo.js:10:42"],
          },
        },
      },
      summary: {
        nodes: 2,
        edges: 2,
        communities: 1,
      },
      serialized: {
        nodes: [
          {
            id: "graph:src/foo.js:10:42",
            name: "graphFoo",
            filePath: "src/foo.js",
            lang: "javascript",
            metrics: { centrality: 0.92 },
          },
        ],
        edges: [
          {
            source: "graph:src/foo.js:10:42",
            target: "src/foo.js:10:42",
            weight: 1,
            layer: "call",
          },
        ],
      },
      extras: {
        topCommunities: [{ id: 1, size: 1 }],
      },
    },
  };

  const saved = await saveAnalysisSnapshot(client, payload);
  assert.equal(saved.version, 1);
  assert.equal(saved.project.label, "sample-project");
  assert.equal(saved.functions.length, 1);
  assert.ok(saved.functions[0].source, "Function source should be persisted");
  assert.equal(saved.functions[0].sourceTruncated, true, "Long source should be marked truncated");
  assert.ok(saved.functions[0].source.length <= 8192, "Source snippet should be trimmed to snapshot limit");
  assert.equal(saved.callGraph.nodes.length, 2);
  const savedNode = saved.callGraph.nodes.find((node) => node.id === "src/foo.js:10:42");
  assert.ok(savedNode?.source, "Call graph node should retain source snippet");
  assert.equal(saved.callGraph.edges.length, 1);
  assert.equal(saved.similarityEdges.length, 1);
  assert.equal(saved.stats.functionCount, 1);
  assert.equal(saved.stats.callEdgeCount, 1);
  assert.equal(saved.stats.similarityEdgeCount, 1);
  assert.equal(saved.embedding.cached, false);
  assert.equal(saved.embedding.reuse.reused, 12);
  assert.equal(saved.embedding.metadata.modelId, "miniLM");
  assert.equal(saved.fingerprint, "fingerprint123");
  assert.equal(saved.layoutKey, "helios:v1:layout:abcd");
  assert.ok(saved.graph, "Graph snapshot should be persisted");
  assert.equal(saved.graph.payload.functions.length, 1);
  assert.equal(saved.graph.payload.callEdges.length, 1);
  assert.equal(saved.graph.payload.similarityEdges.length, 1);
  assert.equal(saved.graph.payload.extras.summary.topCentral[0], "graph:src/foo.js:10:42");
  assert.equal(saved.graph.summary.nodes, 2);
  assert.equal(saved.graph.serialized.nodes.length, 1);
  assert.equal(saved.graph.extras.topCommunities.length, 1);

  // Source snippets should remain available for inspector hydration.
  assert.equal("source" in saved.functions[0], true);

  const stored = client.store.get(ANALYSIS_SNAPSHOT_KEY);
  assert.ok(stored, "Snapshot should be stored in KV table");

  const loaded = await loadAnalysisSnapshot(client);
  assert.deepEqual(loaded, saved);

  await clearAnalysisSnapshot(client);
  const cleared = await loadAnalysisSnapshot(client);
  assert.equal(cleared, null);
});

