// Retention policy enforcement for HELIOS SQLite storage.
// Implements the cleanup strategy defined in docs/retention-policy.md.
// This module is structured to be ready for activation once product/design
// sign-off is received on retention window defaults.

const RETENTION_KEY = "retention.maxAgeHours";
const RESUME_NAMESPACE = "resume::";
const DEFAULT_RETENTION_HOURS = 24; // Will be configurable once product confirms

/**
 * Reads the retention policy from kv table.
 * Returns the configured max age in hours, or default if not set.
 * @param {Function} kvGet - Function to get kv entries (storage worker's kvGet)
 * @returns {Promise<number>} Max age in hours
 */
export async function getRetentionMaxAge(kvGet) {
  if (typeof kvGet !== "function") {
    throw new TypeError("kvGet must be a function");
  }
  
  const result = kvGet(RETENTION_KEY);
  if (!result?.exists || !result?.value) {
    return DEFAULT_RETENTION_HOURS;
  }
  
  const parsed = Number.parseInt(result.value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`[Retention] Invalid ${RETENTION_KEY} value: ${result.value}, using default ${DEFAULT_RETENTION_HOURS}`);
    return DEFAULT_RETENTION_HOURS;
  }
  
  return parsed;
}

/**
 * Calculates the cutoff timestamp (ISO string) for retention cleanup.
 * Entries older than this timestamp will be deleted.
 * @param {number} maxAgeHours - Maximum age in hours
 * @returns {string} ISO timestamp string
 */
export function getRetentionCutoff(maxAgeHours) {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) {
    throw new TypeError("maxAgeHours must be a finite non-negative number");
  }
  
  const now = Date.now();
  const cutoffMs = now - maxAgeHours * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

/**
 * Deletes expired layout snapshots from the database.
 * @param {Object} db - SQLite database handle (with exec/prepare methods)
 * @param {string} cutoffTs - ISO timestamp cutoff (entries older than this are deleted)
 * @returns {{ deleted: number }} Number of snapshots deleted
 */
export function cleanupExpiredLayoutSnapshots(db, cutoffTs) {
  if (!db || typeof db.exec !== "function" && typeof db.prepare !== "function") {
    throw new TypeError("db must be a SQLite database handle");
  }
  if (typeof cutoffTs !== "string" || !cutoffTs) {
    throw new TypeError("cutoffTs must be a non-empty ISO timestamp string");
  }
  
  // Delete layout snapshots where updated_at < cutoff
  // We use updated_at (not created_at) so active snapshots stay fresh even if old
  const sql = "DELETE FROM layout_snapshots WHERE updated_at < ?1";
  
  let deleted = 0;
  
  if (typeof db.prepare === "function") {
    const stmt = db.prepare(sql);
    try {
      stmt.bind([cutoffTs]);
      stmt.step();
      deleted = typeof db.changes === "function" ? db.changes() : 0;
    } finally {
      stmt.finalize();
    }
  } else {
    db.exec({ sql, bind: [cutoffTs], rowMode: "object" });
    deleted = typeof db.changes === "function" ? db.changes() : 0;
  }
  
  return { deleted };
}

/**
 * Deletes expired resume flow entries from the kv table.
 * Resume entries are stored with keys prefixed by RESUME_NAMESPACE.
 * @param {Object} db - SQLite database handle
 * @param {string} cutoffTs - ISO timestamp cutoff
 * @returns {{ deleted: number }} Number of resume entries deleted
 */
export function cleanupExpiredResumeEntries(db, cutoffTs) {
  if (!db || typeof db.exec !== "function" && typeof db.prepare !== "function") {
    throw new TypeError("db must be a SQLite database handle");
  }
  if (typeof cutoffTs !== "string" || !cutoffTs) {
    throw new TypeError("cutoffTs must be a non-empty ISO timestamp string");
  }
  
  // Resume entries are stored as JSON in kv.value with a timestamp field
  // We'll query all resume::* keys, parse their values, and delete expired ones
  // Since we can't efficiently query JSON inside SQLite without JSON1 extension,
  // we'll fetch all resume keys and filter in JS (acceptable for small datasets)
  
  const selectSql = "SELECT key, value FROM kv WHERE key LIKE ?1";
  const rows = [];
  
  const prefix = `${RESUME_NAMESPACE}%`;
  
  if (typeof db.exec === "function") {
    db.exec({
      sql: selectSql,
      bind: [prefix],
      rowMode: "object",
      callback: (row) => {
        rows.push(row);
      },
    });
  } else {
    throw new Error("Database must support exec() for resume cleanup");
  }
  
  const toDelete = [];
  
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value);
      // Resume entries should have a timestamp field (created_at, updated_at, or timestamp)
      const entryTs = parsed?.updated_at || parsed?.created_at || parsed?.timestamp;
      
      if (typeof entryTs === "string" && entryTs < cutoffTs) {
        toDelete.push(row.key);
      }
    } catch (error) {
      // Invalid JSON - log but don't delete (might be non-resume data with resume prefix)
      console.warn(`[Retention] Failed to parse resume entry ${row.key}:`, error);
    }
  }
  
  let deleted = 0;
  
  if (toDelete.length > 0) {
    // Batch delete expired resume entries
    if (typeof db.prepare === "function") {
      const deleteSql = "DELETE FROM kv WHERE key = ?1";
      for (const key of toDelete) {
        const stmt = db.prepare(deleteSql);
        try {
          stmt.bind([key]);
          stmt.step();
          if (typeof db.changes === "function" && db.changes() > 0) {
            deleted++;
          }
        } finally {
          stmt.finalize();
        }
      }
    } else {
      // Fallback: use exec with IN clause (if supported)
      const placeholders = toDelete.map((_, i) => `?${i + 1}`).join(",");
      const deleteSql = `DELETE FROM kv WHERE key IN (${placeholders})`;
      db.exec({ sql: deleteSql, bind: toDelete, rowMode: "object" });
      deleted = typeof db.changes === "function" ? db.changes() : 0;
    }
  }
  
  return { deleted };
}

/**
 * Performs a full retention cleanup pass.
 * This is the main entry point for retention policy enforcement.
 * @param {Object} db - SQLite database handle
 * @param {Function} kvGet - Function to get kv entries
 * @returns {Promise<{ maxAgeHours: number, cutoffTs: string, layoutSnapshotsDeleted: number, resumeEntriesDeleted: number }>}
 */
export async function enforceRetentionPolicy(db, kvGet) {
  if (!db) {
    throw new TypeError("db is required");
  }
  if (typeof kvGet !== "function") {
    throw new TypeError("kvGet must be a function");
  }
  
  const maxAgeHours = await getRetentionMaxAge(kvGet);
  const cutoffTs = getRetentionCutoff(maxAgeHours);
  
  const layoutResult = cleanupExpiredLayoutSnapshots(db, cutoffTs);
  const resumeResult = cleanupExpiredResumeEntries(db, cutoffTs);
  
  const summary = {
    maxAgeHours,
    cutoffTs,
    layoutSnapshotsDeleted: layoutResult.deleted,
    resumeEntriesDeleted: resumeResult.deleted,
  };
  
  if (layoutResult.deleted > 0 || resumeResult.deleted > 0) {
    console.log(`[Retention] Cleanup completed:`, summary);
  }
  
  return summary;
}

