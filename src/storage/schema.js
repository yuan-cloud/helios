// Schema definition and metadata helpers for the HELIOS SQLite datastore.
// This module translates PLAN.md section 6 into concrete SQL statements and
// exposes helper utilities for schema management and migrations.

export const HELIOS_DB_NAME = "helios.sqlite3";
export const HELIOS_SCHEMA_VERSION = 2;

export const METADATA_KEYS = Object.freeze({
  SCHEMA_VERSION: "schema.version",
  SCHEMA_CREATED_AT: "schema.created_at",
  SCHEMA_UPDATED_AT: "schema.updated_at",
});

/**
 * Statements that must run before any other schema changes. These are kept
 * separate so callers can ensure foreign keys and the metadata table exist
 * prior to running migrations.
 */
export function getBootstrapStatements() {
  return [
    "PRAGMA journal_mode = WAL",
    "PRAGMA foreign_keys = ON",
    `CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ];
}

/**
 * Returns the set of SQL statements that represent the initial schema for
 * HELIOS, aligning with PLAN.md section 6.
 */
export function getInitialSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS files (
      file_id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      lang TEXT,
      sha1 TEXT,
      bytes INTEGER,
      UNIQUE(path)
    )`,
    `CREATE TABLE IF NOT EXISTS functions (
      fn_id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      fq_name TEXT,
      start INTEGER NOT NULL,
      "end" INTEGER NOT NULL,
      loc INTEGER,
      doc TEXT,
      metrics_json TEXT,
      UNIQUE(file_id, name, start)
    )`,
    `CREATE TABLE IF NOT EXISTS chunks (
      chunk_id INTEGER PRIMARY KEY,
      fn_id INTEGER NOT NULL REFERENCES functions(fn_id) ON DELETE CASCADE,
      start INTEGER NOT NULL,
      "end" INTEGER NOT NULL,
      tok_count INTEGER,
      UNIQUE(fn_id, start, "end")
    )`,
    `CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
      vec BLOB NOT NULL,
      dim INTEGER NOT NULL,
      quant TEXT,
      backend TEXT,
      model TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS call_edges (
      src_fn_id INTEGER NOT NULL REFERENCES functions(fn_id) ON DELETE CASCADE,
      dst_fn_id INTEGER NOT NULL REFERENCES functions(fn_id) ON DELETE CASCADE,
      weight INTEGER DEFAULT 1,
      flags INTEGER DEFAULT 0,
      PRIMARY KEY (src_fn_id, dst_fn_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sim_edges (
      a_fn_id INTEGER NOT NULL REFERENCES functions(fn_id) ON DELETE CASCADE,
      b_fn_id INTEGER NOT NULL REFERENCES functions(fn_id) ON DELETE CASCADE,
      sim REAL NOT NULL,
      method TEXT,
      CHECK (a_fn_id != b_fn_id),
      PRIMARY KEY (a_fn_id, b_fn_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path ON files(path)`,
    `CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_fn ON chunks(fn_id)`,
    `CREATE INDEX IF NOT EXISTS idx_call_edges_dst ON call_edges(dst_fn_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sim_edges_score ON sim_edges(sim DESC)`,
    `CREATE TABLE IF NOT EXISTS layout_snapshots (
      snapshot_id INTEGER PRIMARY KEY,
      graph_key TEXT NOT NULL,
      graph_hash TEXT,
      layout_json TEXT NOT NULL,
      layout_version INTEGER NOT NULL DEFAULT 1,
      node_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(graph_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_layout_snapshots_graph_hash ON layout_snapshots(graph_hash)`
  ];
}

/**
 * Returns the default metadata payload to write after applying the base schema.
 */
export function getInitialMetadataEntries() {
  const now = new Date().toISOString();
  return [
    {
      key: METADATA_KEYS.SCHEMA_VERSION,
      value: String(HELIOS_SCHEMA_VERSION),
    },
    {
      key: METADATA_KEYS.SCHEMA_CREATED_AT,
      value: now,
    },
    {
      key: METADATA_KEYS.SCHEMA_UPDATED_AT,
      value: now,
    },
  ];
}


