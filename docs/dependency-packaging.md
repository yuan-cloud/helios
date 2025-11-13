# Dependency Packaging Audit (HELIOS MVP)

Last updated: 2025-11-13 (ChartreuseHill)

## Goals

- Document how critical runtime dependencies are delivered (CDN vs. same-origin).
- Identify CORS/availability risks that could break the in-browser pipeline.
- Recommend concrete actions for MVP hardening and post-MVP backlog.

## Summary Matrix

| Module / Asset | Current Source | Availability Notes | Risk Level | Recommendation |
| --- | --- | --- | --- | --- |
| `web-tree-sitter` + WASMs | `public/vendor/tree-sitter.js`, `public/vendor/tree-sitter.wasm` | Served from same origin; SW isolation-friendly. | Low | ✅ No change required. |
| `@sqlite.org/sqlite-wasm` bundle | `public/sqlite/**` | Mirrored locally; avoids CORS/SAB issues. | Low | ✅ No change required. |
| `graphology`, `graphology-communities-louvain` | `https://esm.run/...` | esm.run currently returns CORS-allow headers; any outage breaks analytics. | Medium | 🔄 Keep CDN for Dev; create local mirror plan (npm install + copy ESM build into `public/vendor/graphology/`). |
| `3d-force-graph` | `https://esm.sh/3d-force-graph@1.79.0` | esm.sh rewrites to `cdn.esm.sh`; stable but prior 404s observed. | Medium | 🔄 Prepare vendored copy using `npm pack` → `public/vendor/3d-force-graph/`. Update import map once tested. |
| Prism.js (core + languages) | jsDelivr | Multiple files requested at load; fallback needed offline. | Medium | 🔄 Bundle minimal Prism build into `public/vendor/prism/`. |
| `@xenova/transformers` | jsDelivr | Large file (~1.4 MB). Local fallback `public/vendor/transformers.min.js` exists but not referenced. | Medium | ✅ Update import map to point at `/public/vendor/transformers.min.js` with CDN as runtime fallback (documented below). |
| ONNX Runtime Web assets | `public/vendor/onnxruntime-web/**` | Already local. | Low | ✅ No change required. |
| Fonts (Inter) | Google Fonts CDN | Optional; cached by browser. | Low | Consider self-host in future branding pass. |

## Immediate Actions (MVP)

1. **Transformers import map**  
   - Switch default to `/public/vendor/transformers.min.js`.  
   - Add defensive dynamic import fallback to jsDelivr if the local file fails to load (see Issue #storage-12).  
   - Owners: storage-agent + embeddings-agent (coordination required).

2. **Document CDN fallback procedure**  
   - Update `docs/storage.md` with a short “CDN outage playbook” referencing this audit and describing how to flip import maps to local mirrors.  
   - Provide checklist for releasing new vendor builds (npm install → copy to `public/vendor` → adjust integrity hash if needed).

3. **Prototype graphology/force-graph mirror**  
   - Use `node tools/vendorize-deps.mjs` to pull ESM bundles from `node_modules` into `public/vendor/{graphology,3d-force-graph}/`.  
   - Smoke test under service worker to ensure CORS headers are same-origin.

### Running the vendorization script

```sh
npm install           # ensures graphology/3d-force-graph are present locally
node tools/vendorize-deps.mjs
```

Outputs land in:

- `public/vendor/graphology/graphology.esm.js`
- `public/vendor/3d-force-graph/3d-force-graph.mjs`

LICENSE files are copied alongside the bundles for attribution. Re-run the script whenever package versions change.

## Post-MVP Backlog

- Automate vendor refresh via npm hook (`npm run vendorize`) to keep mirrors in sync with package.json versions.
- Evaluate bundling via Rollup/ESBuild for long-term maintainability instead of hand-managed vendor directories.
- Consider Cache Storage caching strategy for large models/scripts on first load.

## Operational Notes

- Any import map change requires a hard reload because `coi-serviceworker.js` caches aggressively. Communicate in Agent Mail before flipping endpoints.
- When mirroring ESM packages:
  1. `npm install` to ensure the desired versions are present in `node_modules/`.
  2. Run `node tools/vendorize-deps.mjs` (or add the package to the script and rerun).
  3. Verify relative `import` paths inside the generated files; rewrite to `./` if necessary.
  4. Update the import map and run `python3 -m http.server` + hard reload to validate.

For questions, cc the storage-agent (ChartreuseHill) and embeddings-agent (BlueBear/LilacCat) so we keep storage + inference in sync.


