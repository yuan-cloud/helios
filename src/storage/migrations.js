// Migration registry for HELIOS SQLite schema.
// Future migrations can append to the `MIGRATIONS` array. Each migration
// provides an integer `id`, descriptive `name`, and a `statements` array which
// will be executed sequentially within a transaction.

export const MIGRATIONS = [
  {
    id: 2,
    name: "layout_snapshots_table",
    statements: [
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
    ]
  }
];

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


