# Golden Repos for Regression Testing

This directory contains **golden test repos** - small curated repositories (few hundred functions) used for regression testing to ensure parser output consistency across versions.

## Purpose

According to PLAN.md §14, golden repos are used for:
- **Regression on counts**: Verify consistent counts of #functions, #edges, and top central nodes
- **Parser stability**: Catch regressions in parser accuracy or output format
- **Integration validation**: Ensure parser → graph → visualization pipeline remains stable

## Structure

Each golden repo entry should include:

1. **Source code** (if applicable) - a small, representative repository
2. **Expected output** - baseline parser payload JSON file with:
   - Function count
   - Call edge count
   - Top central nodes (top 10 by PageRank/betweenness)
   - Key metrics (resolution rates, language distribution, etc.)

## Usage

### Running regression tests

```bash
# Test all golden repos against their baselines
node tools/regression-test.mjs --dir tests/golden-repos/

# Test a specific golden repo
node tools/regression-test.mjs tests/golden-repos/example-repo/baseline.json

# Update baselines (after confirming parser changes are correct)
node tools/regression-test.mjs --update-baselines
```

### Adding a new golden repo

1. Choose a small, representative repository (100-500 functions ideal)
2. Run the parser on it to generate a baseline payload
3. Save the payload to `tests/golden-repos/<repo-name>/baseline.json`
4. Create a README in the repo directory documenting:
   - Source (if available)
   - Expected characteristics (#functions, #edges, languages)
   - Why this repo is useful for regression testing

### Baseline format

Baseline files should be valid parser payloads matching `docs/payloads.md` schema, with additional metadata:

```json
{
  "metadata": {
    "repoName": "example-repo",
    "generatedAt": "2025-11-20T00:00:00Z",
    "parserVersion": "1.0.0",
    "expectedCounts": {
      "functions": 150,
      "callEdges": 120,
      "languages": { "javascript": 100, "typescript": 50 }
    },
    "topCentralNodes": [
      { "id": "src/main.ts::bootstrap", "pageRank": 0.05 },
      { "id": "src/utils/logger.ts::log", "pageRank": 0.04 }
    ]
  },
  "functions": [...],
  "callEdges": [...],
  "stats": {...},
  "symbolTables": {...}
}
```

## Current Golden Repos

*(To be populated with actual golden repos)*

## Notes

- Golden repos should be **small** (few hundred functions) for fast testing
- Baselines should be **stable** - only update when parser improvements are intentional
- Golden repos should represent **diverse patterns** - different languages, project structures, complexity levels
- Consider including edge cases: dynamic calls, ambiguous resolutions, mixed languages
