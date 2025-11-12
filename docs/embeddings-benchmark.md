# Embedding Similarity Benchmarking

Plan reference: PLAN.md §3.5 (“Large-scale ANN benchmarking”).

## Overview

We provide a lightweight harness that compares exact bundle-similarity runs with the approximate path (random projection candidate pruning). This allows us to measure:

- Execution time (ms) for both strategies
- Speedup factor relative to the exact algorithm
- Precision/recall/F1/Jaccard against the exact edge set
- Candidate/evaluated pair counts for each run

The harness operates on aggregated `functionEmbeddings` arrays, so you can benchmark straight from persisted snapshots or synthetic datasets.

## CLI Usage

```
node tools/benchmark-similarity.mjs --input path/to/dataset.json [--iterations 3] [--approx '{"name":"wide-band","approximateBandSize":32}']
```

### Dataset Format

```json
{
  "dimension": 384,
  "functions": [
    { "id": "fn-1", "filePath": "src/a.js", "name": "alpha" }
  ],
  "embeddings": [
    { "chunk": { "id": "chunk-1", "functionId": "fn-1" }, "vector": [0.12, 0.34, ...] }
  ]
}
```

Vectors are converted to `Float32Array` automatically. If you already have pre-aggregated `functionEmbeddings`, convert them in a short script and call `runApproximateBenchmark` directly (see below).

## Programmatic API

```js
import { buildFunctionEmbeddings } from '../src/embeddings/similarity.js';
import { runApproximateBenchmark } from '../src/embeddings/benchmark.js';

const functionEmbeddings = buildFunctionEmbeddings({ functions, embeddings, dimension });
const report = runApproximateBenchmark({
  functionEmbeddings,
  exactOptions: { similarityThreshold: 0.6, maxNeighbors: 8 },
  approximateConfigs: [
    { name: 'baseline', approximateProjectionCount: 12, approximateBandSize: 24, approximateOversample: 2 },
    { name: 'wider-band', approximateProjectionCount: 16, approximateBandSize: 32, approximateOversample: 2 }
  ],
  iterations: 3
});

console.table(report.variants.map(({ name, precision, recall, speedup }) => ({
  name,
  precision: (precision * 100).toFixed(2),
  recall: (recall * 100).toFixed(2),
  speedup: speedup.toFixed(2)
})));
```

## Sample Data

`tests/fixtures/embedding-benchmark-sample.json` contains a small synthetic dataset (three clusters) that you can use to verify the tooling locally or inside CI.

## Next Steps

- Plug real repository embeddings once available to establish production thresholds.
- Extend the harness to capture memory snapshots or per-stage timing if needed.
- Feed results into PLAN §19 instrumentation once defaults are tuned.

