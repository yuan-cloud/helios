import test from 'node:test';
import assert from 'node:assert/strict';

import { getDemoDataset } from '../../src/demo/demo-data.js';

test('demo dataset exposes expected structure', () => {
  const demo = getDemoDataset();

  assert.ok(Array.isArray(demo.sourceFiles), 'sourceFiles should be an array');
  assert.ok(demo.sourceFiles.length >= 1, 'sourceFiles should not be empty');

  assert.ok(Array.isArray(demo.functions), 'functions should be an array');
  assert.ok(demo.functions.length >= 1, 'functions should not be empty');

  assert.ok(Array.isArray(demo.callGraph?.edges), 'callGraph edges should be an array');
  assert.ok(demo.callGraph.edges.length >= 1, 'callGraph should contain edges');
  assert.equal(
    demo.callGraph.stats.totalEdges,
    demo.callGraph.edges.length,
    'callGraph stats should reflect edge count'
  );

  const edgeWithResolution = demo.callGraph.edges.find(
    edge => edge.metadata?.resolution?.status === 'resolved'
  );
  assert.ok(edgeWithResolution, 'at least one call edge should include resolution metadata');

  assert.ok(Array.isArray(demo.similarityEdges), 'similarityEdges should be an array');
  assert.ok(demo.similarityEdges.length >= 1, 'similarityEdges should not be empty');

  assert.ok(
    demo.embedding?.metadata?.backend,
    'embedding metadata should include backend identifier'
  );
});

test('getDemoDataset returns deep copies', () => {
  const first = getDemoDataset();
  const second = getDemoDataset();

  assert.notStrictEqual(first, second, 'dataset root objects should differ');
  assert.notStrictEqual(first.functions, second.functions, 'function arrays should differ');

  const originalName = second.functions[0]?.name;
  first.functions[0].name = 'mutated-name';

  assert.equal(
    second.functions[0].name,
    originalName,
    'mutating first clone should not affect second clone'
  );
});

