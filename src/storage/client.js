// Storage worker client for coordinating SQLite operations through a dedicated worker.
// This provides a structured API for other subsystems (parser, viz, embeddings) to
// interact with the database without touching WASM directly on the main thread.

import { HELIOS_DB_NAME } from "./schema.js";

export class StorageWorkerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StorageWorkerError";
    this.details = details;
  }

  static fromSerialized(errorLike) {
    if (!errorLike) {
      return new StorageWorkerError("Unknown storage worker error");
    }
    const { message = "Storage worker error", name, stack, ...rest } = errorLike;
    const err = new StorageWorkerError(message, rest);
    if (name) {
      err.name = name;
    }
    if (stack) {
      err.stack = stack;
    }
    return err;
  }
}

function resolveWorkerFactory(options = {}) {
  if (typeof options.createWorker === "function") {
    return options.createWorker;
  }
  const workerUrl = options.workerUrl ?? new URL("../workers/storage-worker.js", import.meta.url);
  return () =>
    new Worker(workerUrl, {
      type: "module",
    });
}

export class StorageWorkerClient {
  /**
   * @param {Object} [options]
   * @param {() => Worker} [options.createWorker] Optional factory for tests.
   * @param {URL|string} [options.workerUrl] Custom worker URL (ignored when createWorker supplied).
   * @param {Object} [options.initConfig] Config passed to worker init (merged with defaults).
   * @param {boolean} [options.autoInit=true] Auto-initialize on first call.
   */
  constructor(options = {}) {
    this.createWorker = resolveWorkerFactory(options);
    this.initConfig = {
      dbName: HELIOS_DB_NAME,
      ...options.initConfig,
    };
    this.autoInit = options.autoInit !== false;

    this.worker = null;
    this.requestId = 0;
    this.pending = new Map();
    this.initializationPromise = null;
    this.initResult = null;
  }

  ensureWorker() {
    if (!this.worker) {
      this.worker = this.createWorker();
      const handler = (event) => this.handleMessage(event);
      if (typeof this.worker.addEventListener === "function") {
        this.worker.addEventListener("message", handler);
      } else {
        this.worker.onmessage = handler;
      }
    }
    return this.worker;
  }

  handleMessage(event) {
    const { data } = event;
    if (!data || typeof data.id !== "number") {
      return;
    }
    const deferred = this.pending.get(data.id);
    if (!deferred) {
      return;
    }
    this.pending.delete(data.id);
    if (data.success) {
      deferred.resolve(data.result);
    } else {
      deferred.reject(StorageWorkerError.fromSerialized(data.error));
    }
  }

  send(type, payload = {}) {
    this.ensureWorker();
    const id = ++this.requestId;
    const message = { id, type, payload };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }

    return promise;
  }

  async init(config = {}) {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    const mergedConfig = { ...this.initConfig, ...config };

    this.initializationPromise = this.send("init", { config: mergedConfig })
      .then((result) => {
        this.initResult = result;
        return result;
      })
      .catch((error) => {
        this.initializationPromise = null;
        throw error;
      });

    return this.initializationPromise;
  }

  async ensureInitialized() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    if (!this.autoInit) {
      throw new Error("Storage worker not initialized. Call init() first or enable autoInit.");
    }
    return this.init();
  }

  async exec(sql, params = []) {
    if (typeof sql !== "string") {
      throw new TypeError("SQL statement must be a string");
    }
    await this.ensureInitialized();
    return this.send("exec", { sql, params });
  }

  async batch(statements) {
    if (!Array.isArray(statements)) {
      throw new TypeError("Batch statements must be an array");
    }
    await this.ensureInitialized();
    const normalized = statements.map((stmt) => {
      if (!stmt || typeof stmt.sql !== "string") {
        throw new TypeError("Each statement must have a string sql property");
      }
      return {
        sql: stmt.sql,
        params: Array.isArray(stmt.params) ? stmt.params : [],
      };
    });
    return this.send("batch", { statements: normalized });
  }

  async query(sql, params = []) {
    if (typeof sql !== "string") {
      throw new TypeError("Query must be a string");
    }
    await this.ensureInitialized();
    return this.send("query", { sql, params });
  }

  async reset(options = {}) {
    this.ensureWorker();
    const payload = {};
    if (options.dbName && typeof options.dbName === "string") {
      payload.dbName = options.dbName;
    }
    const result = await this.send("reset", payload);
    this.initializationPromise = null;
    this.initResult = null;
    return result;
  }

  /**
   * Convenience helper for kv table writes.
   * @param {string} key
   * @param {*} value
   * @param {Object} [options]
   * @param {boolean} [options.json=true] Serialize value as JSON.
   */
  async setKv(key, value, options = {}) {
    if (!key || typeof key !== "string") {
      throw new TypeError("Key must be a non-empty string");
    }
    const json = options.json !== false;
    const serialized = json ? JSON.stringify(value ?? null) : String(value ?? "");
    await this.ensureInitialized();
    return this.send("kv:set", { key, value: serialized });
  }

  /**
   * Retrieve value from kv table.
   * @param {string} key
   * @param {Object} [options]
   * @param {boolean} [options.json=true] Parse string as JSON if true.
   */
  async getKv(key, options = {}) {
    if (!key || typeof key !== "string") {
      throw new TypeError("Key must be a non-empty string");
    }
    await this.ensureInitialized();
    const result = await this.send("kv:get", { key });
    if (!result || !result.exists) {
      return null;
    }
    const json = options.json !== false;
    if (!json) {
      return result.value;
    }
    if (typeof result.value !== "string") {
      return null;
    }
    try {
      return JSON.parse(result.value);
    } catch {
      return null;
    }
  }

  async saveLayoutSnapshot({
    graphKey,
    graphHash = null,
    layout = [],
    metadata = null,
    layoutVersion = 1,
    nodeCount,
  } = {}) {
    if (!graphKey || typeof graphKey !== "string") {
      throw new TypeError("graphKey must be a non-empty string");
    }
    if (!Array.isArray(layout)) {
      throw new TypeError("layout must be an array of node snapshots");
    }

    await this.ensureInitialized();
    const payload = {
      graphKey: graphKey.trim(),
      graphHash: typeof graphHash === "string" ? graphHash : null,
      layout,
      metadata: metadata ?? null,
      layoutVersion: Number.isFinite(layoutVersion) ? Math.max(1, layoutVersion) : 1,
      nodeCount: Number.isFinite(nodeCount) ? nodeCount : layout.length,
    };
    return this.send("layout:save", payload);
  }

  async loadLayoutSnapshot(graphKey) {
    if (!graphKey || typeof graphKey !== "string") {
      throw new TypeError("graphKey must be a non-empty string");
    }
    await this.ensureInitialized();
    return this.send("layout:load", { graphKey: graphKey.trim() });
  }

  async deleteLayoutSnapshot(graphKey) {
    if (!graphKey || typeof graphKey !== "string") {
      throw new TypeError("graphKey must be a non-empty string");
    }
    await this.ensureInitialized();
    return this.send("layout:delete", { graphKey: graphKey.trim() });
  }

  async listLayoutSnapshots(options = {}) {
    await this.ensureInitialized();
    const payload = {};
    if (options.graphKey) {
      if (typeof options.graphKey !== "string") {
        throw new TypeError("graphKey filter must be a string when provided");
      }
      payload.graphKey = options.graphKey.trim();
    }
    if (Number.isFinite(options.limit)) {
      payload.limit = Math.max(1, Math.floor(options.limit));
    }
    if (options.order && typeof options.order === "string") {
      payload.order = options.order;
    }
    return this.send("layout:list", payload);
  }

  /**
   * Export the database as a binary blob for download.
   * Returns an object with bytes (Uint8Array) and metadata.
   * @returns {Promise<{bytes: Uint8Array, size: number, dbName: string}>}
   */
  async exportDatabase() {
    await this.ensureInitialized();
    const result = await this.send("export");
    // Convert array back to Uint8Array
    if (result && Array.isArray(result.bytes)) {
      return {
        ...result,
        bytes: new Uint8Array(result.bytes),
      };
    }
    throw new Error("Invalid export result format");
  }

  async close(options = {}) {
    if (!this.worker) {
      return;
    }
    const terminate = options.terminate ?? true;
    try {
      await this.send("close");
    } catch (error) {
      // Swallow close errors but report for debugging
      console.debug("Storage worker close error", error);
    } finally {
      this.initializationPromise = null;
      this.initResult = null;
      if (terminate && typeof this.worker.terminate === "function") {
        this.worker.terminate();
      }
      this.worker = null;
      this.pending.clear();
    }
  }
}


