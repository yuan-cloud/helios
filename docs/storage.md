# HELIOS Storage Integration Guide

This document summarizes the new SQLite/OPFS persistence helpers delivered for
PLAN.md §6 so other agents can integrate with them quickly.

---

## 1. Layout Snapshots (OPFS)

### 1.1 Schema

`layout_snapshots` (introduced with schema version **2**) persists force-layout
positions so users can resume a project without recomputing the graph.

| Column             | Type    | Notes |
| ------------------ | ------- | ----- |
| `snapshot_id`      | INTEGER | Primary key |
| `graph_key`        | TEXT    | Unique identifier for the graph (e.g. `helios:v1:layout:{hash}`) |
| `graph_hash`       | TEXT    | Optional secondary hash used to detect incompatible snapshots |
| `layout_json`      | TEXT    | JSON array of node positions (`id`, `x`, `y`, `z`, `fx`, `fy`, `fz`) |
| `layout_version`   | INTEGER | Defaults to `1` for forward compatibility |
| `node_count`       | INTEGER | Stored node count at save time |
| `metadata_json`    | TEXT    | Optional JSON blob (viz-specific status, perf info, etc.) |
| `created_at`       | TEXT    | ISO-8601 timestamp |
| `updated_at`       | TEXT    | ISO-8601 timestamp |

Indexes:

- `UNIQUE(graph_key)` – ensures one active snapshot per graph key.
- `idx_layout_snapshots_graph_hash` – accelerates lookups by hash.

### 1.2 Storage Worker API

`StorageWorkerClient` (see `src/storage/client.js`) now exposes:

- `saveLayoutSnapshot({ graphKey, graphHash?, layout, metadata?, layoutVersion?, nodeCount? })`
- `loadLayoutSnapshot(graphKey)`
- `deleteLayoutSnapshot(graphKey)`
- `listLayoutSnapshots({ graphKey?, limit?, order? })`

Snapshots are sanitized by `src/storage/layout-persistence.js`:

```js
import {
  saveLayoutSnapshot,
  loadLayoutSnapshot,
  deleteLayoutSnapshot,
  listLayoutSnapshots
} from './src/storage/layout-persistence.js';
```

Use `normalizeLayoutSnapshot(nodes)` before saving to ensure coordinates are
finite and only `id`, `x/y/z`, `fx/fy/fz` are stored.

### 1.3 LayoutPersistenceProvider Contract

`GraphVisualization` accepts an async persistence provider via
`setLayoutStorageProvider(provider)`. The provider should implement:

```ts
{
  save({ key, snapshot, metadata }): Promise<void>
  load({ key }): Promise<{ layout, layoutVersion?, graphHash?, metadata? } | null>
  delete({ key }): Promise<void>
  has({ key }): Promise<boolean>
}
```

The viz currently calls:

- `save` after stable layouts (debounced, auto-freeze aware).
- `load` on visualization start; expects metadata including `graphHash`.
- `has` to show UI state for existing snapshots.
- `delete` when the user resets layouts.

If OPFS is unavailable, the provider should be `null`, causing the viz to fall
back to the original `localStorage` implementation.

---

## 2. Embedding Persistence Helpers

Persistent embeddings now support incremental reuse. The relevant exports live
in `src/embeddings/persistence.js`.

### 2.1 Fingerprints & KV Keys

- Global run fingerprint (`embeddings.fingerprint`)
- Run metadata (`embeddings.metadata`)
- Per-function fingerprints (`embeddings.functionFingerprints`)

Helpers:

```js
computeFunctionFingerprint(functions)
computeFunctionFingerprintMap(functions)
loadFunctionFingerprintMap(options?)          // returns stored per-function map
```

Persist updates via:

```js
await persistEmbeddingRun({
  functions,
  chunks,
  embeddings,
  similarityEdges,
  metadata,
  fingerprint,                  // string from computeFunctionFingerprint(...)
  functionFingerprints           // optional map (otherwise auto-generated)
});
```

`persistEmbeddingRun` now runs **inside a single transaction** (see commit
`3cb0233`). Do **not** wrap it with another `BEGIN/COMMIT`; the storage worker
already ensures atomicity.

### 2.2 Delta Reuse Workflow

Typical client sequence (also implemented in `index.html`):

1. Compute fingerprint for the full function list.
2. Call `tryLoadEmbeddingRun({ functions, chunks, fingerprint })`.
   - Returns `{ embeddings, similarityEdges, metadata, functionFingerprints }`
     when the stored fingerprint matches, otherwise `null`.
3. If the run is partially reusable, call:

   ```js
   const reuse = await loadEmbeddingsForFunctions({
     functions,
     chunks,
     targetFunctionIds: unchangedIds
   });
   ```

   - `reuse.embeddings` contains vectors for unchanged functions.
   - `reuse.missingFunctions` lists IDs that require re-embedding.
4. Embed the changed functions and merge the new vectors with reused ones.
5. Call `persistEmbeddingRun` with the combined result and updated fingerprints.

### 2.3 Testing

The storage suite exercises the new flows:

- `tests/storage/client.test.mjs` – client ↔ worker message coverage.
- `tests/storage/layout-persistence.test.mjs` – layout helper sanitization.
- `tests/storage/sqlite-ensure.test.mjs` – schema + migration guarantees.

Embeddings-specific tests:

- `tests/embeddings/persistence.test.mjs` (run via `node --test ...`)
- `tests/chunker.test.mjs`
- `tests/similarity.test.mjs`

---

## 3. Retention Policy

HELIOS automatically cleans up old data to respect privacy and manage storage usage.

### Active Policy (MVP)

- **Default retention:** 24 hours
- **Cleanup runs:** Automatically on app bootstrap (if `config.retention.enabled = true`)
- **What gets cleaned:**
  - Layout snapshots older than 24 hours (`updated_at < cutoff`)
  - Resume flow payloads (keys prefixed with `resume::`) older than 24 hours
  - Uses `updated_at` timestamp, so active snapshots stay fresh

### Configuration

Retention window is configurable via `kv` table:

```javascript
// Change retention to 48 hours
await storageClient.setKv('retention.maxAgeHours', '48');

// Manual cleanup trigger
await storageClient.send('retention:enforce');
```

Default is 24 hours if not set. See `docs/retention-policy.md` for full details.

---

## 4. Quick Reference

| Feature | Entry Points | Notes |
| ------- | ------------ | ----- |
| Layout persistence | `src/storage/layout-persistence.js`, `StorageWorkerClient.saveLayoutSnapshot` | JSON node snapshots, metadata & graph hash |
| Viz integration | `GraphVisualization.setLayoutStorageProvider`, `VisualizationControls` | Handles async save/load, auto perf modes |
| Embedding reuse | `computeFunctionFingerprint`, `loadEmbeddingsForFunctions`, `persistEmbeddingRun` | Fingerprint map allows per-function delta updates |
| KV keys | `embeddings.fingerprint`, `embeddings.metadata`, `embeddings.functionFingerprints` | Updated alongside each successful run |

For questions or extension requests, reach out on agent mail – storage-agent
remains available to support Section 6 integrations.

---

## 5. Dependency Packaging Reference

For import-map hardening, CDN fallback procedures, and vendor mirror guidance see
`docs/dependency-packaging.md`. Follow that audit when adjusting runtime
dependencies (graphology, 3d-force-graph, transformers, etc.) to avoid breaking
the OPFS/worker pipeline.


