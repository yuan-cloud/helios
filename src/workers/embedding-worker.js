const TRANSFORMERS_LOCAL_URL = '/public/vendor/transformers.min.js';
const TRANSFORMERS_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.esm.min.js';

let pipeline;
let env;

async function loadTransformersModule() {
  try {
    const mod = await import(TRANSFORMERS_LOCAL_URL);
    pipeline = mod.pipeline;
    env = mod.env;
    console.log('[Embeddings Worker] Loaded transformers from local mirror.');
    return;
  } catch (error) {
    console.warn('[Embeddings Worker] Local transformers load failed, falling back to CDN.', error);
  }

  try {
    const mod = await import(TRANSFORMERS_CDN_URL);
    pipeline = mod.pipeline;
    env = mod.env;
    console.log('[Embeddings Worker] Loaded transformers from CDN fallback.');
  } catch (cdnError) {
    console.error('[Embeddings Worker] Failed to load transformers from CDN fallback.', cdnError);
    throw cdnError;
  }
}

await loadTransformersModule();

console.log('[Embeddings Worker] Transformers env detected backends:', Object.keys(env?.backends ?? {}));
console.log('[Embeddings Worker] Initial ONNX wasm config:', env?.backends?.onnx?.wasm);

const WASM_FALLBACK = 'wasm';
const DEFAULT_BATCH_SIZE = 8;
const ORT_WASM_BASE = '/public/vendor/onnxruntime-web/';

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env?.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = ORT_WASM_BASE;
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
  env.backends.onnx.wasm.simd = true;
  env.backends.onnx.wasm.proxy = false;
  console.log('[Embeddings Worker] ONNX wasm config after override:', env.backends.onnx.wasm);
} else {
  console.warn('[Embeddings Worker] ONNX wasm backend configuration missing.');
}

let embeddingPipeline = null;
let pipelinePromise = null;
let backendInUse = null;
let modelIdInUse = null;
let embeddingDimension = null;

self.onmessage = async event => {
  const { type, requestId, payload } = event.data || {};
  try {
    switch (type) {
      case 'init':
        await handleInit(requestId, payload);
        break;
      case 'embed-chunks':
        await handleEmbedChunks(requestId, payload);
        break;
      default:
        respondError(requestId, new Error(`Unknown message type: ${type}`));
    }
  } catch (err) {
    respondError(requestId, err);
  }
};

async function handleInit(requestId, payload = {}) {
  const { modelId, backendPreference, quantized = true } = payload;
  const backendOrder = deriveBackendOrder(backendPreference);

  let lastError = null;
  for (const backend of backendOrder) {
    try {
      await loadPipeline(modelId, backend, quantized);
      backendInUse = backend;
      modelIdInUse = modelId;
      embeddingDimension = inferModelDimension(embeddingPipeline) || embeddingDimension;
      respond(requestId, 'init-done', {
        backend: backendInUse,
        modelId: modelIdInUse,
        dimension: embeddingDimension
      });
      return;
    } catch (err) {
      console.warn(`[Embeddings Worker] Failed to initialize backend ${backend}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to initialize embedding pipeline');
}

async function handleEmbedChunks(requestId, payload = {}) {
  const { chunks = [], batchSize = DEFAULT_BATCH_SIZE } = payload;
  if (!chunks.length) {
    respond(requestId, 'embed-chunks-result', {
      embeddings: [],
      backend: backendInUse,
      modelId: modelIdInUse,
      dimension: embeddingDimension
    });
    return;
  }

  if (!embeddingPipeline) {
    throw new Error('Embedding pipeline not initialized');
  }

  const results = [];
  const transferables = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await runBatch(batch);
    vectors.forEach(item => {
      results.push(item);
      transferables.push(item.vector.buffer);
    });
  }

  respond(
    requestId,
    'embed-chunks-result',
    {
      embeddings: results,
      backend: backendInUse,
      modelId: modelIdInUse,
      dimension: embeddingDimension
    },
    transferables
  );
}

async function runBatch(batch) {
  const inputs = batch.map(chunk => chunk.text || '');
  const output = await embeddingPipeline(inputs, {
    pooling: 'mean',
    normalize: true
  });

  const data = output?.data || output;
  if (!data) {
    throw new Error('Embedding pipeline returned empty output');
  }

  const dimGuess =
    output?.dims?.length >= 2
      ? output.dims[output.dims.length - 1]
      : Math.floor(data.length / batch.length);

  if (!embeddingDimension) {
    embeddingDimension = dimGuess;
  }

  const vectors = [];
  for (let index = 0; index < batch.length; index++) {
    const start = index * embeddingDimension;
    const end = start + embeddingDimension;
    const slice = data.subarray(start, end);
    const vector = new Float32Array(embeddingDimension);
    vector.set(slice);
    vectors.push({
      chunkId: batch[index].id,
      vector
    });
  }
  return vectors;
}

function deriveBackendOrder(preference) {
  if (!preference) {
    return ['webgpu', WASM_FALLBACK];
  }
  if (preference === 'webgpu') {
    return ['webgpu', WASM_FALLBACK];
  }
  return [preference];
}

async function loadPipeline(modelId, backend, quantized) {
  if (embeddingPipeline && backendInUse === backend && modelIdInUse === modelId) {
    return embeddingPipeline;
  }

  if (!pipelinePromise || backendInUse !== backend || modelIdInUse !== modelId) {
    pipelinePromise = pipeline('feature-extraction', modelId, {
      quantized,
      device: backend
    }).catch(err => {
      pipelinePromise = null;
      throw err;
    });
  }

  embeddingPipeline = await pipelinePromise;
  backendInUse = backend;
  modelIdInUse = modelId;
  return embeddingPipeline;
}

function inferModelDimension(pipe) {
  if (!pipe) {
    return null;
  }
  const modelConfig = pipe?.model?.config || pipe?.config || {};
  return (
    modelConfig.hidden_size ||
    modelConfig.hidden_dim ||
    modelConfig.d_model ||
    null
  );
}

function respond(requestId, type, data, transferables = []) {
  self.postMessage({ requestId, type, data }, transferables);
}

function respondError(requestId, error) {
  const message = error?.message || 'Unknown worker error';
  const serialized = {
    name: error?.name || 'Error',
    message,
    stack: error?.stack || null
  };
  self.postMessage({ requestId, type: 'error', error: serialized });
}

