// Data compatibility checking and cache invalidation utilities.
// Following BEST_PRACTICES_BROWSER.md patterns for storage management.

import { HELIOS_SCHEMA_VERSION, HELIOS_APP_VERSION, METADATA_KEYS } from "./schema.js";
import { LAYOUT_SNAPSHOT_VERSION } from "./layout-persistence.js";
import { SNAPSHOT_VERSION } from "./resume-flow.js";

/**
 * Result of data compatibility check
 * @typedef {Object} CompatibilityResult
 * @property {boolean} compatible - Whether data is compatible
 * @property {string|null} storedAppVersion - Stored application version (if any)
 * @property {string} currentAppVersion - Current application version
 * @property {number|null} storedSchemaVersion - Stored schema version (if any)
 * @property {number} currentSchemaVersion - Current schema version
 * @property {string[]} issues - Array of compatibility issues found
 */

/**
 * Check data compatibility and return detailed result.
 * This helps prevent issues where stale cached data causes problems.
 * 
 * @param {Object} client - Storage client with getKv method
 * @returns {Promise<CompatibilityResult>}
 */
export async function checkDataCompatibility(client) {
  if (!client || typeof client.getKv !== "function") {
    return {
      compatible: false,
      storedAppVersion: null,
      currentAppVersion: HELIOS_APP_VERSION,
      storedSchemaVersion: null,
      currentSchemaVersion: HELIOS_SCHEMA_VERSION,
      issues: ["Storage client unavailable"],
    };
  }

  try {
    await client.ensureInitialized?.();
  } catch (err) {
    // Storage not available - not necessarily a compatibility issue
    return {
      compatible: true, // App can work without storage
      storedAppVersion: null,
      currentAppVersion: HELIOS_APP_VERSION,
      storedSchemaVersion: null,
      currentSchemaVersion: HELIOS_SCHEMA_VERSION,
      issues: ["Storage unavailable (app will use memory mode)"],
    };
  }

  const issues = [];
  
  // Check app version
  let storedAppVersion = null;
  try {
    storedAppVersion = await client.getKv(METADATA_KEYS.APP_VERSION, { json: false });
  } catch (err) {
    // Metadata might not exist yet - that's okay
  }

  // Check schema version
  let storedSchemaVersion = null;
  try {
    const schemaVersionStr = await client.getKv(METADATA_KEYS.SCHEMA_VERSION, { json: false });
    storedSchemaVersion = schemaVersionStr ? Number.parseInt(schemaVersionStr, 10) : null;
  } catch (err) {
    // Metadata might not exist yet - that's okay
  }

  // Determine compatibility
  // New database (no metadata) is compatible - will be initialized with current versions
  // Existing database is compatible only if versions match
  const compatible = (storedAppVersion === null && storedSchemaVersion === null) || // New database
                     (storedAppVersion === HELIOS_APP_VERSION && 
                      (storedSchemaVersion === null || storedSchemaVersion === HELIOS_SCHEMA_VERSION)); // Existing database with matching versions

  // Collect issues
  if (storedAppVersion && storedAppVersion !== HELIOS_APP_VERSION) {
    issues.push(`App version mismatch: stored ${storedAppVersion}, current ${HELIOS_APP_VERSION}`);
  }
  if (storedSchemaVersion && storedSchemaVersion !== HELIOS_SCHEMA_VERSION) {
    issues.push(`Schema version mismatch: stored ${storedSchemaVersion}, current ${HELIOS_SCHEMA_VERSION}`);
  }

  return {
    compatible,
    storedAppVersion,
    currentAppVersion: HELIOS_APP_VERSION,
    storedSchemaVersion,
    currentSchemaVersion: HELIOS_SCHEMA_VERSION,
    issues,
  };
}

/**
 * Generate cache key that includes version information.
 * This ensures cache invalidation when versions change.
 * 
 * @param {string} baseKey - Base cache key
 * @param {string} [functionFingerprint] - Function fingerprint for embedding cache
 * @param {string} [embeddingModel] - Embedding model identifier
 * @returns {string} Versioned cache key
 */
export function generateVersionedCacheKey(baseKey, functionFingerprint = null, embeddingModel = null) {
  const parts = [baseKey, HELIOS_APP_VERSION, HELIOS_SCHEMA_VERSION];
  
  if (functionFingerprint) {
    parts.push(functionFingerprint);
  }
  if (embeddingModel) {
    parts.push(embeddingModel);
  }
  
  return parts.join("::");
}

/**
 * Validate snapshot version compatibility.
 * 
 * @param {Object} snapshot - Snapshot to validate
 * @param {string} type - Snapshot type: 'layout' | 'analysis'
 * @returns {Object} Validation result
 */
export function validateSnapshotVersion(snapshot, type = "analysis") {
  if (!snapshot || typeof snapshot !== "object") {
    return { valid: false, reason: "Invalid snapshot format" };
  }

  const expectedVersion = type === "layout" ? LAYOUT_SNAPSHOT_VERSION : SNAPSHOT_VERSION;
  const snapshotVersion = snapshot.version;

  if (snapshotVersion !== expectedVersion) {
    return {
      valid: false,
      reason: `Snapshot version mismatch: ${snapshotVersion} (expected ${expectedVersion})`,
      storedVersion: snapshotVersion,
      expectedVersion,
    };
  }

  return { valid: true };
}

/**
 * Determine if data should be invalidated due to version changes.
 * 
 * @param {CompatibilityResult} compatibility - Result from checkDataCompatibility
 * @param {boolean} [strict=false] - If true, invalidate on any mismatch; if false, only on app version mismatch
 * @returns {boolean} Whether data should be invalidated
 */
export function shouldInvalidateData(compatibility, strict = false) {
  if (!compatibility.compatible) {
    return true;
  }

  if (strict) {
    // Invalidate on any version mismatch
    return compatibility.issues.length > 0;
  }

  // Only invalidate on app version mismatch (schema migrations handle schema changes)
  return compatibility.storedAppVersion !== null &&
         compatibility.storedAppVersion !== compatibility.currentAppVersion;
}

