import { initializeDatabase } from "../storage/sqlite.js";
import { METADATA_KEYS, HELIOS_DB_NAME } from "../storage/schema.js";
import { enforceRetentionPolicy } from "../storage/retention.js";

let sqlite3Module = null;
let dbHandle = null;
let initializationPromise = null;
let currentDbName = HELIOS_DB_NAME;

const requestQueue = {
  current: Promise.resolve(),
};

function enqueue(task) {
  requestQueue.current = requestQueue.current.then(() => task()).catch((error) => {
    // Ensure the chain continues even after failure
    console.error("Storage worker task error", error);
  });
  return requestQueue.current;
}

function serializeError(error) {
  if (!error) {
    return { name: "Error", message: "Unknown error" };
  }
  const { name = "Error", message = "Storage worker error", stack } = error;
  const serialized = { name, message };
  if (stack) {
    serialized.stack = stack;
  }
  if (error.code) {
    serialized.code = error.code;
  }
  if (error.details) {
    serialized.details = error.details;
  }
  return serialized;
}

function respondSuccess(id, result = null) {
  self.postMessage({ id, success: true, result });
}

function respondError(id, error) {
  self.postMessage({ id, success: false, error: serializeError(error) });
}

function ensureDbReady() {
  if (!dbHandle) {
    throw new Error("SQLite database is not initialized yet.");
  }
  return dbHandle;
}

async function handleInit(id, payload) {
  if (!initializationPromise) {
    const config = payload?.config ?? {};
    currentDbName =
      typeof config.dbName === "string" && config.dbName.trim().length
        ? config.dbName
        : HELIOS_DB_NAME;
    initializationPromise = initializeDatabase({
      ...config,
      dbName: currentDbName,
    }).then((result) => {
      sqlite3Module = result.sqlite3;
      dbHandle = result.db;
      return {
        persistent: result.persistent,
        schemaVersion: result.schemaVersion,
        metadata: {
          schemaVersionKey: METADATA_KEYS.SCHEMA_VERSION,
        },
        dbName: currentDbName,
      };
    });
  }
  const initResult = await initializationPromise;
  
  // Retention cleanup: enabled via config.retention.enabled flag
  // Structure is ready, but disabled by default until product sign-off
  // Once approved, set config.retention.enabled = true to activate
  // Note: dbHandle is guaranteed to be set after initializationPromise resolves
  if (config?.retention?.enabled === true && dbHandle) {
    try {
      await enforceRetentionPolicy(dbHandle, kvGet);
    } catch (error) {
      // Log but don't fail init if retention cleanup fails
      console.warn("[Storage Worker] Retention cleanup failed during init:", error);
    }
  }
  
  respondSuccess(id, initResult);
}

function execStatement(sql, params = []) {
  const db = ensureDbReady();
  if (!Array.isArray(params)) {
    throw new TypeError("Statement params must be an array");
  }
  if (params.length > 0 && typeof db.prepare === "function") {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.finalize();
    }
    if (typeof db.changes === "function") {
      return { changes: db.changes() };
    }
    return { changes: undefined };
  }
  db.exec(sql);
  if (typeof db.changes === "function") {
    return { changes: db.changes() };
  }
  return { changes: undefined };
}

function execBatch(statements) {
  const db = ensureDbReady();
  db.exec("BEGIN IMMEDIATE");
  try {
    const results = statements.map((stmt) => execStatement(stmt.sql, stmt.params));
    db.exec("COMMIT");
    return results;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.warn("Failed to rollback batch transaction", rollbackError);
    }
    throw error;
  }
}

function runQuery(sql, params = []) {
  const db = ensureDbReady();
  const rows = [];
  const columns = new Set();
  if (typeof db.exec !== "function") {
    throw new Error("SQLite database handle does not support exec()");
  }
  db.exec({
    sql,
    bind: Array.isArray(params) ? params : [],
    rowMode: "object",
    callback: (row) => {
      rows.push(row);
      Object.keys(row).forEach((key) => columns.add(key));
    },
  });
  return {
    rows,
    columns: Array.from(columns),
  };
}

function kvSet(key, value) {
  if (!key) {
    throw new TypeError("Key is required");
  }
  const db = ensureDbReady();
  const sql =
    "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
  const stmt = db.prepare(sql);
  try {
    stmt.bind([key, value]);
    stmt.step();
  } finally {
    stmt.finalize();
  }
  return { key };
}

function kvGet(key) {
  if (!key) {
    throw new TypeError("Key is required");
  }
  const db = ensureDbReady();
  let value = null;
  let exists = false;
  db.exec({
    sql: "SELECT value FROM kv WHERE key = ?1 LIMIT 1",
    bind: [key],
    rowMode: "object",
    callback: (row) => {
      exists = true;
      value = row?.value ?? null;
    },
  });
  return { key, value, exists };
}

function closeDatabase() {
  if (dbHandle) {
    try {
      dbHandle.close();
    } catch (error) {
      console.warn("Failed to close SQLite database cleanly", error);
    }
  }
  dbHandle = null;
  sqlite3Module = null;
  initializationPromise = null;
}

async function removeDatabaseFile(dbName) {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.getDirectory === "function" &&
    typeof dbName === "string" &&
    dbName.trim().length
  ) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(dbName, { recursive: true });
      return true;
    } catch (error) {
      if (error?.name !== "NotFoundError") {
        console.warn("Failed to remove OPFS database file", error);
      }
    }
  }
  return false;
}

async function resetDatabase(options = {}) {
  const targetDbName =
    typeof options.dbName === "string" && options.dbName.trim().length
      ? options.dbName
      : currentDbName;

  closeDatabase();
  const removed = await removeDatabaseFile(targetDbName);
  return {
    cleared: true,
    removed,
    dbName: targetDbName,
  };
}

async function exportDatabase() {
  const db = ensureDbReady();
  
  // SQLite-WASM oo1 API: use export() to get database as Uint8Array
  if (typeof db.export === "function") {
    try {
      const bytes = db.export();
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        throw new Error("Export returned invalid or empty data");
      }
      // Convert Uint8Array to Array for JSON serialization across worker boundary
      return {
        bytes: Array.from(bytes),
        size: bytes.length,
        dbName: currentDbName,
      };
    } catch (error) {
      console.error("Database export via db.export() failed:", error);
      // Fall through to C API fallback
    }
  }
  
  // Fallback: try sqlite3_serialize via capi if available
  if (sqlite3Module?.capi?.sqlite3_serialize) {
    try {
      // oo1.DB objects may expose the underlying pointer via different properties
      // Try common property names used by SQLite-WASM
      const dbPtr = db.pointer || db.handle || (db.constructor?.name === "DB" && db);
      
      if (dbPtr) {
        // sqlite3_serialize(db, schema, pSize, flags)
        // Returns Uint8Array or null on error
        const bytes = sqlite3Module.capi.sqlite3_serialize(dbPtr, "main", null, 0);
        if (bytes && bytes instanceof Uint8Array && bytes.length > 0) {
          return {
            bytes: Array.from(bytes),
            size: bytes.length,
            dbName: currentDbName,
          };
        }
      }
    } catch (error) {
      console.error("Database export via sqlite3_serialize() failed:", error);
      // Fall through to final error
    }
  }
  
  throw new Error("Database export not supported - neither db.export() nor sqlite3_serialize() available");
}

async function processMessage(event) {
  const { data } = event;
  if (!data || typeof data.id !== "number") {
    return;
  }
  const { id, type, payload } = data;
  try {
    switch (type) {
      case "init":
        await handleInit(id, payload);
        break;
      case "exec": {
        const result = execStatement(payload?.sql, payload?.params);
        respondSuccess(id, result);
        break;
      }
      case "batch": {
        const statements = Array.isArray(payload?.statements) ? payload.statements : [];
        const result = execBatch(statements);
        respondSuccess(id, result);
        break;
      }
      case "query": {
        const result = runQuery(payload?.sql, payload?.params);
        respondSuccess(id, result);
        break;
      }
      case "kv:set": {
        const result = kvSet(payload?.key, payload?.value);
        respondSuccess(id, result);
        break;
      }
      case "kv:get": {
        const result = kvGet(payload?.key);
        respondSuccess(id, result);
        break;
      }
      case "layout:save": {
        const result = saveLayoutSnapshot(payload);
        respondSuccess(id, result);
        break;
      }
      case "layout:load": {
        const result = loadLayoutSnapshot(payload?.graphKey);
        respondSuccess(id, result);
        break;
      }
      case "layout:delete": {
        const result = deleteLayoutSnapshot(payload?.graphKey);
        respondSuccess(id, result);
        break;
      }
      case "layout:list": {
        const result = listLayoutSnapshots(payload);
        respondSuccess(id, result);
        break;
      }
      case "reset": {
        const result = await resetDatabase(payload || {});
        respondSuccess(id, result);
        break;
      }
      case "close": {
        closeDatabase();
        respondSuccess(id, { closed: true });
        break;
      }
      case "export": {
        const result = await exportDatabase();
        respondSuccess(id, result);
        break;
      }
      case "retention:enforce": {
        // Manual trigger for retention cleanup (useful for testing or user-initiated cleanup)
        const result = await enforceRetentionPolicy(dbHandle, kvGet);
        respondSuccess(id, result);
        break;
      }
      default:
        throw new Error(`Unknown storage worker message type: ${type}`);
    }
  } catch (error) {
    respondError(id, error);
  }
}

self.addEventListener("message", (event) => {
  enqueue(() => processMessage(event));
});

self.addEventListener("close", () => {
  closeDatabase();
});

function saveLayoutSnapshot(payload = {}) {
  const { graphKey, graphHash, layout, metadata, layoutVersion = 1, nodeCount } = payload;
  if (!graphKey || typeof graphKey !== "string") {
    throw new TypeError("graphKey is required to save a layout snapshot");
  }
  if (!Array.isArray(layout)) {
    throw new TypeError("layout must be an array when saving snapshot");
  }

  const db = ensureDbReady();
  const serializedLayout = JSON.stringify(layout);
  const serializedMetadata = metadata === null || metadata === undefined ? null : JSON.stringify(metadata);
  const now = new Date().toISOString();
  const resolvedNodeCount = Number.isFinite(nodeCount) ? Math.max(0, nodeCount) : layout.length;
  const resolvedLayoutVersion = Number.isFinite(layoutVersion) ? Math.max(1, Math.floor(layoutVersion)) : 1;

  const sql = `
    INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, layout_version, node_count, metadata_json, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    ON CONFLICT(graph_key) DO UPDATE SET
      graph_hash=excluded.graph_hash,
      layout_json=excluded.layout_json,
      layout_version=excluded.layout_version,
      node_count=excluded.node_count,
      metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at
  `;

  const stmt = db.prepare(sql);
  try {
    stmt.bind([
      graphKey.trim(),
      typeof graphHash === "string" ? graphHash : null,
      serializedLayout,
      resolvedLayoutVersion,
      resolvedNodeCount,
      serializedMetadata,
      now,
    ]);
    stmt.step();
  } finally {
    stmt.finalize();
  }

  return {
    graphKey: graphKey.trim(),
    updatedAt: now,
    nodeCount: resolvedNodeCount,
    layoutVersion: resolvedLayoutVersion,
  };
}

function loadLayoutSnapshot(graphKey) {
  if (!graphKey || typeof graphKey !== "string") {
    throw new TypeError("graphKey is required to load a layout snapshot");
  }
  const db = ensureDbReady();
  let record = null;
  db.exec({
    sql: `SELECT graph_key, graph_hash, layout_json, layout_version, node_count, metadata_json, created_at, updated_at
          FROM layout_snapshots
          WHERE graph_key = ?1
          LIMIT 1`,
    bind: [graphKey.trim()],
    rowMode: "object",
    callback: (row) => {
      record = row;
      return false;
    },
  });

  if (!record) {
    return null;
  }

  let layout = [];
  if (typeof record.layout_json === "string") {
    try {
      layout = JSON.parse(record.layout_json);
    } catch (error) {
      console.warn("Failed to parse layout JSON from storage", error);
      layout = [];
    }
  }

  let metadata = null;
  if (typeof record.metadata_json === "string") {
    try {
      metadata = JSON.parse(record.metadata_json);
    } catch (error) {
      console.warn("Failed to parse layout metadata JSON from storage", error);
      metadata = null;
    }
  }

  return {
    graphKey: record.graph_key,
    graphHash: record.graph_hash,
    layout,
    layoutVersion: typeof record.layout_version === "number" ? record.layout_version : 1,
    nodeCount:
      typeof record.node_count === "number" ? record.node_count : Array.isArray(layout) ? layout.length : 0,
    metadata,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function deleteLayoutSnapshot(graphKey) {
  if (!graphKey || typeof graphKey !== "string") {
    throw new TypeError("graphKey is required to delete a layout snapshot");
  }
  const db = ensureDbReady();
  const stmt = db.prepare("DELETE FROM layout_snapshots WHERE graph_key = ?1");
  try {
    stmt.bind([graphKey.trim()]);
    stmt.step();
  } finally {
    stmt.finalize();
  }
  return { graphKey: graphKey.trim() };
}

function listLayoutSnapshots(options = {}) {
  const db = ensureDbReady();
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 20;
  const order = typeof options.order === "string" && options.order.toLowerCase() === "asc" ? "ASC" : "DESC";
  const hasGraphKey = typeof options.graphKey === "string" && options.graphKey.trim().length > 0;

  const rows = [];
  const sql = hasGraphKey
    ? `SELECT graph_key, graph_hash, layout_version, node_count, created_at, updated_at
       FROM layout_snapshots
       WHERE graph_key = ?1
       ORDER BY updated_at ${order}
       LIMIT ?2`
    : `SELECT graph_key, graph_hash, layout_version, node_count, created_at, updated_at
       FROM layout_snapshots
       ORDER BY updated_at ${order}
       LIMIT ?1`;

  const bind = hasGraphKey ? [options.graphKey.trim(), limit] : [limit];
  db.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row) => {
      rows.push({
        graphKey: row.graph_key,
        graphHash: row.graph_hash,
        layoutVersion: typeof row.layout_version === "number" ? row.layout_version : 1,
        nodeCount: typeof row.node_count === "number" ? row.node_count : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    },
  });

  return { snapshots: rows };
}


