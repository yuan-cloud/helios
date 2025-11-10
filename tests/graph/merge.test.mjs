import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeGraphPayload } from '../../src/graph/merge.js';

test('mergeGraphPayload combines parser and embedding data', () => {
  const parser = {
    functions: [
      {
        id: 'fn1',
        name: 'foo',
        filePath: 'src/foo.ts',
        metrics: { calls: 2 }
      }
    ],
    callEdges: [
      {
        source: 'fn1',
        target: 'fn2',
        weight: 3,
        resolution: { status: 'resolved' }
      }
    ],
    stats: { totalFunctions: 1 },
    symbolTables: { 'src/foo.ts': { exports: { foo: 'fn1' } } }
  };

  const embeddings = {
    functionEmbeddings: [
      {
        id: 'fn1',
        function: {
          id: 'fn1',
          name: 'foo',
          metrics: { embeddings: 1 }
        }
      },
      {
        id: 'fn2',
        function: {
          id: 'fn2',
          name: 'bar',
          filePath: 'src/bar.ts'
        }
      }
    ],
    similarityEdges: [
      {
        source: 'fn1',
        target: 'fn2',
        similarity: 0.9,
        method: 'topk-avg'
      }
    ],
    metadata: {
      backend: 'wasm',
      modelId: 'miniLM'
    }
  };

  const merged = mergeGraphPayload({ parser, embeddings });

  assert.equal(merged.functions.length, 2);

  const fn1 = merged.functions.find(fn => fn.id === 'fn1');
  assert.ok(fn1, 'Expected fn1 to be present');
  assert.equal(fn1.metrics.calls, 2);
  assert.equal(fn1.metrics.embeddings, 1);

  const fn2 = merged.functions.find(fn => fn.id === 'fn2');
  assert.ok(fn2, 'Expected fn2 to be present (from embeddings)');
  assert.equal(fn2.filePath, 'src/bar.ts');

  assert.equal(merged.callEdges.length, 1);
  assert.equal(merged.callEdges[0].resolution.status, 'resolved');

  assert.equal(merged.similarityEdges.length, 1);
  assert.equal(merged.similarityEdges[0].method, 'topk-avg');

  assert.deepEqual(merged.extras.parserStats, { totalFunctions: 1 });
  assert.ok(merged.extras.symbolTables['src/foo.ts']);
  assert.equal(merged.extras.embeddingSummary.metadata.modelId, 'miniLM');
});

test('mergeGraphPayload respects overrides', () => {
  const parser = {
    functions: [{ id: 'fn1', name: 'foo' }],
    callEdges: []
  };

  const overrides = {
    functions: [{ id: 'fn1', metrics: { extra: true } }],
    callEdges: [{ source: 'fn1', target: 'fn2' }],
    similarityEdges: [{ source: 'fn1', target: 'fn2', similarity: 0.6 }]
  };

  const merged = mergeGraphPayload({ parser, overrides });

  const fn1 = merged.functions.find(fn => fn.id === 'fn1');
  assert.ok(fn1.metrics.extra, 'Override metrics should be merged');
  assert.equal(merged.callEdges.length, 1);
  assert.equal(merged.similarityEdges.length, 1);
});


