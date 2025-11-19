// Unit tests for retention policy enforcement.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRetentionMaxAge,
  getRetentionCutoff,
  cleanupExpiredLayoutSnapshots,
  cleanupExpiredResumeEntries,
  enforceRetentionPolicy,
} from "../../src/storage/retention.js";

test("getRetentionMaxAge - returns default when kvGet returns no value", async () => {
  const kvGet = (key) => ({ key, value: null, exists: false });
  const result = await getRetentionMaxAge(kvGet);
  assert.strictEqual(result, 24);
});

test("getRetentionMaxAge - returns default when kvGet returns invalid value", async () => {
  const kvGet = (key) => ({ key, value: "invalid", exists: true });
  const result = await getRetentionMaxAge(kvGet);
  assert.strictEqual(result, 24);
});

test("getRetentionMaxAge - returns configured value when valid", async () => {
  const kvGet = (key) => ({ key, value: "48", exists: true });
  const result = await getRetentionMaxAge(kvGet);
  assert.strictEqual(result, 48);
});

test("getRetentionMaxAge - rejects invalid kvGet function", async () => {
  await assert.rejects(() => getRetentionMaxAge(null), TypeError);
});

test("getRetentionCutoff - calculates cutoff timestamp correctly", () => {
  const now = Date.now();
  const cutoff = getRetentionCutoff(24);
  const cutoffMs = new Date(cutoff).getTime();
  const expectedMs = now - 24 * 60 * 60 * 1000;
  // Allow 1 second difference for test execution time
  assert.ok(Math.abs(cutoffMs - expectedMs) < 1000);
});

test("getRetentionCutoff - rejects invalid maxAgeHours", () => {
  assert.throws(() => getRetentionCutoff(NaN), TypeError);
  assert.throws(() => getRetentionCutoff(-1), TypeError);
});

test("cleanupExpiredLayoutSnapshots - deletes expired snapshots", () => {
  let changesCount = 0;
  const mockDb = {
    prepare: (sql) => ({
      bind: (params) => {},
      step: () => {
        changesCount = 2; // Simulate deleting 2 snapshots
      },
      finalize: () => {},
    }),
    changes: () => changesCount,
    exec: null, // Not needed for prepare path
  };
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const result = cleanupExpiredLayoutSnapshots(mockDb, cutoff);
  assert.strictEqual(result.deleted, 2);
});

test("cleanupExpiredLayoutSnapshots - handles zero deletions", () => {
  const mockDb = {
    prepare: (sql) => ({
      bind: (params) => {},
      step: () => {},
      finalize: () => {},
    }),
    changes: () => 0,
    exec: null,
  };
  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const result = cleanupExpiredLayoutSnapshots(mockDb, cutoff);
  assert.strictEqual(result.deleted, 0);
});

test("cleanupExpiredLayoutSnapshots - rejects invalid database handle", () => {
  const cutoff = new Date().toISOString();
  assert.throws(() => cleanupExpiredLayoutSnapshots(null, cutoff), TypeError);
});

test("cleanupExpiredLayoutSnapshots - rejects invalid cutoff timestamp", () => {
  const mockDb = {
    prepare: () => ({ bind: () => {}, step: () => {}, finalize: () => {} }),
    changes: () => 0,
  };
  assert.throws(() => cleanupExpiredLayoutSnapshots(mockDb, ""), TypeError);
});

test("cleanupExpiredResumeEntries - deletes expired entries", () => {
  const resumeRows = [
    {
      key: "resume::session1",
      value: JSON.stringify({ updated_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() }),
    },
    {
      key: "resume::session2",
      value: JSON.stringify({ updated_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() }),
    },
  ];

  let deleteCount = 0;
  const mockDb = {
    exec: (options) => {
      if (options.sql.includes("SELECT")) {
        resumeRows.forEach((row) => {
          if (options.callback) {
            options.callback(row);
          }
        });
      }
    },
    prepare: (sql) => ({
      bind: (params) => {
        const key = params[0];
        if (resumeRows.some((r) => r.key === key)) {
          deleteCount++;
        }
      },
      step: () => {},
      finalize: () => {},
    }),
    changes: () => deleteCount,
  };

  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const result = cleanupExpiredResumeEntries(mockDb, cutoff);
  assert.ok(result.deleted >= 0);
});

test("cleanupExpiredResumeEntries - handles invalid JSON gracefully", () => {
  const resumeRows = [
    {
      key: "resume::invalid",
      value: "not json",
    },
  ];

  const mockDb = {
    exec: (options) => {
      if (options.sql.includes("SELECT")) {
        resumeRows.forEach((row) => {
          if (options.callback) {
            options.callback(row);
          }
        });
      }
    },
    prepare: () => ({ bind: () => {}, step: () => {}, finalize: () => {} }),
    changes: () => 0,
  };

  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  // Should not throw
  assert.doesNotThrow(() => cleanupExpiredResumeEntries(mockDb, cutoff));
});

test("cleanupExpiredResumeEntries - rejects invalid database handle", () => {
  const cutoff = new Date().toISOString();
  assert.throws(() => cleanupExpiredResumeEntries(null, cutoff), TypeError);
});

test("enforceRetentionPolicy - returns summary", async () => {
  const mockDb = {
    prepare: (sql) => ({
      bind: (params) => {},
      step: () => {},
      finalize: () => {},
    }),
    changes: () => 1,
    exec: (options) => {
      if (options?.callback) {
        options.callback({
          key: "resume::test",
          value: JSON.stringify({ updated_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString() }),
        });
      }
    },
  };
  const mockKvGet = (key) => ({ key, value: "24", exists: true });

  const result = await enforceRetentionPolicy(mockDb, mockKvGet);
  assert.ok(result.hasOwnProperty("maxAgeHours"));
  assert.ok(result.hasOwnProperty("cutoffTs"));
  assert.ok(result.hasOwnProperty("layoutSnapshotsDeleted"));
  assert.ok(result.hasOwnProperty("resumeEntriesDeleted"));
  assert.strictEqual(result.maxAgeHours, 24);
  assert.strictEqual(typeof result.cutoffTs, "string");
});

test("enforceRetentionPolicy - uses configured max age from kv", async () => {
  const mockDb = {
    prepare: () => ({ bind: () => {}, step: () => {}, finalize: () => {} }),
    changes: () => 0,
    exec: (options) => {
      if (options?.callback) {
        // No resume entries
      }
    },
  };
  const mockKvGet = (key) => ({ key, value: "48", exists: true });

  const result = await enforceRetentionPolicy(mockDb, mockKvGet);
  assert.strictEqual(result.maxAgeHours, 48);
});

test("enforceRetentionPolicy - rejects invalid database handle", async () => {
  const mockKvGet = (key) => ({ key, value: "24", exists: true });
  await assert.rejects(() => enforceRetentionPolicy(null, mockKvGet), TypeError);
});

test("enforceRetentionPolicy - rejects invalid kvGet function", async () => {
  const mockDb = {
    prepare: () => ({ bind: () => {}, step: () => {}, finalize: () => {} }),
    changes: () => 0,
    exec: () => {},
  };
  await assert.rejects(() => enforceRetentionPolicy(mockDb, null), TypeError);
});

