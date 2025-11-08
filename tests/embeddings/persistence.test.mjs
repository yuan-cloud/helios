import assert from 'node:assert/strict';
import {
  computeFunctionFingerprint,
  computeFunctionFingerprintMap,
  loadEmbeddingsForFunctions,
  tryLoadEmbeddingRun
} from '../../src/embeddings/persistence.js';

const baseFunctions = [
  {
    id: 'src/app.js:0:120',
    filePath: 'src/app.js',
    name: 'alpha',
    fqName: 'alpha',
    start: 0,
    end: 120,
    source: 'function alpha() { return 1; }',
    lang: 'javascript'
  },
  {
    id: 'src/util.js:50:180',
    filePath: 'src/util.js',
    name: 'beta',
    fqName: 'beta',
    start: 50,
    end: 180,
    source: 'export function beta(x) { return x * 2; }',
    lang: 'javascript'
  }
];

const shuffledFunctions = [...baseFunctions].reverse();

const modifiedFunctions = baseFunctions.map((fn) => ({
  ...fn,
  source: fn.source + '\nconsole.log("debug");'
}));

const emptyFingerprint = await computeFunctionFingerprint([]);
assert.equal(emptyFingerprint, 'fn:0', 'Expected deterministic fingerprint for empty function list');

const fingerprintA = await computeFunctionFingerprint(baseFunctions);
const fingerprintB = await computeFunctionFingerprint(shuffledFunctions);
assert.equal(fingerprintA, fingerprintB, 'Fingerprint should be order independent');

const fingerprintWithChanges = await computeFunctionFingerprint(modifiedFunctions);
assert.notEqual(
  fingerprintA,
  fingerprintWithChanges,
  'Fingerprint should change when function sources change'
);

const fingerprintMapA = computeFunctionFingerprintMap(baseFunctions);
assert.ok(fingerprintMapA['src/app.js:0:120'], 'Expected per-function fingerprint for fnA');
const fingerprintMapB = computeFunctionFingerprintMap(baseFunctions);
assert.deepEqual(
  fingerprintMapA,
  fingerprintMapB,
  'Per-function fingerprint map should be deterministic'
);
const updatedSampleFunctions = [
  {
    ...baseFunctions[0],
    source: `${baseFunctions[0].source}\nreturn 2;`
  },
  baseFunctions[1]
];
const fingerprintMapChanged = computeFunctionFingerprintMap(updatedSampleFunctions);
assert.notEqual(
  fingerprintMapA['src/app.js:0:120'],
  fingerprintMapChanged['src/app.js:0:120'],
  'Fingerprint should change when function source mutates'
);

class MockStorageClient {
  constructor(data) {
    this.data = data;
  }

  async ensureInitialized() {
    return true;
  }

  async getKv(key) {
    if (key === 'embeddings.metadata') {
      return this.data.metadata ?? null;
    }
    if (key === 'embeddings.fingerprint') {
      return this.data.fingerprint ?? null;
    }
    if (key === 'embeddings.functionFingerprints') {
      return this.data.functionFingerprints ?? null;
    }
    return null;
  }

  async query(sql, params = []) {
    if (sql.includes('FROM files')) {
      const requestedPaths = params;
      const rows = (this.data.files || []).filter((row) =>
        requestedPaths.includes(row.path)
      );
      return { rows };
    }

    if (sql.includes('FROM functions WHERE file_id IN')) {
      const requestedFiles = params;
      const rows = (this.data.functionsByFile || []).filter((row) =>
        requestedFiles.includes(row.file_id)
      );
      return { rows };
    }

    if (sql.includes('FROM embeddings')) {
      return { rows: this.data.embeddings || [] };
    }

    if (sql.includes('FROM sim_edges')) {
      return { rows: this.data.similarity || [] };
    }

    return { rows: [] };
  }
}

const sampleFunctions = [
  {
    id: 'fnA',
    filePath: 'src/app.js',
    name: 'alpha',
    start: 0,
    end: 120,
    source: 'function alpha() { return 1; }',
    lang: 'javascript'
  },
  {
    id: 'fnB',
    filePath: 'src/util.js',
    name: 'beta',
    start: 50,
    end: 180,
    source: 'export function beta(x) { return x * 2; }',
    lang: 'javascript'
  }
];

const sampleChunks = [
  {
    id: 'fnA::chunk-0',
    functionId: 'fnA',
    filePath: 'src/app.js',
    start: 0,
    end: 60,
    tokenCount: 42,
    text: 'function alpha() { return 1; }'
  },
  {
    id: 'fnB::chunk-0',
    functionId: 'fnB',
    filePath: 'src/util.js',
    start: 50,
    end: 150,
    tokenCount: 55,
    text: 'export function beta(x) { return x * 2; }'
  }
];

const fingerprint = await computeFunctionFingerprint(sampleFunctions);
const vectorA = new Float32Array([0.1, 0.2, 0.3, 0.4]);
const vectorABytes = new Uint8Array(vectorA.buffer.slice(0));
const vectorB = new Float32Array([0.9, 0.8, 0.7, 0.6]);
const vectorBBytes = new Uint8Array(vectorB.buffer.slice(0));

const mockClient = new MockStorageClient({
  metadata: {
    backend: 'wasm',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    dimension: 4,
    quantized: false
  },
  fingerprint,
  files: [
    { file_id: 1, path: 'src/app.js' },
    { file_id: 2, path: 'src/util.js' }
  ],
  functionsByFile: [
    { fn_id: 1, file_id: 1, name: 'alpha', start: 0 },
    { fn_id: 2, file_id: 2, name: 'beta', start: 50 }
  ],
  embeddings: [
    {
      file_path: 'src/app.js',
      fn_start: 0,
      fn_end: 120,
      chunk_start: 0,
      chunk_end: 60,
      vec: vectorABytes,
      dim: 4,
      backend: 'wasm',
      model: 'Xenova/all-MiniLM-L6-v2'
    },
    {
      file_path: 'src/util.js',
      fn_start: 50,
      fn_end: 180,
      chunk_start: 50,
      chunk_end: 150,
      vec: vectorBBytes,
      dim: 4,
      backend: 'wasm',
      model: 'Xenova/all-MiniLM-L6-v2'
    }
  ],
  similarity: [
    {
      sim: 0.87,
      method: 'topk-avg',
      a_path: 'src/app.js',
      a_start: 0,
      a_end: 120,
      b_path: 'src/util.js',
      b_start: 50,
      b_end: 180
    }
  ],
  functionFingerprints: {
    fnA: 'hashA',
    fnB: 'hashB'
  }
});

const cached = await tryLoadEmbeddingRun(
  {
    functions: sampleFunctions,
    chunks: sampleChunks,
    fingerprint
  },
  { client: mockClient }
);

assert.ok(cached, 'Expected cached embeddings payload');
assert.equal(cached.embeddings.length, sampleChunks.length, 'Should load cached embedding vectors');
assert.deepEqual(
  Array.from(cached.embeddings[0].vector),
  Array.from(vectorA),
  'Cached vector should match stored payload'
);
assert.equal(
  cached.embeddings[0].chunk.id,
  sampleChunks[0].id,
  'Chunk reference should match original chunk id'
);
assert.deepEqual(
  Array.from(cached.embeddings[1].vector),
  Array.from(vectorB),
  'Second cached vector should match stored payload'
);
assert.equal(
  cached.similarityEdges[0]?.source,
  'fnA',
  'Similarity edge should resolve source function id'
);
assert.equal(
  cached.similarityEdges[0]?.target,
  'fnB',
  'Similarity edge should resolve target function id'
);
assert.deepEqual(
  cached.functionFingerprints,
  mockClient.data.functionFingerprints,
  'Expected per-function fingerprint map in cached payload'
);

const reuseResult = await loadEmbeddingsForFunctions(
  {
    functions: sampleFunctions,
    chunks: sampleChunks,
    targetFunctionIds: ['fnA']
  },
  { client: mockClient }
);

assert.equal(
  reuseResult.embeddings.length,
  1,
  'Should load embeddings for requested function subset'
);
assert.deepEqual(
  Array.from(reuseResult.embeddings[0].vector),
  Array.from(vectorA),
  'Subset reuse should provide matching vector payload'
);
assert.deepEqual(
  reuseResult.missingFunctions,
  [],
  'No missing functions expected when cached data exists'
);
assert.equal(
  reuseResult.metadata?.dimension,
  4,
  'Metadata should include embedding dimension for reused vectors'
);

console.log('persistence.test.mjs passed');

