import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { StorageWorkerClient, StorageWorkerError } from "../../src/storage/client.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForMessages(worker, expectedCount, timeoutMs = 100) {
  const start = Date.now();
  while (worker.messages.length < expectedCount && Date.now() - start < timeoutMs) {
    await flushMicrotasks();
  }
}

class MockWorker extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  addEventListener(event, handler) {
    if (event === "message") {
      this.on("message", handler);
    }
  }

  emitMessage(data) {
    this.emit("message", { data });
  }

  terminate() {
    this.terminated = true;
  }
}

test("init sends init message once and resolves payload", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const initPromise = client.init({ dbName: "test.db" });
  assert.equal(worker.messages.length, 1, "init should post exactly one message");
  const [message] = worker.messages;
  assert.equal(message.type, "init");
  assert.deepEqual(message.payload.config.dbName, "test.db");

  worker.emitMessage({
    id: message.id,
    success: true,
    result: { persistent: false, schemaVersion: 1 },
  });

  const result = await initPromise;
  assert.equal(result.schemaVersion, 1);
  assert.equal(worker.messages.length, 1, "subsequent init awaits existing promise");
  const closePromise = client.close({ terminate: true });
  await flushMicrotasks();
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});

test("layout snapshot helpers post expected worker messages", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const savePromise = client.saveLayoutSnapshot({
    graphKey: "graph::abc",
    graphHash: "hash",
    layout: [{ id: "n1", x: 1 }],
  });

  await waitForMessages(worker, 1);
  const initMessage = worker.messages[0];
  worker.emitMessage({
    id: initMessage.id,
    success: true,
    result: { persistent: true, schemaVersion: 2 },
  });

  await waitForMessages(worker, 2);
  const saveMessage = worker.messages[1];
  assert.equal(saveMessage.type, "layout:save");
  assert.equal(saveMessage.payload.graphKey, "graph::abc");
  assert.equal(saveMessage.payload.layout.length, 1);

  worker.emitMessage({
    id: saveMessage.id,
    success: true,
    result: { graphKey: "graph::abc" },
  });
  await savePromise;

  const loadPromise = client.loadLayoutSnapshot("graph::abc");
  await waitForMessages(worker, 3);
  const loadMessage = worker.messages[2];
  assert.equal(loadMessage.type, "layout:load");
  worker.emitMessage({
    id: loadMessage.id,
    success: true,
    result: { graphKey: "graph::abc", layout: [] },
  });
  const loadResult = await loadPromise;
  assert.equal(loadResult.graphKey, "graph::abc");

  const listPromise = client.listLayoutSnapshots({ limit: 5 });
  await waitForMessages(worker, 4);
  const listMessage = worker.messages[3];
  assert.equal(listMessage.type, "layout:list");
  worker.emitMessage({
    id: listMessage.id,
    success: true,
    result: { snapshots: [] },
  });
  await listPromise;

  const deletePromise = client.deleteLayoutSnapshot("graph::abc");
  await waitForMessages(worker, 5);
  const deleteMessage = worker.messages[4];
  assert.equal(deleteMessage.type, "layout:delete");
  worker.emitMessage({
    id: deleteMessage.id,
    success: true,
    result: { graphKey: "graph::abc" },
  });
  await deletePromise;

  const baseCount = worker.messages.length;
  const closePromise = client.close({ terminate: true });
  await waitForMessages(worker, baseCount + 1);
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});

test("exec auto-initializes when autoInit enabled", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const execPromise = client.exec("PRAGMA foreign_keys = ON");

  assert.equal(worker.messages.length, 1, "auto-init should send init first");
  const initMessage = worker.messages[0];
  worker.emitMessage({
    id: initMessage.id,
    success: true,
    result: { persistent: true, schemaVersion: 1 },
  });

  await waitForMessages(worker, 2);
  assert.equal(worker.messages.length, 2, "exec should post second message after init");
  const execMessage = worker.messages[1];
  assert.equal(execMessage.type, "exec");
  assert.equal(execMessage.payload.sql, "PRAGMA foreign_keys = ON");

  worker.emitMessage({
    id: execMessage.id,
    success: true,
    result: { changes: 0 },
  });

  const execResult = await execPromise;
  assert.deepEqual(execResult, { changes: 0 });
  const baseCount = worker.messages.length;
  const closePromise = client.close({ terminate: true });
  await waitForMessages(worker, baseCount + 1);
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});

test("storage worker error surfaces as StorageWorkerError", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const queryPromise = client.query("SELECT 1");

  // Respond to init first
  const initMessage = worker.messages[0];
  worker.emitMessage({
    id: initMessage.id,
    success: true,
    result: { persistent: false, schemaVersion: 1 },
  });

  await waitForMessages(worker, 2);
  const queryMessage = worker.messages[1];
  worker.emitMessage({
    id: queryMessage.id,
    success: false,
    error: { name: "SQLiteError", message: "syntax error" },
  });

  await assert.rejects(
    queryPromise,
    (error) => error instanceof StorageWorkerError && /syntax error/.test(error.message),
    "Should reject with StorageWorkerError"
  );
  const baseCount = worker.messages.length;
  const closePromise = client.close({ terminate: true });
  await waitForMessages(worker, baseCount + 1);
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});

test("kv helpers serialize and parse JSON by default", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const setPromise = client.setKv("layout:last", { positions: [1, 2] });

  const initMessage = worker.messages[0];
  worker.emitMessage({
    id: initMessage.id,
    success: true,
    result: { persistent: true, schemaVersion: 1 },
  });

  await waitForMessages(worker, 2);
  const setMessage = worker.messages[1];
  assert.equal(setMessage.type, "kv:set");
  assert.equal(typeof setMessage.payload.value, "string");
  assert.ok(setMessage.payload.value.includes("positions"));

  worker.emitMessage({
    id: setMessage.id,
    success: true,
    result: { key: "layout:last" },
  });
  await setPromise;

  const getPromise = client.getKv("layout:last");
  await waitForMessages(worker, 3);
  const getMessage = worker.messages[2];
  assert.equal(getMessage.type, "kv:get");

  worker.emitMessage({
    id: getMessage.id,
    success: true,
    result: {
      key: "layout:last",
      exists: true,
      value: setMessage.payload.value,
    },
  });

  const layout = await getPromise;
  assert.deepEqual(layout, { positions: [1, 2] });
  const baseCount = worker.messages.length;
  const closePromise = client.close({ terminate: true });
  await waitForMessages(worker, baseCount + 1);
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});

test("reset clears initialization state and posts reset message", async () => {
  const worker = new MockWorker();
  const client = new StorageWorkerClient({
    createWorker: () => worker,
  });

  const resetPromise = client.reset();
  assert.equal(worker.messages.length, 1, "reset should post a reset message");
  const resetMessage = worker.messages[0];
  assert.equal(resetMessage.type, "reset");

  worker.emitMessage({
    id: resetMessage.id,
    success: true,
    result: { cleared: true, removed: true, dbName: "helios.sqlite3" },
  });

  const resetResult = await resetPromise;
  assert.equal(resetResult.cleared, true);
  assert.equal(client.initializationPromise, null);

  const execPromise = client.exec("SELECT 1");
  await waitForMessages(worker, 2);
  const initMessage = worker.messages[1];
  assert.equal(initMessage.type, "init");
  worker.emitMessage({
    id: initMessage.id,
    success: true,
    result: { persistent: true, schemaVersion: 1 },
  });

  await waitForMessages(worker, 3);
  const execMessage = worker.messages[2];
  assert.equal(execMessage.type, "exec");
  worker.emitMessage({
    id: execMessage.id,
    success: true,
    result: { changes: 0 },
  });
  await execPromise;

  const closePromise = client.close({ terminate: true });
  await waitForMessages(worker, 4);
  const closeMessage = worker.messages.at(-1);
  worker.emitMessage({
    id: closeMessage.id,
    success: true,
    result: { closed: true },
  });
  await closePromise;
});


