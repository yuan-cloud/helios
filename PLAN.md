# HELIOS - Technical Specification

## Function-Graph Visualization System

---

## 0) Executive Summary

**What you're building:**

- **Input**: User picks a local repo folder (no server).
- **Parse**: Language-aware AST parsing in the browser (Tree-sitter/WASM).
- **Extract**: Functions + edges: (a) static call edges; (b) semantic similarity edges from code embeddings.
- **Analyze**: Graph measures (centralities, communities, cliques).
- **Store**: Embeddings + graph in SQLite-WASM (persisted in OPFS) or memory.
- **Visualize**: Force-directed 3D with rich interactivity (hover, tooltips, code panel).
- **Perform**: WebAssembly for parsing/storage; WebGPU/wasm SIMD for embeddings; worker pools; cross-origin isolation for threads.

Everything runs from static hosting (GitHub/Cloudflare Pages). To enable threads and the fastest WASM paths, ship a service worker that applies COOP/COEP so SharedArrayBuffer and WASM threads work even on static hosts.

---

## 1) Goals, Non-Goals, Assumptions

- **Primary goal**: Cluster semantically related functions and overlay real call relationships; explore structure interactively.
- **Initial language scope**: JS/TS and Python. (Extensible via additional Tree-sitter grammars.)
- **Approximation**: Static call graph is heuristic for dynamic features (reflection, eval, dynamic import paths); semantic similarity complements the static edges. (Flag dynamic limits in UI.)
- **Constraints**: All client-side; no uploading code.

---

## 2) Architecture (High Level)

**Frontend (SPA)**: HTML + Alpine.js state + Tailwind for layout + ES Modules from CDNs.

**Compute:**
- Parsing via web-tree-sitter (WASM) + language grammars (JS/TS, Python).
- Embeddings via Transformers.js with ONNX Runtime Web backends; prefer WebGPU if present, fallback to WASM.
- Graph analysis via Graphology + standard metrics libraries.

**Storage**: SQLite-WASM on OPFS for persistence; memory mode for small repos.

**Viz**: 3d-force-graph (Three.js, d3-force-3d/ngraph physics), with directional links and custom node/edge styling.

**Infra**: Static host + coi-serviceworker to apply COOP/COEP headers for threads/SAB on hosts like GitHub Pages.

---

## 3) Detailed Pipeline and Components

### 3.1 File Selection and Repo Scan

- **Primary UX**: Prompt user to select a folder using File System Access API directory picker; read files recursively on the client. Show a live counter as files are discovered.
- **Cross-platform fallback**: `<input type="file" webkitdirectory multiple>` with webkitRelativePath to preserve hierarchy (covers Chromium-based; iOS/macOS Safari behavior varies; document limitations).
- **Ignore typical vendor/build dirs**: `.git`, `node_modules`, `dist`, `build`, `.venv`, etc. Optionally parse `.gitignore` using a small ignore-matcher library (from CDN).
- **Mobile**: Where directory APIs are weak, allow ZIP upload (decompress with fflate) as an alternative (document in UI).

### 3.2 Language Detection and AST Parsing

[PinkMountain - UPDATED - 2025-11-09 06:08]

✅ Tree-sitter loaded  
✅ JS/TS grammar loaded  
✅ Python grammar loaded  
✅ Extraction queries complete  
✅ Symbol table resolution (module-aware imports/exports complete)  
❌ Stack graphs integration (blocked: upstream WASM research pending)

- Load web-tree-sitter once; lazy-load grammars per file type. Ship grammar WASMs via CDN (e.g., `tree-sitter-python.wasm`, `tree-sitter-javascript.wasm`).
- Use Tree-sitter query patterns to extract:
  - Function declarations/defs (names, params, spans),
  - Module exports/imports (JS/TS) and import/from in Python,
  - Call expressions (callee identifiers/member expressions).

Tree-sitter's query DSL lets you capture these nodes robustly.

- Keep per-file symbol tables: `{ localName → fullyQualifiedName }` plus export/import bindings to resolve cross-file references conservatively.

**Optional stretch**: Leverage tree-sitter-stack-graphs rules for better name resolution in TS/JS; it exists in Rust with CLI and could be compiled to WASM later. Start with heuristic resolution, then iterate.

### 3.3 Call Graph Construction (Static, Best-Effort)

[PinkMountain - UPDATED - 2025-11-09 06:08]

✅ Static call graph extraction complete (caller→callee edges with call-site metadata)  
✅ Python grammar support added (functions/imports/calls feed call graph + viz)  
✅ Symbol table implementation complete  
✅ Module resolution logic extended (import/export aware)  
✅ Resolution metadata surfaced to visualization controls/inspector  
✅ Parser↔viz integration revalidated (hover + inspector data flow confirmed 2025-11-09)  
⏳ Enhanced name resolution (stack-graphs integration) — 0% (planned post-MVP once research unblocks)  
❌ Stack-graph powered name resolution blocked: awaiting WASM-capable implementation guidance

- For each `call_expression`, extract callee:
  - Identifiers → resolve via lexical scope + module import table.
  - Member expressions → record as `object.method` when resolvable; otherwise tag as "dynamic".
  - Constructors `new Foo()` → treat as call edge to `Foo` (class ctor).
- Add directed edges `caller → callee` with metadata (file, line, "dynamic?" flag).
- De-duplicate edges; maintain counts (#call sites) for edge weights.

**Note**: Tree-sitter parses files; project-wide call graph needs extra indexing. That's intentional; we build that index here.

### 3.4 Function Chunking and Embeddings

[BlueBear - UPDATED - 2025-11-09 06:14]

✅ Chunking scaffolding (line-aware splits with source offsets)
✅ Embedding worker inference (Transformers.js MiniLM via WebGPU/WASM)
✅ Persistence to storage worker (chunk vectors + metadata cached in SQLite; transaction flow stabilized)
✅ Incremental delta updates (reuse cached function chunks, re-embed only changed sources via per-function fingerprints)

- **Chunking**: Within each function, split by syntactic boundaries (statement blocks / loop bodies / logical sections) to keep chunks ~100–200 tokens. Maintain chunk offsets into the source so clicks can highlight text accurately.
- **Model**: Start with a compact, general-purpose text/code embedding like MiniLM (384-dim) in ONNX via Transformers.js, loading from HF hub through the library's CDN resolver. Models cache in the browser (Cache API/IndexedDB) to avoid re-downloads. Provide a setting to force WebGPU backend when available; fall back to WASM.
- **Execution**: Run embedding inference in a worker pool to keep UI responsive. If WebGPU is available (Chrome ≥113, Safari ≥16.4, Firefox 141+), enable the ORT WebGPU EP for a material speedup.
- **Storage**: Persist chunk vectors as binary blobs (Float32 or quantized Int8) in SQLite; or keep in memory for small projects.

### 3.5 Embedding Aggregation and Similarity

[BlueBear - UPDATED - 2025-11-09 06:14]

✅ Representative vector computation (per-function mean + normalization)
✅ Top-k bundle similarity with cosine metrics (candidate limit + thresholding)
✅ Similarity edge export to visualization layer (undirected, capped neighbors)
✅ Cached reload path (reuse persisted embeddings/similarity when fingerprint matches; resilience fix validated)
✅ Approximate KNN candidate pruning (random-projection LSH seeds, auto-thresholded for large repos)
⏳ Large-scale ANN benchmarking (0% — waiting on real-repo baselines to tune defaults)

- Represent each function by a set `E_f = {e_1 … e_m}` of chunk vectors.
- **Function-to-function correlation**: Default metric = cosine similarity.
- **Bundle similarity** = average of top-k (k=3..5) pairwise similarities between chunks of two functions:

  ```
  sim(f,g) = mean( topk_{i∈E_f, j∈E_g} cos(e_i, e_j) )
  ```

  This is robust to heterogeneous function lengths and reduces noise.

- **Complexity control**:
  - Build a per-function representative vector (mean of chunk vectors) to get a first-pass K-NN (e.g., top-20). For those candidates, compute the full bundle score.
  - For large repos, consider an approximate KNN index (HNSW) compiled to WASM, or SQLite vector extensions if/when available in WASM builds; ship as optional feature flag.

### 3.6 Graph Assembly

- **Nodes**: One per function `{id, fqName, filePath, range, lang, size (#LOC), metrics…}`.
- **Edges (two layers)**:
  1. **Call edges** (directed, solid): Weight by call-site count; color by call type (internal/external, static/dynamic).
  2. **Similarity edges** (undirected, dashed): Keep top-K per node above a threshold (e.g., K=8, τ=0.65) to avoid hairballs.
- **Analysis**: Use Graphology:
  - Centralities (degree, betweenness, eigenvector/PageRank), community detection (Louvain), cliques/k-cores where applicable.
  - **Derived attributes**:
    - Node size = eigenvector or betweenness centrality.
    - Node color = community (Louvain).
    - Link opacity/width = normalized weight.

### 3.7 Visualization (3D)

[LilacLake - UPDATED - 2025-11-09 06:35]

✅ Core 3d-force-graph scaffold hooked to call graph output (directional particles, camera helpers, fit-to-view)  
✅ Controls + inspector polish (hover sidebar, neighbor quick jumps, inbound/outbound call lists, Prism-highlighted source)  
✅ Call-edge resolution styling (resolved/ambiguous/unresolved cues propagated to hover and inspector badges)  
✅ Similarity edge layer (dashed styling, weight-aware opacity/width, threshold slider, hover + inspector surfacing)  
✅ Layout persistence & performance tuning (auto-freeze heuristics, OPFS snapshot provider, embedding reuse stats surfaced)  
✅ Resume flow integration & regression guard (call/sim edge toggles restored; viz consumes storage snapshots)  
✅ Ready to support downstream testing/integration (no outstanding viz-agent tasks)

- Render with 3d-force-graph:
  - Use directional arrows/particles for call edges; labels on hover; click to focus; fit-to-view; pause/resume simulation. The lib supports directional particles and node/link labels out of the box.
  - Tooltip shows filename, metrics, brief docstring/first lines.
  - Inspector panel opens on node click with full function source and syntax highlighting via Prism.js (small, CDN).
  - Provide toggles: show/hide similarity edges; filter by module/folder; highlight neighborhood; freeze positions; export PNG/JSON.
  - Initial layout: Start with force-3d; optionally seed coordinates using UMAP-JS (2D/3D) on function representative vectors (fast exploration for large graphs).

---

## 4) UX Flow & Instrumentation

1. Select repo → show counts of scanned files/lines.
2. Parse → per-language progress, #functions discovered, time per file.
3. Calls → "X call edges found (Y static/Z dynamic)".
4. Embed → show model, backend (WebGPU/WASM), throughput (chunks/s).
5. Analyze → number of communities, top-central nodes.
6. Explore → interactive graph; inspector panel; quick search by name/path.

All steps are cancellable and resumable; show clear privacy note ("Remains on your device").

---

## 5) Performance Plan

- **Cross-origin isolation**: Include coi-serviceworker to enable SharedArrayBuffer and WASM threads on static hosts (GH Pages, Cloudflare Pages). This is the key to multithreaded parsers/SQLite opfs VFS.
- **Workers**:
  - Parser pool (N = cores − 1) fed by a file queue (backpressure on big repos).
  - Embed pool with batch size tuned to model/backend.
- **SIMD/threads**: WASM SIMD is standard; threads need COOP/COEP (the SW solves headers).
- **WebGPU**: Attempt `navigator.gpu.requestAdapter`; if granted, load `onnxruntime-web ort.webgpu.min.js` path and set ORT EP to webgpu. Falls back to WASM automatically.
- **SQLite**: Prefer OPFS VFS (sync access handles in worker) for durability/perf; note that OPFS is accessed via `navigator.storage.getDirectory()` and is designed for origin-private persistence.
- **Heuristics for scale**:
  - Cap max file size (e.g., 1 MB) and function size (soft limit) with "include large files" toggle.
  - Sample only top-N functions by LOC for initial "quick map", then refine lazily.

---

## 6) Data Model (SQLite)

[storage-agent - UPDATED - 2025-11-09 06:13]

✅ SQLite-WASM bootstrap w/ OPFS fallback (`src/storage/sqlite.js`)
✅ Schema definition & metadata helpers (`src/storage/schema.js`, `src/storage/migrations.js`)
✅ Worker/client API for SQLite access (`src/storage/client.js`, `src/workers/storage-worker.js`)
✅ Schema + migration unit + layout persistence coverage (`tests/storage/sqlite-ensure.test.mjs`, `tests/storage/client.test.mjs`, `tests/storage/layout-persistence.test.mjs`)
✅ OPFS layout snapshot persistence API (`src/storage/layout-persistence.js`, worker/client handlers) [unblocked viz agent]
✅ Layout + embedding persistence integration guide (`docs/storage.md`)
✅ End-to-end DB resume flow (OPFS snapshot resume UI + automated tests)
✅ Layout snapshot integration in viz UI (viz save/restore now uses OPFS snapshot provider)
❌ Multi-session retention policy doc (blocked: awaiting product requirements on data lifespan)

**Tables:**

```sql
files(file_id PK, path, lang, sha1, bytes)
functions(fn_id PK, file_id, name, fq_name, start, end, loc, doc, metrics_json)
chunks(chunk_id PK, fn_id, start, end, tok_count)
embeddings(chunk_id FK, vec BLOB, dim, quant, backend, model)
call_edges(src_fn_id, dst_fn_id, weight, flags)
sim_edges(a_fn_id, b_fn_id, sim, method)
kv(key PRIMARY KEY, value)  -- app metadata, versions
```

Index for `call_edges` and `sim_edges` on `(src_fn_id,dst_fn_id)` and `(a_fn_id,b_fn_id)`.

Persist DB under OPFS (origin-private) so users can reopen the site and continue; OPFS is explicitly designed for this pattern.

---

## 7) Static Hosting & Loading Strategy

- **Import maps + ESM from CDNs**: Keep bundle size near zero and allow quick swaps. Use ES Module Shims as a polyfill for older browsers; most modern browsers support import maps natively.
- **Tailwind**: Play CDN is okay to start; document that it's dev-oriented and limits customization (fine for static demo; can migrate to precompiled CSS later).
- **Service workers**:
  - `coi-serviceworker.js` early in `<head>` to enforce COOP/COEP,
  - Optional Workbox SW to pre-cache core static assets (index, CSS, WASM runtimes, grammar WASMs). Avoid precaching large models; let Transformers.js cache them on-demand.

---

## 8) Desktop & Mobile

- **Desktop**: Full feature set; directory picker; WebGPU likely available on Chrome/Edge/Safari.
- **Mobile**: Reduced: prefer ZIP upload; throttle edge counts; cap node count; degrade to 2D force view if needed (3d-force-graph can switch to 2D sibling library if you choose later).
- Ensure touch gestures (pinch, orbit) and panel layout collapse into drawers.

---

## 9) Privacy, Security, and Permissions

- No network I/O for source files.
- Explain that all analysis stays local; persistence is OPFS; models come from CDN and are cached locally via standard browser caches/IndexedDB (Transformers.js behavior).
- COOP/COEP via service worker is a recognized pattern to enable SAB on static hosts. Document the behavior (first load reload).

---

## 10) Algorithms (More Detail)

### 10.1 Function Extraction (TSG Sketch)

- **JS/TS**:
  - `function_declaration` / `method_definition` / `arrow_function` with binding name.
  - `export_statement` / `import_statement` for resolution.
  - `call_expression` `((call_expression function: (identifier) @callee)` and a variant for member expressions).
- **Python**:
  - `function_definition` (qualified by module path).
  - `import_name`/`import_from` to fill symbol table.
  - Call nodes with function field; extract identifier or attribute.

(Tree-sitter queries are fast and robust for these patterns.)

### 10.2 Name Resolution (Minimal Viable)

- **Build module graph**:
  - JS/TS: ESM import/export and export default; resolve local aliasing.
  - Python: Map from `pkg.mod import name as alias` to `pkg.mod.name`.
- Create a global map `{filePath, localName} → fqName`.
- When ambiguous (overloaded names, reexports), keep an edge with "ambiguous" flag or link to multiple candidates with small weights.

**Speculation (marked)**: Adding tree-sitter-stack-graphs (TS/JS first) will tighten resolution dramatically in later versions.

### 10.3 Similarity Edges

- Normalize vectors; prune self-similarity; symmetrize scores: `sim = (sim(f,g)+sim(g,f))/2` if asymmetric pipeline is used.
- Threshold and top-K per node; allow user to slide K and τ in the UI.

### 10.4 Network Analysis

- Compute: degree, betweenness, eigenvector, PageRank; community (Louvain); show histograms in a side panel. (Graphology has these out of the box.)

---

## 11) Visualization Details

[LilacLake - UPDATED - 2025-11-09 06:35]

✅ Call-edge palette finalized (directional particles, arrowheads, module-aware colors, hover fades)  
✅ Interaction polish (hover sidebar metrics, inspector call lists, camera focus + quick-jump syncing)  
✅ Resolution state surfacing (hover + inspector badges with import context)  
✅ Similarity edge styling (dashed visuals, weight-aware opacity/width, threshold slider, inspector badges)  
✅ Layout persistence & freeze UX (OPFS-backed save/restore, auto-freeze presets, resume snapshot hooks)  
✅ Ongoing support: monitoring resume-flow integration + responding to review feedback promptly

- **Edge palette**:
  - Call edges: Color by module proximity or "internal vs external"; arrows on direction; use `linkDirectionalParticles` to emphasize direction on hover.
  - Similarity edges: Desaturate/dash; encode weight in opacity.
- **Node glyphs**: Sphere by default; optionally replace with text sprites for small graphs.
- **Interactions**:
  - Hover → label (function name) and small metrics.
  - Click → focus (camera tween), pin, open inspector with code (Prism.js), inbound/outbound edge list.
- **Layouts**: Force layout persists; allow "freeze" and manual drag; save positions to DB.

---

## 12) Failure/Edge Cases and Mitigations

- **Huge repos**: Show "Quick Map" mode (sample 2k functions max); allow background (in-tab) refinement with worker queues.
- **Unsupported files**: List ignored types; provide extension mapping editor.
- **Dynamic calls**: Mark edges as "dynamic/uncertain"; clicking explains why (e.g., computed property names).

---

## 13) Build & Delivery

- **No bundler initially**: Import maps for `web-tree-sitter`, `3d-force-graph`, `graphology`, `prismjs`, `@xenova/transformers`, `onnxruntime-web`. Use `es-module-shims` as polyfill if needed.
- **Service workers**:
  - `coi-serviceworker.js` in `<head>` (first tag) to ensure reload/activation.
  - Optional Workbox for precaching core assets; do not precache large models.
- **Hosting**: GitHub Pages or Cloudflare Pages; both work with the SW trick for COOP/COEP.

---

## 14) Testing & Validation

- **Goldens**: Small curated repos (few hundred functions) for regression on counts: #functions, #edges, top central nodes.
- **Diff mode**: Allow comparing two runs (e.g., before/after a refactor); compute graph deltas and community changes.
- **Cross-browser**: Chrome/Edge/Safari baseline; Firefox with WASM/WASM-SIMD; WebGPU where available.

---

## 15) Roadmap

### v0.1 (MVP)
- JS/TS + Python; directory picker + ZIP fallback; function extraction; static call edges (best-effort); mean-pooled function vectors; similarity top-K; 3D viz; SQLite (optional).

### v0.2
- Bundle-similarity scoring (top-k chunk pairs); Louvain communities; inspector panel; OPFS persistence by default; UI filters/pin/freeze; import map polish.

### v0.3
- WebGPU embeddings by default (detect & opt-in); optional HNSW KNN; UMAP seeded layout; project snapshots export/import.

### v0.4
- Add languages (Go, Rust, Java via Tree-sitter grammars); experiment with TS/JS stack-graphs for stronger resolution.

---

## 16) Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| File system APIs not available (some mobile/Safari cases) | Can't pick folders | ZIP fallback + drag-drop; document limitations. |
| WebGPU not available | Slower embeddings | Fall back to WASM; show backend selection; keep chunk sizes small. |
| WASM threads blocked on static hosts | Slow SQLite/parse | `coi-serviceworker` to enable COOP/COEP. |
| Tree-sitter grammar drift | Parse errors | Pin grammar versions; show parse-error counts per file. |
| Hairball graphs | Poor UX | Similarity top-K + threshold; filter panels; community-driven coloring. |

---

## 17) Telemetry (Local-Only)

- Track step durations, counts, errors in memory; display in a diagnostics panel; no network beacons.

---

## 18) Implementation Notes & Choices (Why These)

- **web-tree-sitter**: Mature, WASM-based, incremental; grammars available and loadable via CDN.
- **Transformers.js + ORT Web**: Runs ONNX models client-side; supports WebGPU for large wins when available; model caching in browser storage.
- **SQLite-WASM + OPFS**: Robust local persistence, queryable schema, binary vector storage; OPFS is built for origin-private persistent files.
- **3d-force-graph**: Proven performance and very flexible link/node customization (directional particles, curved links, labels).
- **Graphology**: Modern, well-maintained JS graph algorithms (centralities, communities).
- **Alpine.js + Tailwind**: Minimal, CDN-friendly, no build step needed; Tailwind Play CDN is acceptable for a static prototype, with clear caveats.

---

## 19) Concrete Acceptance Criteria (MVP)

- Load a 1–5k-function JS/TS repo on a laptop in < ~90s cold start (WASM, no WebGPU); < ~30s with WebGPU; show live progress at each stage. (Speculative targets; tune during implementation.)
- Extract ≥95% of function declarations and a majority of obvious intra-module calls on well-structured code (heuristic).
- Persist a session DB in OPFS; reload restores graph instantly (without re-embedding).
- Interactive 3D graph at 30–60 FPS for ≤2k nodes / ≤12k edges on mid-range hardware; controls stay responsive.

---

## 20) Deliverables Checklist

- [ ] Static site with import map + `coi-serviceworker.js`.
- [ ] Worker pool infra (parse + embed), SAB when available.
- [ ] Tree-sitter grammar loaders (JS/TS, Python).
- [ ] Function extraction (queries per language).
- [ ] Call graph (resolution tables, edge weights, flags).
- [ ] Embedding pipeline (Transformers.js + ORT backend select).
- [ ] Similarity module (bundle top-k, thresholds).
- [ ] SQLite-WASM adapter with OPFS VFS; schema creation + migrations.
- [ ] Graphology metrics (centrality, communities).
- [ ] 3D visualization (labels, particles, inspector with Prism).
- [ ] Settings screen (performance knobs, backend selection).
- [ ] Diagnostics panel (step timings; error counts).
- [ ] "Quick Map" mode for huge repos.

---

## Appendix A — Key APIs and Docs (Anchor Points)

- File System Access (folder picker): MDN.
- `webkitdirectory` fallback: MDN.
- OPFS overview & `navigator.storage.getDirectory()`: MDN / Chrome developers.
- SQLite-WASM docs + persistence/OPFS VFS notes.
- web-tree-sitter and language WASMs (python example).
- 3d-force-graph (examples: directional arrows, label API).
- WebGPU availability; ORT Web WebGPU EP.
- Transformers.js v3 (in-browser, model caching).
- Graphology standard library.
- Tailwind Play CDN caveats.
- ES Module Shims / import maps.
- Workbox precaching (optional).

---
