# Regression Testing Guide

This document describes the regression testing framework for HELIOS parser output, as specified in PLAN.md §14.

## Overview

Regression testing ensures parser output consistency across versions by comparing key metrics against **golden baselines** - validated parser outputs from small, curated test repositories.

## Goals

According to PLAN.md §14, regression tests validate:

1. **Count consistency**: #functions, #edges remain stable
2. **Top central nodes**: Top central nodes (by PageRank/betweenness) remain consistent
3. **Parser stability**: Catch regressions in parser accuracy or output format

## Golden Repos

**Golden repos** are small, curated repositories (few hundred functions) used as test cases:

- **Small**: 100-500 functions ideal for fast testing
- **Representative**: Diverse patterns (languages, project structures, complexity)
- **Stable**: Source code doesn't change (or changes are intentional and documented)
- **Edge cases**: Include dynamic calls, ambiguous resolutions, mixed languages

### Location

Golden repos are stored in `tests/golden-repos/`:

```
tests/golden-repos/
  example-repo/
    README.md              # Documentation about this repo
    baseline.json          # Expected parser output
    source/                # (Optional) Source code if available
  another-repo/
    README.md
    baseline.json
    ...
```

### Baseline Format

Baseline files are valid parser payloads (per `docs/payloads.md`) with expected metrics documented in metadata:

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

## Running Regression Tests

### CLI Tool

Use `tools/regression-test.mjs` to run regression tests:

```bash
# Test all golden repos
node tools/regression-test.mjs --dir tests/golden-repos/

# Test specific baseline
node tools/regression-test.mjs tests/golden-repos/example/baseline.json

# Test multiple baselines
node tools/regression-test.mjs tests/golden-repos/**/baseline.json
```

### What Gets Tested

The regression test compares:

1. **Function count**: Total number of functions extracted
2. **Call edge count**: Total number of call edges
3. **Top central nodes**: Top 10 nodes by PageRank (order and identity)
4. **Resolution statistics**: Resolved/ambiguous/unresolved edge counts
5. **Language distribution**: Function counts per language

### Output

The tool reports:

- ✅ **Pass**: All metrics match baseline
- ❌ **Fail**: Metrics differ (shows expected vs actual)

Example output:

```
🧪 Testing: tests/golden-repos/example/baseline.json
  ✅ All metrics match
    Functions: 150
    Call edges: 120
    Languages: javascript: 100, typescript: 50
    Stats: resolved=80, ambiguous=30, unresolved=10
    Top central nodes (top 5):
      - src/main.ts::bootstrap (PageRank: 0.0500)
      - src/utils/logger.ts::log (PageRank: 0.0400)
      ...
```

## Adding a New Golden Repo

### Step 1: Choose a Repo

Select a small, representative repository:
- 100-500 functions ideal
- Diverse patterns (languages, complexity, structures)
- Stable or documented changes

### Step 2: Generate Baseline

1. Run parser on the repo
2. Save parser output to `tests/golden-repos/<repo-name>/baseline.json`
3. Ensure output matches `docs/payloads.md` schema

### Step 3: Document

Create `tests/golden-repos/<repo-name>/README.md` with:

- **Source**: Where the repo comes from (if available)
- **Characteristics**: #functions, #edges, languages, key features
- **Why**: Why this repo is useful for regression testing
- **Edge cases**: Special patterns (dynamic calls, ambiguous resolutions, etc.)

### Step 4: Verify

Run regression test to ensure baseline is valid:

```bash
node tools/regression-test.mjs tests/golden-repos/<repo-name>/baseline.json
```

## Updating Baselines

**⚠️ Warning**: Only update baselines when parser changes are **intentional and correct**.

To update a baseline:

1. Verify parser changes are correct
2. Re-run parser on the golden repo source
3. Save new output to `baseline.json`
4. Run regression test to verify new baseline is valid
5. Commit with clear message explaining why baseline changed

## Integration with CI/CD

### Recommended Workflow

1. **On every commit**: Run regression tests to catch regressions early
2. **On PR**: Require regression tests to pass before merge
3. **On release**: Full regression test suite as release gate

### Example CI Script

```bash
#!/bin/bash
# Run regression tests
node tools/regression-test.mjs --dir tests/golden-repos/

if [ $? -ne 0 ]; then
  echo "❌ Regression tests failed!"
  exit 1
fi
```

## Troubleshooting

### Baseline Not Found

**Error**: `No baseline files found`

**Solution**: Ensure baseline files are named `baseline.json` and located under `tests/golden-repos/`

### Metrics Differ

**Error**: Metrics don't match baseline

**Possible causes**:
- Parser bug (unintended behavior change)
- Parser improvement (intentional change - update baseline)
- Baseline is outdated (needs regeneration)

**Action**: 
1. Investigate if change is intentional or a bug
2. If intentional: Update baseline
3. If bug: Fix parser

### Top Central Nodes Differ

**Error**: Top central nodes order changed

**Possible causes**:
- Graph analysis algorithm changed
- Edge weights changed
- Resolution quality improved

**Action**: 
- If intentional (algorithm improvement): Update baseline
- If unintentional: Investigate graph analysis changes

## Future Enhancements

Potential improvements:

- **Diff mode**: Compare two parser runs to see exact changes
- **Threshold-based matching**: Allow small variations (e.g., ±1% tolerance)
- **Visual diffs**: Show graph visualization differences
- **Automatic baseline updates**: With review/approval workflow
- **Regression detection**: Identify which commits introduced regressions
- **Performance benchmarks**: Track parsing time as part of regression tests

## Related Documentation

- PLAN.md §14: Testing & Validation requirements
- `docs/payloads.md`: Parser payload schema
- `tools/validate-parser-output.mjs`: Parser output validation
- `tests/golden-repos/README.md`: Golden repo directory documentation
