import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFunctionEmbeddings } from '../../src/embeddings/similarity.js';
import { runApproximateBenchmark, canonicalEdgeKey } from '../../src/embeddings/benchmark.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  const fixturePath = path.resolve(__dirname, '../fixtures', name);
  return fs.readFile(fixturePath, 'utf-8');
}

function toFloatEmbeddings(rawEmbeddings) {
  return rawEmbeddings.map(entry => ({
    chunk: entry.chunk,
    vector: Float32Array.from(entry.vector ?? [])
  }));
}

(async () => {
  const dataset = JSON.parse(await loadFixture('embedding-benchmark-sample.json'));
  const functionEmbeddings = buildFunctionEmbeddings({
    functions: dataset.functions,
    embeddings: toFloatEmbeddings(dataset.embeddings),
    dimension: dataset.dimension
  });

  assert.ok(functionEmbeddings.length > 0, 'Expected function embeddings to be computed');

  const report = runApproximateBenchmark({
    functionEmbeddings,
    exactOptions: {
      similarityThreshold: 0.6,
      maxNeighbors: 3
    },
    approximateConfigs: [
      {
        name: 'default-approx',
        approximateProjectionCount: 8,
        approximateBandSize: 12,
        approximateOversample: 2
      }
    ],
    iterations: 1
  });

  assert.ok(report?.baseline, 'Expected baseline results');
  assert.ok(Array.isArray(report.variants) && report.variants.length === 1, 'Expected one approximate variant');

  const [variant] = report.variants;
  assert.equal(variant.name, 'default-approx');
  assert.ok(variant.precision >= 0 && variant.precision <= 1);
  assert.ok(variant.recall >= 0 && variant.recall <= 1);
  assert.ok(Number.isFinite(variant.speedup));

  // Ensure canonicalEdgeKey produces symmetric keys.
  const keyA = canonicalEdgeKey('a', 'b');
  const keyB = canonicalEdgeKey('b', 'a');
  assert.equal(keyA, keyB, 'canonicalEdgeKey should be order independent');

  console.log('benchmark.test.mjs passed');
})();

