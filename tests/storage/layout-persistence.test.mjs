import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeLayoutSnapshot,
  saveLayoutSnapshot,
  loadLayoutSnapshot,
  deleteLayoutSnapshot,
  listLayoutSnapshots,
  LAYOUT_SNAPSHOT_VERSION,
} from "../../src/storage/layout-persistence.js";

test("normalizeLayoutSnapshot filters invalid entries and coerces numbers", () => {
  const input = [
    { id: "a", x: 1.1, y: "nope", fx: 0 },
    { name: "b", x: 2, z: 3 },
    { id: "", x: 4 },
    null,
  ];

  const result = normalizeLayoutSnapshot(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    id: "a",
    x: 1.1,
    y: null,
    z: null,
    fx: 0,
    fy: null,
    fz: null,
  });
  assert.deepEqual(result[1], {
    id: "b",
    x: 2,
    y: null,
    z: 3,
    fx: null,
    fy: null,
    fz: null,
  });
});

test("saveLayoutSnapshot delegates to client with normalized payload", async () => {
  let capturedPayload = null;
  const stubClient = {
    async saveLayoutSnapshot(payload) {
      capturedPayload = payload;
      return { ok: true };
    },
  };

  const snapshot = [
    { id: "node-1", x: 10, y: 20, fx: 10 },
    { name: "node-2", x: 5, y: 6, z: 7 },
  ];

  const response = await saveLayoutSnapshot(stubClient, {
    graphKey: "graph::1",
    graphHash: "hash-123",
    snapshot,
    metadata: { note: "test" },
  });

  assert.deepEqual(response, { ok: true });
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.graphKey, "graph::1");
  assert.equal(capturedPayload.graphHash, "hash-123");
  assert.equal(capturedPayload.layoutVersion, LAYOUT_SNAPSHOT_VERSION);
  assert.equal(capturedPayload.nodeCount, 2);
  assert.equal(capturedPayload.layout.length, 2);
  assert.deepEqual(capturedPayload.metadata, { note: "test" });
});

test("loadLayoutSnapshot normalizes data returned by client", async () => {
  const stubClient = {
    async loadLayoutSnapshot() {
      return {
        graphKey: "graph::2",
        layout: [
          { id: "a", x: 1, y: 2 },
          { name: "b", x: "nope" },
        ],
        metadata: { version: 1 },
      };
    },
  };

  const result = await loadLayoutSnapshot(stubClient, "graph::2");
  assert.ok(result);
  assert.equal(result.layout.length, 2);
  assert.equal(result.layout[0].id, "a");
  assert.equal(result.layout[1].id, "b");
  assert.equal(result.layout[1].x, null);
});

test("deleteLayoutSnapshot and listLayoutSnapshots proxy to client", async () => {
  let deletedKey = null;
  let listOptions = null;
  const stubClient = {
    async deleteLayoutSnapshot(key) {
      deletedKey = key;
      return { deleted: true };
    },
    async listLayoutSnapshots(options) {
      listOptions = options;
      return { snapshots: [] };
    },
  };

  const deleteResponse = await deleteLayoutSnapshot(stubClient, "graph::3");
  assert.equal(deletedKey, "graph::3");
  assert.deepEqual(deleteResponse, { deleted: true });

  const listResponse = await listLayoutSnapshots(stubClient, { limit: 5 });
  assert.deepEqual(listOptions, { limit: 5 });
  assert.deepEqual(listResponse, { snapshots: [] });
});


