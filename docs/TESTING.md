# Manual Regression Checks

## Edge Toggle / Highlight Interaction

Context: commit `6213e89` fixed a regression where the call/similarity edge toggles stopped hiding links after the hover-highlighting refactor (`bcbff97`).

Verification steps:

1. Load a mixed-language sample project (JS/Python works) and wait for the graph to render.
2. Toggle **Similarity Edges** off → dashed links should disappear immediately.
3. Toggle **Call Edges** off → only similarity links remain. Toggle back on to restore call links.
4. Hover a node while toggling edges to confirm neighborhood highlighting still animates smoothly.
5. Use the hover sidebar quick-jump buttons to focus a neighbor; ensure the inspector opens and edge filters stay respected.

Re-run these steps whenever we touch `src/viz/graph-viz.js` or `src/viz/controls.js` hover/toggle logic.
