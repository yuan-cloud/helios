import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HELIOS_SCHEMA_VERSION,
  METADATA_KEYS,
  getBootstrapStatements,
  getInitialMetadataEntries,
  getInitialSchemaStatements,
} from "../../src/storage/schema.js";
import { isOpfsSupported } from "../../src/storage/sqlite.js";

test("bootstrap statements enable WAL, foreign keys, and kv table", () => {
  const statements = getBootstrapStatements();
  assert.ok(
    statements.includes("PRAGMA journal_mode = WAL"),
    "journal_mode pragma should be present"
  );
  assert.ok(
    statements.includes("PRAGMA foreign_keys = ON"),
    "foreign_keys pragma should be present"
  );
  const kvStatement = statements.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS kv"));
  assert.ok(kvStatement, "kv table creation statement is required");
});

test("initial schema statements cover all PLAN.md tables", () => {
  const statements = getInitialSchemaStatements();
  const joined = statements.join("\n");
  for (const table of ["files", "functions", "chunks", "embeddings", "call_edges", "sim_edges"]) {
    assert.match(joined, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(joined, /CREATE UNIQUE INDEX IF NOT EXISTS idx_files_path/);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_call_edges_dst/);
});

test("metadata entries include versioning keys", () => {
  const entries = getInitialMetadataEntries();
  const byKey = Object.fromEntries(entries.map(({ key, value }) => [key, value]));
  assert.strictEqual(byKey[METADATA_KEYS.SCHEMA_VERSION], String(HELIOS_SCHEMA_VERSION));
  assert.ok(byKey[METADATA_KEYS.SCHEMA_CREATED_AT], "created_at should be recorded");
  assert.ok(byKey[METADATA_KEYS.SCHEMA_UPDATED_AT], "updated_at should be recorded");
});

test("isOpfsSupported gracefully handles missing navigator", async () => {
  const originalNavigator = globalThis.navigator;
  try {
    delete globalThis.navigator;
  } catch {
    globalThis.navigator = undefined;
  }
  const result = await isOpfsSupported();
  assert.strictEqual(result, false);
  if (originalNavigator === undefined) {
    delete globalThis.navigator;
  } else {
    globalThis.navigator = originalNavigator;
  }
});

test("isOpfsSupported detects OPFS support when available", async () => {
  const originalNavigator = globalThis.navigator;
  const fakeHandle = {};
  globalThis.navigator = {
    storage: {
      async getDirectory() {
        return fakeHandle;
      },
      async persist() {
        return true;
      },
    },
  };
  const result = await isOpfsSupported();
  assert.strictEqual(result, true);

  if (originalNavigator === undefined) {
    delete globalThis.navigator;
  } else {
    globalThis.navigator = originalNavigator;
  }
});


