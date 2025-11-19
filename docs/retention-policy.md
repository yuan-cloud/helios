# HELIOS Storage Retention Policy (Draft)

## Scope
- Applies to OPFS-hosted SQLite snapshots (`helios.sqlite3`) created by the storage worker.
- Covers persisted analysis payloads: layout snapshots, resume flow state, embeddings metadata, and graph caches.
- Does **not** apply to transient in-memory databases (when OPFS is unavailable); those are cleared on page unload automatically.

## Proposed Defaults
1. **24-hour default retention (ship now)**
   - Snapshots older than 24 hours are purged automatically on next app load or scheduled cleanup tick.
   - Rationale: aligns with privacy-first stance for a local analysis tool while still supporting “come back tomorrow” workflows.
2. **Optional 7-day extended retention (future toggle)**
   - Requires explicit user opt-in (e.g., settings switch “Keep my analysis for up to 7 days”).
   - Records the opt-in flag in `kv` table to drive cleanup logic.

## Cleanup Strategy
- On bootstrap, the storage worker reads `kv` metadata for `retention.maxAgeHours` and deletes snapshots beyond the allowed window.
- When user toggles retention preference, update the `kv` entry and trigger a cleanup pass immediately.
- Cleanup deletes:
  - Layout snapshots (`layout_snapshots` table)
  - Resume flow payloads (entries stored under `resume::` namespace in `kv`)
  - Embedding caches tied to expired layout IDs (future-proofing)
  - The physical OPFS database if all snapshots are eligible for removal (optional optimization).

## Product / Design Decisions Needed
- Confirm that 24h default is acceptable for MVP or provide alternative (e.g., 12h).
- Confirm whether we expose the 7-day override in UI for MVP or defer until later.
- Decide where to surface retention messaging (settings panel vs. storage status banner).

## Open Questions
- Should we warn before purging data that exceeds the window but is currently in use (e.g., active visualization)?
- Do we need telemetry (local-only) to count how often retention purges occur for diagnostics?

## Next Steps
- Await product/design sign-off on defaults.
- Update storage worker cleanup logic once decisions finalized.
- Document the setting in `docs/storage.md` after implementation.


