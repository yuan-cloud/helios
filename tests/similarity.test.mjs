import assert from 'node:assert/strict';
import { buildFunctionEmbeddings, computeSimilarityGraph } from '../src/embeddings/similarity.js';

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

const edge = similarityResult.edges.find(item => {
  const pair = [item.source, item.target].sort().join(',');
  return pair === 'fnA,fnB';
});

assert.ok(edge, 'Expected similarity edge between fnA and fnB');
assert.ok(edge.similarity > 0.7, 'Expected high similarity between fnA and fnB');

const unrelated = similarityResult.edges.find(item => {
  const pair = [item.source, item.target].sort().join(',');
  return pair === 'fnA,fnC' || pair === 'fnB,fnC';
});

assert.ok(!unrelated, 'Did not expect similarity edges involving fnC due to orthogonal embeddings');

console.log('similarity.test.mjs passed');

