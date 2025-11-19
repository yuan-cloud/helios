# HELIOS Storage Retention Policy

**Status:** ✅ Active (enabled in production)

Last updated: 2025-11-20

## Scope
- Applies to OPFS-hosted SQLite snapshots (`helios.sqlite3`) created by the storage worker.
- Covers persisted analysis payloads: layout snapshots, resume flow state, embeddings metadata, and graph caches.
- Does **not** apply to transient in-memory databases (when OPFS is unavailable); those are cleared on page unload automatically.

## Active Defaults (MVP)
1. **24-hour default retention** ✅ **ACTIVE**
   - Snapshots older than 24 hours are purged automatically on next app load or scheduled cleanup tick.
   - Rationale: aligns with privacy-first stance for a local analysis tool while still supporting "come back tomorrow" workflows.
   - Configurable via `retention.maxAgeHours` in `kv` table (default: 24 hours).
2. **7-day extended retention** ⏸️ **DEFERRED**
   - Deferred until post-MVP; no UI toggle in initial release.
   - Implementation ready: when needed, add settings UI to set `retention.maxAgeHours` to 168 (7 days).
   - Records the opt-in flag in `kv` table to drive cleanup logic.

## Cleanup Strategy
- **On bootstrap:** The storage worker automatically runs retention cleanup if `config.retention.enabled = true` (active).
- **Retention window:** Reads `retention.maxAgeHours` from `kv` table (default: 24 if not set).
- **Cleanup deletes:**
  - Layout snapshots (`layout_snapshots` table) where `updated_at < cutoff`
  - Resume flow payloads (entries stored under `resume::` namespace in `kv`) where timestamp < cutoff
  - Embedding caches tied to expired layout IDs (future-proofing)
  - The physical OPFS database if all snapshots are eligible for removal (optional optimization).

## Implementation
- **Activation:** Enabled via `config.retention.enabled = true` in storage worker init (see `index.html`).
- **Code:** `src/storage/retention.js` (cleanup logic), `src/workers/storage-worker.js` (integration).
- **Tests:** `tests/storage/retention.test.mjs` (17 tests, all passing).
- **Manual trigger:** Send `retention:enforce` message to storage worker for on-demand cleanup.

## Configuration
To change retention window:
1. Set `retention.maxAgeHours` in `kv` table via storage worker:
   ```javascript
   await storageClient.setKv('retention.maxAgeHours', '48');  // 48 hours
   ```
2. Manual cleanup runs on next app load, or trigger immediately:
   ```javascript
   await storageClient.send('retention:enforce');
   ```

## Future Enhancements (Post-MVP)
- **7-day override UI:** Settings toggle to set `retention.maxAgeHours` to 168 (7 days).
- **Retention messaging:** Surface retention info in settings panel or storage status banner.
- **Warning before purge:** Warn if purging data currently in use (e.g., active visualization).
- **Telemetry:** Optional local-only metrics to count retention purges for diagnostics.


