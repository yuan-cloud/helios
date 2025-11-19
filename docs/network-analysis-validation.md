# Network Analysis Validation Harness

**Plan reference:** PLAN.md §10.4  
**Tool:** `tools/validate-network-analysis.mjs`

## Overview

The validation harness tests network analysis algorithms (centralities, communities, cliques) on sample repository payloads to ensure metrics are computed correctly and within expected ranges.

## Usage

### Validate a single payload

```bash
node tools/validate-network-analysis.mjs <payload.json>
```

### Validate all fixtures

```bash
node tools/validate-network-analysis.mjs --dir tests/fixtures/network-analysis/
```

## What It Validates

### 1. Centrality Metrics

**Degree Centrality:**
- `total`: Non-negative integer (sum of in/out/undirected degrees)
- `normalized`: Value in [0, 1] range
- `in`, `out`, `undirected`: Non-negative integers

**Betweenness Centrality:**
- Value in [0, 1] range
- Must be finite (not NaN or Infinity)

**PageRank:**
- Each node's value in [0, 1] range
- Sum of all PageRank values ≈ 1.0 (allowing for floating-point errors)
- Must be finite

### 2. Community Detection

**Community IDs:**
- Must be integers (non-negative)
- Communities should be reasonably distributed (not more communities than nodes)

**Distribution:**
- Average community size should be ≥ 1
- Isolated nodes (no community) are allowed but may generate warnings

### 3. Clique and Core Analysis

**Core Numbers:**
- Must be integers (non-negative)
- Degeneracy must equal the maximum core number

**Cliques:**
- Each clique must be an array of node IDs
- Cliques must have at least 2 nodes
- No duplicate nodes within a clique

## Validation Output

The harness prints:

1. **Statistics**: Function counts, edge counts, graph structure metrics
2. **Warnings**: Non-critical issues (e.g., isolated nodes, no edges)
3. **Errors**: Invalid metrics or structural problems
4. **Summary**: Overall validation results

### Example Output

```
============================================================
Validating: tests/fixtures/network-analysis/sample.json
============================================================

Statistics:
  Functions: 150
  Call edges: 320
  Similarity edges: 45
  Graph nodes: 150
  Graph edges: 365
  Communities: 8
  Cliques: 12
  Nodes with core numbers: 150

✅ Validation passed
```

## Adding Test Fixtures

1. **Export payload** from a real parser/embedding run:
   ```javascript
   // In browser console or via storage export
   const payload = {
     functions: heliosFunctions,
     callEdges: heliosCallGraph.edges,
     similarityEdges: heliosSimilarityEdges
   };
   // Save as JSON
   ```

2. **Save to fixtures directory**:
   ```bash
   # Save as tests/fixtures/network-analysis/<repo-name>.json
   ```

3. **Run validation**:
   ```bash
   node tools/validate-network-analysis.mjs tests/fixtures/network-analysis/<repo-name>.json
   ```

## Integration with CI/CD

The validation harness can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Validate network analysis
  run: |
    node tools/validate-network-analysis.mjs --dir tests/fixtures/network-analysis/
```

## Troubleshooting

### "Graph construction failed"

- Check that payload matches `docs/payloads.md` schema
- Verify all function IDs in edges exist in functions array
- Run `node tools/validate-payload.mjs <payload.json>` first

### "PageRank sum is X, expected ~1.0"

- Usually indicates floating-point precision issues (acceptable if close to 1.0)
- If significantly off, may indicate graph structure issues

### "More communities than nodes"

- Indicates community detection algorithm issue
- Check that graph is not completely disconnected

### "Degeneracy does not match max core number"

- Indicates k-core computation bug
- Report as a critical issue

## Related Documentation

- `docs/payloads.md` - Payload schema definition
- `tools/validate-payload.mjs` - Payload schema validation
- `PLAN.md` §10.4 - Network analysis requirements

