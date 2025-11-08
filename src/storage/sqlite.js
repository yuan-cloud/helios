// SQLite-WASM initialization and schema management helpers.
// Responsibilities:
//   - Lazy-load `@sqlite.org/sqlite-wasm` from CDN with error handling.
//   - Prefer OPFS-backed persistence when available, fall back to memory DB.
//   - Apply the HELIOS schema (PLAN.md section 6) with version metadata.

import {
  HELIOS_DB_NAME,
  HELIOS_SCHEMA_VERSION,
  METADATA_KEYS,
  getBootstrapStatements,
  getInitialMetadataEntries,
  getInitialSchemaStatements,
} from "./schema.js";
import { getPendingMigrations } from "./migrations.js";

const SQLITE_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.46.1-build5/sqlite-wasm/jswasm";
const SQLITE_WASM_MODULE_URL = `${SQLITE_WASM_BASE}/sqlite3.mjs`;
const SQLITE_WASM_WASM_URL = `${SQLITE_WASM_BASE}/sqlite3.wasm`;

let sqliteModulePromise = null;

/**
 * Determines whether OPFS is available in the current browsing context.
 */
export async function isOpfsSupported() {
  if (
    typeof navigator === "undefined" ||
    !("storage" in navigator) ||
    typeof navigator.storage?.getDirectory !== "function"
  ) {
    return false;
  }
  try {
    const handle = await navigator.storage.getDirectory();
    return Boolean(handle);
  } catch (error) {
    console.debug("OPFS root acquisition failed; falling back to in-memory DB.", error);
    return false;
  }
}

/**
 * Attempt to upgrade the origin's storage persistence.
 */
async function requestPersistentStorage() {
  try {
    if (typeof navigator === "object" && typeof navigator.storage?.persist === "function") {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.debug("navigator.storage.persist() rejected", error);
  }
}

/**
 * Load the sqlite3 WASM module (memoized).
 */
export async function loadSQLiteModule(moduleOverrides = {}) {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import(SQLITE_WASM_MODULE_URL)
      .then((module) => module.default)
      .then((initSQLite) =>
        initSQLite({
          locateFile: (file) => {
            if (file.endsWith(".wasm")) {
              return SQLITE_WASM_WASM_URL;
            }
            return `${SQLITE_WASM_BASE}/${file}`;
          },
          print: moduleOverrides.print ?? console.log,
          printErr: moduleOverrides.printErr ?? console.error,
          ...moduleOverrides,
        })
      )
      .catch((error) => {
        sqliteModulePromise = null;
        throw error;
      });
  }
  return sqliteModulePromise;
}

/**
 * Helper to safely run a series of SQL statements.
 */
function executeStatements(db, statements) {
  for (const statement of statements) {
    db.exec(statement);
  }
}

/**
 * Retrieve single scalar value via selectValue or exec fallback.
 */
function selectScalar(db, sql, bindArgs = []) {
  if (typeof db.selectValue === "function") {
    return db.selectValue(sql, bindArgs);
  }

  let result;
  db.exec({
    sql,
    bind: bindArgs,
    rowMode: "array",
    callback: (row) => {
      result = row[0];
      return false;
    },
  });
  return result;
}

/**
 * Insert metadata key/value pairs with parameter binding.
 */
function upsertMetadata(db, entries) {
  if (!entries.length) {
    return;
  }
  const sql =
    "INSERT INTO kv(key, value) VALUES(?1, ?2) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value";
  if (typeof db.prepare === "function") {
    const stmt = db.prepare(sql);
    try {
      for (const { key, value } of entries) {
        stmt.bind([key, value]);
        stmt.step();
        stmt.reset();
      }
    } finally {
      stmt.finalize();
    }
    return;
  }

  for (const { key, value } of entries) {
    db.exec({ sql, bind: [key, value] });
  }
}

/**
 * Apply base schema and record metadata.
 */
function ensureSchema(db) {
  executeStatements(db, getBootstrapStatements());

  const metadataVersion = selectScalar(
    db,
    "SELECT value FROM kv WHERE key = ?1",
    [METADATA_KEYS.SCHEMA_VERSION]
  );
  const currentVersion = metadataVersion ? Number.parseInt(metadataVersion, 10) : null;

  if (currentVersion && currentVersion > HELIOS_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version (${currentVersion}) is newer than supported (${HELIOS_SCHEMA_VERSION}).`
    );
  }

  if (currentVersion === HELIOS_SCHEMA_VERSION) {
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (currentVersion === null) {
      executeStatements(db, getInitialSchemaStatements());
      upsertMetadata(db, getInitialMetadataEntries());
    } else if (currentVersion < HELIOS_SCHEMA_VERSION) {
      const migrations = getPendingMigrations(currentVersion);
      if (migrations.length === 0) {
        throw new Error(
          `Schema version ${currentVersion} is behind but no migrations are registered.`
        );
      }
      for (const migration of migrations) {
        executeStatements(db, migration.statements);
      }
      upsertMetadata(db, [
        {
          key: METADATA_KEYS.SCHEMA_VERSION,
          value: String(HELIOS_SCHEMA_VERSION),
        },
        {
          key: METADATA_KEYS.SCHEMA_UPDATED_AT,
          value: new Date().toISOString(),
        },
      ]);
    }

    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.warn("Failed rolling back schema transaction", rollbackError);
    }
    throw error;
  }
}

/**
 * Open a database, preferring OPFS persistence with graceful fallback.
 */
async function openDatabase(sqlite3, options = {}) {
  const { dbName = HELIOS_DB_NAME, flags = "c" } = options;

  const hasOpfs = await isOpfsSupported();
  if (hasOpfs) {
    await requestPersistentStorage();
    const OpfsDb = sqlite3?.oo1?.OpfsDb;
    if (OpfsDb) {
      try {
        let db;
        const isConstructor = typeof OpfsDb === "function" && OpfsDb.prototype;
        if (isConstructor) {
          db = new OpfsDb(dbName, { flags });
        } else {
          const result = OpfsDb(dbName, { flags });
          db = result instanceof Promise ? await result : result;
        }
        return { db, persistent: true };
      } catch (error) {
        console.warn("Failed to open OPFS-backed SQLite database, falling back to memory", error);
      }
    }
    try {
      const db = new sqlite3.oo1.DB(dbName, { flags, vfs: "opfs" });
      return { db, persistent: true };
    } catch (error) {
      console.warn("oo1.DB OPFS open failed; falling back to memory DB", error);
    }
  }

  const db = new sqlite3.oo1.DB(":memory:", { flags: "c" });
  return { db, persistent: false };
}

/**
 * Initialize and return an object with the sqlite3 module, database handle,
 * and persistence status.
 */
export async function initializeDatabase(config = {}) {
  const sqlite3 = await loadSQLiteModule(config.moduleOverrides);
  const { db, persistent } = await openDatabase(sqlite3, config);

  ensureSchema(db);

  return {
    sqlite3,
    db,
    persistent,
    schemaVersion: HELIOS_SCHEMA_VERSION,
  };
}


