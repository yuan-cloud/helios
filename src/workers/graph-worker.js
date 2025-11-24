// Workers don't inherit import maps, so we need to pre-load graphology using absolute URLs
// and make it available globally before importing modules that depend on it
const graphologyUrls = [
  '/public/vendor/graphology/graphology.esm.js', // Try local first
  'https://cdn.jsdelivr.net/npm/graphology@0.25.4/dist/graphology.esm.js', // CDN fallback
  'https://esm.run/graphology@0.25.4' // ESM.run fallback
];
const louvainUrl = 'https://esm.run/graphology-communities-louvain@2.0.2';

// Pre-load graphology modules and store them globally so dependent modules can use them
// If this fails, the worker will fail to initialize and the client will fall back to inline computation
let graphologyModule = null;
let lastError = null;

for (const url of graphologyUrls) {
  try {
    console.log('[GraphWorker] Trying to load graphology from:', url);
    graphologyModule = await import(url);
    graphologyModule = graphologyModule.default || graphologyModule;
    console.log('[GraphWorker] Successfully loaded graphology from:', url);
    break;
  } catch (err) {
    console.warn('[GraphWorker] Failed to load graphology from', url, ':', err.message);
    lastError = err;
    continue;
  }
}

if (!graphologyModule) {
  throw new Error(`Failed to load graphology from all sources: ${lastError?.message || 'Unknown error'}`);
}

// Load louvain
let louvainModule = null;
try {
  louvainModule = await import(louvainUrl);
  louvainModule = louvainModule.default || louvainModule;
} catch (err) {
  console.warn('[GraphWorker] Failed to load louvain:', err.message);
  // Louvain is optional, continue without it
}

// Store in global scope so graph-builder.js and communities.js can access them
// Use double underscore prefix to indicate internal/private global
self.__graphology = graphologyModule;
if (louvainModule) {
  self.__graphologyLouvain = louvainModule;
}

// Now import modules that depend on graphology
import { mergeGraphPayload } from '../graph/merge.js';
import { collectGraphPayload, buildAnalyzedGraph, serializeGraph } from '../graph/pipeline.js';
import { validateGraphPayload } from '../graph/payload-validator.js';

let requestCounter = 0;

function serializeError(error) {
  if (!error) {
    return { name: 'Error', message: 'Unknown graph worker error' };
  }
  const { name = 'Error', message = 'Graph worker error', stack, cause } = error;
  const serialized = { name, message };
  if (stack) {
    serialized.stack = stack;
  }
  if (cause) {
    serialized.cause = typeof cause === 'object' ? serializeError(cause) : cause;
  }
  if (error.code) {
    serialized.code = error.code;
  }
  return serialized;
}

function postResponse(type, requestId, data) {
  self.postMessage({
    type,
    requestId,
    data
  });
}

function postError(requestId, error) {
  self.postMessage({
    type: 'error',
    requestId,
    error: serializeError(error)
  });
}

self.addEventListener('message', async (event) => {
  const { data } = event;
  if (!data || typeof data.type !== 'string') {
    return;
  }
  const requestId = typeof data.requestId === 'number' ? data.requestId : ++requestCounter;
  const { type, payload = {}, options = {} } = data;

  if (type !== 'analyze') {
    postError(requestId, new Error(`Unknown graph worker message type: ${type}`));
    return;
  }

  try {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('Graph worker payload must be an object.');
    }
    const mergedInput =
      payload.parser || payload.embeddings || payload.overrides
        ? mergeGraphPayload(payload)
        : payload;
    const validation = validateGraphPayload(mergedInput, { strict: options.strict === true });
    const collected = collectGraphPayload(mergedInput);
    const { graph, summary } = buildAnalyzedGraph(collected, {
      assignMetrics: options.assignMetrics !== false,
      analysis: options.analysis || {}
    });
    const serialized = serializeGraph(graph);

    postResponse('analyze-result', requestId, {
      summary,
      serialized,
      collected,
      payload: mergedInput,
      validation: {
        valid: validation.valid,
        errors: validation.errors
      }
    });
  } catch (error) {
    postError(requestId, error);
  }
});


