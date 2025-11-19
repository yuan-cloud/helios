# Network Analysis Test Fixtures

This directory contains sample payloads for validating network analysis algorithms.

## Structure

Each fixture should be a JSON file matching the payload schema defined in `docs/payloads.md`:

```json
{
  "functions": [...],
  "callEdges": [...],
  "similarityEdges": [...]
}
```

## Usage

Run validation on a single file:
```bash
node tools/validate-network-analysis.mjs tests/fixtures/network-analysis/sample.json
```

Run validation on all fixtures in this directory:
```bash
node tools/validate-network-analysis.mjs --dir tests/fixtures/network-analysis/
```

## Adding Fixtures

Once representative datasets are available from parser/embedding agents, add them here:

1. Export payload from a real parser/embedding run
2. Save as `tests/fixtures/network-analysis/<repo-name>.json`
3. Run validation to ensure metrics are computed correctly

## Expected Metrics

The validation harness checks:

- **Centralities**: Degree (in/out/total/normalized), betweenness [0,1], PageRank [0,1] (sums to ~1.0)
- **Communities**: Integer community IDs, reasonable distribution
- **Cliques**: Core numbers (integers ≥ 0), degeneracy matches max core, valid clique arrays

See `docs/network-analysis-validation.md` for detailed validation criteria.

