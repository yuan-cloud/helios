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


