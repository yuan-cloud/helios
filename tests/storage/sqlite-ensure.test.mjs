import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HELIOS_SCHEMA_VERSION,
  METADATA_KEYS,
  getBootstrapStatements,
  getInitialMetadataEntries,
  getInitialSchemaStatements,
} from "../../src/storage/schema.js";
import { ensureSchema } from "../../src/storage/sqlite.js";
import { MIGRATIONS } from "../../src/storage/migrations.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bound = null;
  }

  bind(params) {
    this.bound = params;
  }

  step() {
    if (this.sql.includes("INSERT INTO kv")) {
      const [key, value] = this.bound;
      this.db.metadataWrites.push({ key, value });
    }
  }

  reset() {
    // no-op
  }

  finalize() {
    // no-op
  }
}

class FakeDb {
  constructor() {
    this.executed = [];
    this.metadataValue = null;
    this.metadataWrites = [];
  }

  exec(arg) {
    if (typeof arg === "string") {
      this.executed.push(arg);
      return;
    }
    const { sql, callback, rowMode } = arg;
    this.executed.push(sql);
    if (sql.includes("SELECT value FROM kv") && callback) {
      if (this.metadataValue !== null && this.metadataValue !== undefined) {
        const row =
          rowMode === "array" ? [this.metadataValue] : { value: this.metadataValue };
        const shouldContinue = callback(row);
        if (shouldContinue === false) {
          return;
        }
      }
    }
  }

  prepare(sql) {
    this.executed.push(sql);
    return new FakeStatement(this, sql);
  }
}

test("ensureSchema creates initial schema and metadata when empty", () => {
  const db = new FakeDb();
  ensureSchema(db);

  const bootstrap = getBootstrapStatements();
  bootstrap.forEach((statement) => {
    assert.ok(
      db.executed.includes(statement),
      `bootstrap statement "${statement}" should execute`
    );
  });

  const initialStatements = getInitialSchemaStatements();
  initialStatements.forEach((statement) => {
    assert.ok(
      db.executed.includes(statement),
      `initial schema statement "${statement}" should execute`
    );
  });

  const metadataEntries = getInitialMetadataEntries();
  metadataEntries.forEach(({ key }) => {
    const write = db.metadataWrites.find((entry) => entry.key === key);
    assert.ok(write, `metadata key "${key}" should be written`);
  });
});

test("ensureSchema exits early if schema version matches", () => {
  const db = new FakeDb();
  db.metadataValue = String(HELIOS_SCHEMA_VERSION);
  ensureSchema(db);

  // Should execute bootstrap statements but skip transactional/migration statements.
  const hasBegin = db.executed.some((sql) => typeof sql === "string" && sql.includes("BEGIN"));
  const initialStatements = getInitialSchemaStatements();
  const appliedInitialSchema = initialStatements.some((statement) =>
    db.executed.includes(statement)
  );
  assert.equal(hasBegin, false, "should not open transaction when schema is up to date");
  assert.equal(
    appliedInitialSchema,
    false,
    "should not recreate main tables when schema is up to date"
  );
});

test("ensureSchema throws when migrations missing for older version", () => {
  const db = new FakeDb();
  db.metadataValue = String(HELIOS_SCHEMA_VERSION - 1);

  const originalMigrations = MIGRATIONS.splice(0, MIGRATIONS.length);
  try {
    assert.throws(
      () => ensureSchema(db),
      /no migrations are registered/i,
      "should throw when migrations array empty"
    );
  } finally {
    MIGRATIONS.push(...originalMigrations);
  }
});

test("ensureSchema applies registered migrations for newer schema versions", () => {
  const db = new FakeDb();
  db.metadataValue = String(HELIOS_SCHEMA_VERSION - 1);

  ensureSchema(db);

  const updateEntry = db.metadataWrites.find(
    (entry) => entry.key === METADATA_KEYS.SCHEMA_VERSION
  );
  assert.ok(updateEntry, "schema version metadata should be updated after migration");
  assert.equal(updateEntry.value, String(HELIOS_SCHEMA_VERSION));

  const layoutTableStatement = db.executed.find((sql) =>
    typeof sql === "string" && sql.includes("CREATE TABLE IF NOT EXISTS layout_snapshots")
  );
  assert.ok(
    layoutTableStatement,
    "layout_snapshots table should be created during migration"
  );
});


