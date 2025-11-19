// Tests for data compatibility checking and cache invalidation utilities.
// Tests ensure version checking works correctly and cache invalidation
// prevents stale data issues.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDataCompatibility,
  generateVersionedCacheKey,
  validateSnapshotVersion,
  shouldInvalidateData,
} from "../../src/storage/data-compatibility.js";
import { HELIOS_APP_VERSION, HELIOS_SCHEMA_VERSION, METADATA_KEYS } from "../../src/storage/schema.js";
import { LAYOUT_SNAPSHOT_VERSION } from "../../src/storage/layout-persistence.js";
import { SNAPSHOT_VERSION } from "../../src/storage/resume-flow.js";

test("checkDataCompatibility returns incompatible if client is null", async () => {
  const result = await checkDataCompatibility(null);
  
  assert.strictEqual(result.compatible, false);
  assert.strictEqual(result.storedAppVersion, null);
  assert.strictEqual(result.currentAppVersion, HELIOS_APP_VERSION);
  assert.ok(result.issues.includes("Storage client unavailable"));
});

test("checkDataCompatibility returns incompatible if client lacks getKv method", async () => {
  const fakeClient = {};
  const result = await checkDataCompatibility(fakeClient);
  
  assert.strictEqual(result.compatible, false);
  assert.ok(result.issues.includes("Storage client unavailable"));
});

test("checkDataCompatibility returns compatible=true when storage unavailable (graceful degradation)", async () => {
  const fakeClient = {
    getKv: async () => {},
    ensureInitialized: async () => {
      throw new Error("Storage unavailable");
    },
  };
  
  const result = await checkDataCompatibility(fakeClient);
  
  // App can work without storage - not a compatibility issue
  assert.strictEqual(result.compatible, true);
  assert.ok(result.issues.includes("Storage unavailable (app will use memory mode)"));
});

test("checkDataCompatibility returns compatible when versions match", async () => {
  const fakeClient = {
    getKv: async (key) => {
      if (key === METADATA_KEYS.APP_VERSION) {
        return HELIOS_APP_VERSION;
      }
      if (key === METADATA_KEYS.SCHEMA_VERSION) {
        return String(HELIOS_SCHEMA_VERSION);
      }
      return null;
    },
    ensureInitialized: async () => {},
  };
  
  const result = await checkDataCompatibility(fakeClient);
  
  assert.strictEqual(result.compatible, true);
  assert.strictEqual(result.storedAppVersion, HELIOS_APP_VERSION);
  assert.strictEqual(result.storedSchemaVersion, HELIOS_SCHEMA_VERSION);
  assert.strictEqual(result.issues.length, 0);
});

test("checkDataCompatibility detects app version mismatch", async () => {
  const fakeClient = {
    getKv: async (key) => {
      if (key === METADATA_KEYS.APP_VERSION) {
        return "0.9.0"; // Older version
      }
      if (key === METADATA_KEYS.SCHEMA_VERSION) {
        return String(HELIOS_SCHEMA_VERSION);
      }
      return null;
    },
    ensureInitialized: async () => {},
  };
  
  const result = await checkDataCompatibility(fakeClient);
  
  assert.strictEqual(result.compatible, false);
  assert.strictEqual(result.storedAppVersion, "0.9.0");
  assert.strictEqual(result.currentAppVersion, HELIOS_APP_VERSION);
  assert.ok(result.issues.some(issue => issue.includes("App version mismatch")));
});

test("checkDataCompatibility detects schema version mismatch", async () => {
  const fakeClient = {
    getKv: async (key) => {
      if (key === METADATA_KEYS.APP_VERSION) {
        return HELIOS_APP_VERSION;
      }
      if (key === METADATA_KEYS.SCHEMA_VERSION) {
        return "1"; // Older schema version
      }
      return null;
    },
    ensureInitialized: async () => {},
  };
  
  const result = await checkDataCompatibility(fakeClient);
  
  assert.strictEqual(result.compatible, false);
  assert.strictEqual(result.storedSchemaVersion, 1);
  assert.strictEqual(result.currentSchemaVersion, HELIOS_SCHEMA_VERSION);
  assert.ok(result.issues.some(issue => issue.includes("Schema version mismatch")));
});

test("checkDataCompatibility handles missing metadata gracefully (new database)", async () => {
  const fakeClient = {
    getKv: async (key) => {
      // No metadata exists yet - that's okay for new database
      throw new Error("Key not found");
    },
    ensureInitialized: async () => {},
  };
  
  const result = await checkDataCompatibility(fakeClient);
  
  // New database without metadata should be compatible
  assert.strictEqual(result.compatible, true);
  assert.strictEqual(result.storedAppVersion, null);
  assert.strictEqual(result.storedSchemaVersion, null);
  assert.strictEqual(result.issues.length, 0);
});

test("generateVersionedCacheKey generates cache key with app and schema versions", () => {
  const key = generateVersionedCacheKey("mykey");
  
  assert.ok(key.includes("mykey"));
  assert.ok(key.includes(HELIOS_APP_VERSION));
  assert.ok(key.includes(String(HELIOS_SCHEMA_VERSION)));
  assert.ok(key.includes("::"));
});

test("generateVersionedCacheKey includes function fingerprint when provided", () => {
  const key = generateVersionedCacheKey("embedding", "abc123");
  
  assert.ok(key.includes("embedding"));
  assert.ok(key.includes("abc123"));
  assert.ok(key.split("::").length > 3);
});

test("generateVersionedCacheKey includes embedding model when provided", () => {
  const key = generateVersionedCacheKey("embedding", "abc123", "model-v1");
  
  assert.ok(key.includes("embedding"));
  assert.ok(key.includes("abc123"));
  assert.ok(key.includes("model-v1"));
  assert.strictEqual(key.split("::").length, 5);
});

test("generateVersionedCacheKey generates consistent keys for same inputs", () => {
  const key1 = generateVersionedCacheKey("test", "fp1", "model1");
  const key2 = generateVersionedCacheKey("test", "fp1", "model1");
  
  assert.strictEqual(key1, key2);
});

test("generateVersionedCacheKey generates different keys for different inputs", () => {
  const key1 = generateVersionedCacheKey("test", "fp1");
  const key2 = generateVersionedCacheKey("test", "fp2");
  
  assert.notStrictEqual(key1, key2);
});

test("validateSnapshotVersion returns invalid for null snapshot", () => {
  const result = validateSnapshotVersion(null);
  
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes("Invalid snapshot format"));
});

test("validateSnapshotVersion returns invalid for non-object snapshot", () => {
  const result = validateSnapshotVersion("not an object");
  
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes("Invalid snapshot format"));
});

test("validateSnapshotVersion returns valid for matching analysis snapshot version", () => {
  const snapshot = { version: SNAPSHOT_VERSION };
  const result = validateSnapshotVersion(snapshot, "analysis");
  
  assert.strictEqual(result.valid, true);
});

test("validateSnapshotVersion returns invalid for mismatched analysis snapshot version", () => {
  const snapshot = { version: 999 };
  const result = validateSnapshotVersion(snapshot, "analysis");
  
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes("mismatch"));
  assert.strictEqual(result.storedVersion, 999);
  assert.strictEqual(result.expectedVersion, SNAPSHOT_VERSION);
});

test("validateSnapshotVersion returns valid for matching layout snapshot version", () => {
  const snapshot = { version: LAYOUT_SNAPSHOT_VERSION };
  const result = validateSnapshotVersion(snapshot, "layout");
  
  assert.strictEqual(result.valid, true);
});

test("validateSnapshotVersion returns invalid for mismatched layout snapshot version", () => {
  const snapshot = { version: 999 };
  const result = validateSnapshotVersion(snapshot, "layout");
  
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason.includes("mismatch"));
  assert.strictEqual(result.storedVersion, 999);
  assert.strictEqual(result.expectedVersion, LAYOUT_SNAPSHOT_VERSION);
});

test("shouldInvalidateData returns true for incompatible data", () => {
  const compatibility = {
    compatible: false,
    storedAppVersion: "0.9.0",
    currentAppVersion: HELIOS_APP_VERSION,
    issues: ["App version mismatch"],
  };
  
  assert.strictEqual(shouldInvalidateData(compatibility), true);
});

test("shouldInvalidateData returns false for compatible data (non-strict mode)", () => {
  const compatibility = {
    compatible: true,
    storedAppVersion: HELIOS_APP_VERSION,
    currentAppVersion: HELIOS_APP_VERSION,
    issues: [],
  };
  
  assert.strictEqual(shouldInvalidateData(compatibility, false), false);
});

test("shouldInvalidateData returns true for app version mismatch (non-strict mode)", () => {
  const compatibility = {
    compatible: true, // Schema matches
    storedAppVersion: "0.9.0",
    currentAppVersion: HELIOS_APP_VERSION,
    issues: ["App version mismatch"],
  };
  
  // Non-strict: invalidate on app version mismatch
  assert.strictEqual(shouldInvalidateData(compatibility, false), true);
});

test("shouldInvalidateData returns false for schema version mismatch only (non-strict mode)", () => {
  const compatibility = {
    compatible: true, // App version matches
    storedAppVersion: HELIOS_APP_VERSION,
    currentAppVersion: HELIOS_APP_VERSION,
    storedSchemaVersion: 1,
    currentSchemaVersion: HELIOS_SCHEMA_VERSION,
    issues: ["Schema version mismatch"], // Schema migrations handle this
  };
  
  // Non-strict: don't invalidate on schema mismatch (migrations handle it)
  assert.strictEqual(shouldInvalidateData(compatibility, false), false);
});

test("shouldInvalidateData returns true for any mismatch in strict mode", () => {
  const compatibility = {
    compatible: true,
    storedAppVersion: HELIOS_APP_VERSION,
    currentAppVersion: HELIOS_APP_VERSION,
    issues: ["Schema version mismatch"],
  };
  
  // Strict: invalidate on any mismatch
  assert.strictEqual(shouldInvalidateData(compatibility, true), true);
});

test("shouldInvalidateData returns false when storedAppVersion is null (new database)", () => {
  const compatibility = {
    compatible: true,
    storedAppVersion: null,
    currentAppVersion: HELIOS_APP_VERSION,
    issues: [],
  };
  
  // New database - no invalidation needed
  assert.strictEqual(shouldInvalidateData(compatibility, false), false);
});

