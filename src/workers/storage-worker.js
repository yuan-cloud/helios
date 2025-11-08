import { initializeDatabase } from "../storage/sqlite.js";
import { METADATA_KEYS } from "../storage/schema.js";

let sqlite3Module = null;
let dbHandle = null;
let initializationPromise = null;

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
    initializationPromise = initializeDatabase(payload?.config).then((result) => {
      sqlite3Module = result.sqlite3;
      dbHandle = result.db;
      return {
        persistent: result.persistent,
        schemaVersion: result.schemaVersion,
        metadata: {
          schemaVersionKey: METADATA_KEYS.SCHEMA_VERSION,
        },
      };
    });
  }
  const initResult = await initializationPromise;
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
      case "close": {
        closeDatabase();
        respondSuccess(id, { closed: true });
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


