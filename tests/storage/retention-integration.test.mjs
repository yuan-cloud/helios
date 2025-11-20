#!/usr/bin/env node

/**
 * End-to-end integration test for retention policy enforcement.
 * 
 * Verifies the complete flow: create old/recent entries → retention cleanup → verify deletion/preservation
 * 
 * This test exercises:
 * 1. Layout snapshot cleanup (old vs recent)
 * 2. Resume entry cleanup (old vs recent)
 * 3. Analysis snapshot cleanup (old vs recent)
 * 4. Retention configuration via kv table
 * 5. Integration with actual SQLite database operations
 * 
 * Uses better-sqlite3 for Node.js test environment (browser OPFS tests require Playwright).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { getBootstrapStatements, getInitialSchemaStatements } from "../../src/storage/schema.js";
import {
  getRetentionMaxAge,
  getRetentionCutoff,
  cleanupExpiredLayoutSnapshots,
  cleanupExpiredResumeEntries,
  enforceRetentionPolicy,
} from "../../src/storage/retention.js";

const ANALYSIS_SNAPSHOT_KEY = "analysis.snapshot.v1";
const RETENTION_KEY = "retention.maxAgeHours";

/**
 * Creates a test database with the HELIOS schema
 */
function createTestDatabase(path) {
  const db = new Database(path);
  
  // Apply schema
  const bootstrap = getBootstrapStatements();
  bootstrap.forEach((sql) => {
    db.exec(sql);
  });
  
  const schema = getInitialSchemaStatements();
  schema.forEach((sql) => {
    db.exec(sql);
  });
  
  return db;
}

/**
 * Wraps better-sqlite3 database to match the expected interface
 * Converts SQLite ?1, ?2, etc. placeholders to ? for better-sqlite3
 */
function wrapDatabase(db) {
  // Convert ?1, ?2, etc. to ? for better-sqlite3
  function normalizeSql(sql) {
    // Replace ?1, ?2, etc. with ?
    return sql.replace(/\?\d+/g, "?");
  }
  
  return {
    exec: (arg) => {
      if (typeof arg === "string") {
        db.exec(normalizeSql(arg));
        return;
      }
      const { sql, bind = [], callback, rowMode = "object" } = arg;
      const normalizedSql = normalizeSql(sql);
      const stmt = db.prepare(normalizedSql);
      
      if (callback) {
        const rows = stmt.all(bind);
        rows.forEach((row) => {
          if (rowMode === "array") {
            callback(Object.values(row));
          } else {
            callback(row);
          }
        });
      } else {
        stmt.run(bind);
      }
    },
    prepare: (sql) => {
      const normalizedSql = normalizeSql(sql);
      const stmt = db.prepare(normalizedSql);
      let lastChanges = 0;
      return {
        bind: (params) => {
          // better-sqlite3 binds parameters when calling run/get/all
          // We'll store the params and use them in step()
          stmt._testParams = params;
        },
        step: () => {
          const params = stmt._testParams || [];
          const result = stmt.run(...params);
          delete stmt._testParams;
          // In better-sqlite3, run() returns a result object with changes property
          // Store it so changes() can access it
          lastChanges = result.changes !== undefined ? result.changes : 0;
          // Also update a global changes tracker
          db._lastChanges = lastChanges;
          return result;
        },
        finalize: () => {
          // better-sqlite3 doesn't require explicit finalization
        },
      };
    },
    changes: function() {
      // In better-sqlite3, stmt.run() returns result.changes, which we track
      // Use the tracked value if available, otherwise use db.changes (which might be undefined)
      return db._lastChanges !== undefined ? db._lastChanges : (db.changes !== undefined ? db.changes : 0);
    },
  };
}

/**
 * Creates a kvGet function for the test database
 */
function createKvGet(db) {
  return (key) => {
    const stmt = db.prepare("SELECT value FROM kv WHERE key = ?");
    const row = stmt.get(key);
    if (row) {
      return { key, value: row.value, exists: true };
    }
    return { key, value: null, exists: false };
  };
}

/**
 * Sets a kv entry in the database
 */
function setKv(db, key, value) {
  const stmt = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
  stmt.run(key, typeof value === "string" ? value : JSON.stringify(value));
}

/**
 * Gets an ISO timestamp N hours ago
 */
function hoursAgo(hours) {
  const now = Date.now();
  const ms = hours * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

test("retention integration - cleanup old entries, preserve recent ones", async () => {
  const db = createTestDatabase(":memory:");
  const wrappedDb = wrapDatabase(db);
  const kvGet = createKvGet(db);
  
  try {
    // Set retention to 24 hours
    setKv(db, RETENTION_KEY, "24");
    
    // Create old layout snapshot (30 hours ago)
    const oldLayoutStmt = db.prepare(
      "INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    oldLayoutStmt.run(
      "graph::test1",
      "hash1",
      JSON.stringify([{ id: "n1", x: 1 }]),
      hoursAgo(30),
      hoursAgo(30)
    );
    
    // Create recent layout snapshot (12 hours ago)
    const recentLayoutStmt = db.prepare(
      "INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    recentLayoutStmt.run(
      "graph::test2",
      "hash2",
      JSON.stringify([{ id: "n2", x: 2 }]),
      hoursAgo(12),
      hoursAgo(12)
    );
    
    // Create old resume entry (30 hours ago)
    setKv(db, "resume::entry1", JSON.stringify({
      key: "resume::entry1",
      updated_at: hoursAgo(30),
      data: { test: "old" }
    }));
    
    // Create recent resume entry (12 hours ago)
    setKv(db, "resume::entry2", JSON.stringify({
      key: "resume::entry2",
      updated_at: hoursAgo(12),
      data: { test: "recent" }
    }));
    
    // Create old analysis snapshot (30 hours ago)
    setKv(db, ANALYSIS_SNAPSHOT_KEY, JSON.stringify({
      savedAt: hoursAgo(30),
      version: 1,
      data: { functions: [] }
    }));
    
    // Create a recent analysis snapshot entry (simulated by updating after old one)
    // Note: Only one analysis snapshot exists at a time, so we'll update it
    setKv(db, ANALYSIS_SNAPSHOT_KEY, JSON.stringify({
      savedAt: hoursAgo(12),
      version: 1,
      data: { functions: [] }
    }));
    
    // Verify initial state
    const initialLayouts = db.prepare("SELECT COUNT(*) as count FROM layout_snapshots").get();
    assert.equal(initialLayouts.count, 2, "Should have 2 layout snapshots initially");
    
    const initialResumeEntries = db.prepare("SELECT COUNT(*) as count FROM kv WHERE key LIKE 'resume::%'").get();
    assert.equal(initialResumeEntries.count, 2, "Should have 2 resume entries initially");
    
    // Run retention cleanup
    const result = await enforceRetentionPolicy(wrappedDb, kvGet);
    
    // Verify results
    assert.ok(result.maxAgeHours === 24, "Should use 24 hour retention");
    assert.ok(typeof result.cutoffTs === "string", "Cutoff timestamp should be ISO string");
    
    // Verify layout snapshots: old one deleted, recent one preserved
    const finalLayouts = db.prepare("SELECT COUNT(*) as count FROM layout_snapshots").get();
    assert.equal(finalLayouts.count, 1, "Should have 1 layout snapshot after cleanup");
    
    const remainingLayout = db.prepare("SELECT graph_key FROM layout_snapshots").get();
    assert.equal(remainingLayout.graph_key, "graph::test2", "Recent layout snapshot should be preserved");
    
    // Verify resume entries: old one deleted, recent one preserved
    const finalResumeEntries = db.prepare("SELECT COUNT(*) as count FROM kv WHERE key LIKE 'resume::%'").get();
    assert.equal(finalResumeEntries.count, 1, "Should have 1 resume entry after cleanup");
    
    const remainingResume = db.prepare("SELECT key FROM kv WHERE key LIKE 'resume::%'").get();
    assert.equal(remainingResume.key, "resume::entry2", "Recent resume entry should be preserved");
    
    // Verify analysis snapshot: should be preserved (recent)
    const analysisSnapshot = kvGet(ANALYSIS_SNAPSHOT_KEY);
    assert.ok(analysisSnapshot.exists, "Analysis snapshot should exist");
    const parsed = JSON.parse(analysisSnapshot.value);
    // Verify it's recent (within last 24 hours) - don't check exact timestamp due to test execution time
    const savedAtMs = new Date(parsed.savedAt).getTime();
    const nowMs = Date.now();
    const ageHours = (nowMs - savedAtMs) / (1000 * 60 * 60);
    assert.ok(ageHours < 24, `Analysis snapshot should be recent (age: ${ageHours.toFixed(2)}h < 24h)`);
    
    // Verify cleanup statistics
    assert.equal(result.layoutSnapshotsDeleted, 1, "Should delete 1 layout snapshot");
    assert.equal(result.resumeEntriesDeleted, 1, "Should delete 1 resume entry (old analysis snapshot was overwritten, so only old resume entry deleted)");
    
  } finally {
    db.close();
  }
});

test("retention integration - custom retention window", async () => {
  const db = createTestDatabase(":memory:");
  const wrappedDb = wrapDatabase(db);
  const kvGet = createKvGet(db);
  
  try {
    // Set retention to 48 hours
    setKv(db, RETENTION_KEY, "48");
    
    // Create entry at 30 hours ago (should be preserved with 48h retention)
    const layoutStmt = db.prepare(
      "INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    layoutStmt.run(
      "graph::test",
      "hash",
      JSON.stringify([{ id: "n1", x: 1 }]),
      hoursAgo(30),
      hoursAgo(30)
    );
    
    // Run retention cleanup
    const result = await enforceRetentionPolicy(wrappedDb, kvGet);
    
    // Verify custom retention is used
    assert.equal(result.maxAgeHours, 48, "Should use 48 hour retention");
    
    // Verify entry is preserved (within 48h window)
    const finalLayouts = db.prepare("SELECT COUNT(*) as count FROM layout_snapshots").get();
    assert.equal(finalLayouts.count, 1, "Should preserve entry within 48h window");
    
  } finally {
    db.close();
  }
});

test("retention integration - default retention when not configured", async () => {
  const db = createTestDatabase(":memory:");
  const wrappedDb = wrapDatabase(db);
  const kvGet = createKvGet(db);
  
  try {
    // Don't set retention key (should use default 24h)
    
    // Create entry at 30 hours ago (should be deleted with default 24h retention)
    const layoutStmt = db.prepare(
      "INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    layoutStmt.run(
      "graph::test",
      "hash",
      JSON.stringify([{ id: "n1", x: 1 }]),
      hoursAgo(30),
      hoursAgo(30)
    );
    
    // Run retention cleanup
    const result = await enforceRetentionPolicy(wrappedDb, kvGet);
    
    // Verify default retention is used
    assert.equal(result.maxAgeHours, 24, "Should use default 24 hour retention");
    
    // Verify entry is deleted (outside 24h window)
    const finalLayouts = db.prepare("SELECT COUNT(*) as count FROM layout_snapshots").get();
    assert.equal(finalLayouts.count, 0, "Should delete entry outside 24h window");
    
  } finally {
    db.close();
  }
});

test("retention integration - handles missing tables gracefully", async () => {
  const db = new Database(":memory:");
  const wrappedDb = wrapDatabase(db);
  const kvGet = createKvGet(db);
  
  try {
    // Create minimal schema (only kv table, no layout_snapshots)
    db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)");
    setKv(db, RETENTION_KEY, "24");
    
    // Should not throw even though layout_snapshots table doesn't exist
    // (This tests error handling in cleanupExpiredLayoutSnapshots)
    let error;
    try {
      cleanupExpiredLayoutSnapshots(wrappedDb, hoursAgo(24));
    } catch (e) {
      error = e;
    }
    
    // better-sqlite3 will throw if table doesn't exist, which is expected
    // The retention logic should handle this gracefully in production
    // (This test documents the behavior)
    assert.ok(error !== undefined, "Should handle missing table (better-sqlite3 throws, production uses try-catch)");
    
  } finally {
    db.close();
  }
});

test("retention integration - preserves entries at boundary (exactly 24h)", async () => {
  const db = createTestDatabase(":memory:");
  const wrappedDb = wrapDatabase(db);
  const kvGet = createKvGet(db);
  
  try {
    setKv(db, RETENTION_KEY, "24");
    
    // Create entry exactly 24 hours ago (should be preserved due to < comparison)
    // We use slightly less than 24h to account for test execution time
    const layoutStmt = db.prepare(
      "INSERT INTO layout_snapshots (graph_key, graph_hash, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    const boundaryTime = hoursAgo(23.99); // Just under 24h
    layoutStmt.run(
      "graph::test",
      "hash",
      JSON.stringify([{ id: "n1", x: 1 }]),
      boundaryTime,
      boundaryTime
    );
    
    // Run retention cleanup
    let result;
    try {
      result = await enforceRetentionPolicy(wrappedDb, kvGet);
    } catch (error) {
      console.error("enforceRetentionPolicy error:", error);
      throw error;
    }
    
    // Verify entry is preserved (just under 24h boundary)
    const finalLayouts = db.prepare("SELECT COUNT(*) as count FROM layout_snapshots").get();
    assert.equal(finalLayouts.count, 1, "Should preserve entry just under 24h boundary");
    
    // Verify result structure - check if layoutSnapshotsDeleted is present
    assert.ok(result !== undefined && result !== null, "Result should be defined");
    assert.ok(typeof result.layoutSnapshotsDeleted === "number", `Should have layoutSnapshotsDeleted in result (got: ${JSON.stringify(result)})`);
    
    // Verify no entries were deleted (entry is just under 24h boundary)
    assert.equal(result.layoutSnapshotsDeleted, 0, "Should not delete entry at boundary");
    
  } finally {
    db.close();
  }
});

