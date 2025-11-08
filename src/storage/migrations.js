// Migration registry for HELIOS SQLite schema.
// Future migrations can append to the `MIGRATIONS` array. Each migration
// provides an integer `id`, descriptive `name`, and a `statements` array which
// will be executed sequentially within a transaction.

export const MIGRATIONS = [];

/**
 * Determine which migrations should run for the provided schema version.
 * @param {number|null} currentVersion The schema version stored in the database.
 * @returns {Array<{id:number,name:string,statements:string[]}>}
 */
export function getPendingMigrations(currentVersion) {
  if (currentVersion == null) {
    // Initial schema is handled separately by sqlite.js ensureSchema.
    return [];
  }
  return MIGRATIONS.filter((migration) => migration.id > currentVersion).sort(
    (a, b) => a.id - b.id
  );
}


