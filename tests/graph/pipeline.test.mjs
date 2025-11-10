import test from 'node:test';
import assert from 'node:assert/strict';

const { collectGraphPayload, serializeGraph } = await import('../../src/graph/pipeline.js');

test('collectGraphPayload uses explicit sources when provided', () => {
  const functions = [{ id: 'fn1' }];
  const callEdges = [{ source: 'fn1', target: 'fn2' }];
  const similarityEdges = [{ source: 'fn1', target: 'fn2', similarity: 0.9 }];

  const result = collectGraphPayload({ functions, callEdges, similarityEdges });

  assert.deepEqual(result, {
    functions,
    callEdges,
    similarityEdges
  });
});

test('collectGraphPayload falls back to globals when missing pieces', () => {
  const saved = {
    heliosFunctions: globalThis.heliosFunctions,
    heliosCallGraph: globalThis.heliosCallGraph,
    heliosSimilarityEdges: globalThis.heliosSimilarityEdges,
    window: globalThis.window
  };

  try {
    globalThis.window = globalThis;
    globalThis.heliosFunctions = [{ id: 'fn1' }];
    globalThis.heliosCallGraph = {
      nodes: [{ id: 'fn1' }],
      edges: [{ source: 'fn1', target: 'fn2' }]
    };
    globalThis.heliosSimilarityEdges = [
      { source: 'fn1', target: 'fn2', similarity: 0.75 }
    ];

    const result = collectGraphPayload();
    assert.deepEqual(result, {
      functions: globalThis.heliosFunctions,
      callEdges: globalThis.heliosCallGraph.edges,
      similarityEdges: globalThis.heliosSimilarityEdges
    });
  } finally {
    globalThis.heliosFunctions = saved.heliosFunctions;
    globalThis.heliosCallGraph = saved.heliosCallGraph;
    globalThis.heliosSimilarityEdges = saved.heliosSimilarityEdges;
    if (saved.window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = saved.window;
    }
  }
});

test('serializeGraph safely handles missing graph', () => {
  const result = serializeGraph(null);
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test('serializeGraph flattens node and edge attributes', () => {
  const graph = {
    forEachNode(callback) {
      callback('n1', { name: 'Node 1' });
    },
    forEachEdge(callback) {
      callback(
        'e1',
        { layer: 'call', weight: 2 },
        'n1',
        'n2',
        { name: 'Node 1' },
        { name: 'Node 2' },
        false
      );
    }
  };

  const result = serializeGraph(graph);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].id, 'n1');
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].key, 'e1');
  assert.equal(result.edges[0].sourceAttributes.name, 'Node 1');
  assert.equal(result.edges[0].targetAttributes.name, 'Node 2');
});


