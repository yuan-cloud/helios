import assert from 'node:assert/strict';
import { buildFunctionEmbeddings, computeSimilarityGraph } from '../src/embeddings/similarity.js';

function canonicalPair(a, b) {
  return [a, b].sort().join('::');
}

const functions = [
  { id: 'fnA', filePath: 'a.js', name: 'fnA' },
  { id: 'fnB', filePath: 'b.js', name: 'fnB' },
  { id: 'fnC', filePath: 'c.js', name: 'fnC' }
];

const dimension = 4;

const embeddings = [
  { chunk: { id: 'A1', functionId: 'fnA' }, vector: new Float32Array([1, 0, 0, 0]) },
  { chunk: { id: 'A2', functionId: 'fnA' }, vector: new Float32Array([0.9239, 0.3827, 0, 0]) },
  { chunk: { id: 'B1', functionId: 'fnB' }, vector: new Float32Array([0.9659, 0.2588, 0, 0]) },
  { chunk: { id: 'B2', functionId: 'fnB' }, vector: new Float32Array([0.8660, 0.5, 0, 0]) },
  { chunk: { id: 'C1', functionId: 'fnC' }, vector: new Float32Array([0, 1, 0, 0]) }
];

const functionEmbeddings = buildFunctionEmbeddings({
  functions,
  embeddings,
  dimension
});

assert.equal(functionEmbeddings.length, 3, 'Expected embeddings for all functions with vectors');

const similarityResult = computeSimilarityGraph(functionEmbeddings, {
  similarityThreshold: 0.6,
  maxNeighbors: 4,
  candidateLimit: 5,
  bundleTopK: 2
});

assert.ok(similarityResult.edges.length >= 1, 'Expected at least one similarity edge');

const edge = similarityResult.edges.find(item => canonicalPair(item.source, item.target) === 'fnA::fnB');

assert.ok(edge, 'Expected similarity edge between fnA and fnB');
assert.ok(edge.similarity > 0.7, 'Expected high similarity between fnA and fnB');

const unrelated = similarityResult.edges.find(item => {
  const pair = canonicalPair(item.source, item.target);
  return pair === 'fnA::fnC' || pair === 'fnB::fnC';
});

assert.ok(!unrelated, 'Did not expect similarity edges involving fnC due to orthogonal embeddings');
assert.equal(similarityResult.stats.approximate, false, 'Expected exact path for small datasets');

const approximateFunctions = [];
const approximateEmbeddings = [];
const largeDimension = 4;
const functionsPerCluster = 6;
const clusterBases = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0]
];
const clusterVariants = [
  [0.97, 0.24, 0, 0],
  [0.2, 0.96, 0, 0],
  [0.18, 0, 0.95, 0]
];

for (let cluster = 0; cluster < clusterBases.length; cluster++) {
  for (let idx = 0; idx < functionsPerCluster; idx++) {
    const fnId = `cluster${cluster}-fn${idx}`;
    approximateFunctions.push({ id: fnId, filePath: `${fnId}.js`, name: fnId });
    const baseChunkId = `${fnId}-base`;
    const variantChunkId = `${fnId}-variant`;
    approximateEmbeddings.push({
      chunk: { id: baseChunkId, functionId: fnId },
      vector: new Float32Array(clusterBases[cluster])
    });
    approximateEmbeddings.push({
      chunk: { id: variantChunkId, functionId: fnId },
      vector: new Float32Array(clusterVariants[cluster])
    });
  }
}

const approximateFunctionEmbeddings = buildFunctionEmbeddings({
  functions: approximateFunctions,
  embeddings: approximateEmbeddings,
  dimension: largeDimension
});

const exactLarge = computeSimilarityGraph(approximateFunctionEmbeddings, {
  similarityThreshold: 0.6,
  maxNeighbors: 3,
  candidateLimit: 12,
  bundleTopK: 2,
  approximate: false
});

const approximateLarge = computeSimilarityGraph(approximateFunctionEmbeddings, {
  similarityThreshold: 0.6,
  maxNeighbors: 3,
  candidateLimit: 12,
  bundleTopK: 2,
  approximate: true,
  approximateThreshold: 0,
  approximateProjectionCount: 10,
  approximateBandSize: 16,
  approximateOversample: 2
});

assert.equal(approximateLarge.stats.approximate, true, 'Expected approximate path to activate');

const exactPairs = new Set(exactLarge.edges.map(edge => canonicalPair(edge.source, edge.target)));
const approximatePairs = new Set(approximateLarge.edges.map(edge => canonicalPair(edge.source, edge.target)));

assert.deepEqual(
  [...approximatePairs].sort(),
  [...exactPairs].sort(),
  'Approximate KNN should match exact edge pairs for cleanly clustered data'
);

console.log('similarity.test.mjs passed');

