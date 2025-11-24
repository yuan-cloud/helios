// Workers don't inherit import maps, so we need to pre-load graphology using absolute URLs
// and make it available globally before importing modules that depend on it
// IMPORTANT: Only use local vendor file - CDN builds have Node.js dependencies like "events" that workers can't resolve
const graphologyUrl = '/public/vendor/graphology/graphology.esm.js';
const louvainUrl = 'https://esm.run/graphology-communities-louvain@2.0.2';

// Pre-load graphology modules and store them globally so dependent modules can use them
// If this fails, the worker will fail to initialize and the client will fall back to inline computation
let graphologyModule = null;

try {
  console.log('[GraphWorker] Loading graphology from local vendor file:', graphologyUrl);
  graphologyModule = await import(graphologyUrl);
  graphologyModule = graphologyModule.default || graphologyModule;
  console.log('[GraphWorker] Successfully loaded graphology');
} catch (err) {
  console.error('[GraphWorker] Failed to load graphology from local vendor file:', err);
  throw new Error(`Failed to load graphology from local vendor file: ${err.message}. Make sure /public/vendor/graphology/graphology.esm.js exists.`);
}

if (!graphologyModule) {
  throw new Error('Graphology module is null after import');
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
// CRITICAL: Set these BEFORE importing any modules that depend on them
self.__graphology = graphologyModule;
if (louvainModule) {
  self.__graphologyLouvain = louvainModule;
}

// Verify graphology is set before importing dependent modules
if (!self.__graphology) {
  throw new Error('[GraphWorker] CRITICAL: self.__graphology not set after loading!');
}

console.log('[GraphWorker] Graphology loaded and set to self.__graphology:', !!self.__graphology);

// Now import modules that depend on graphology
// These imports will execute their top-level await code, which should now find self.__graphology
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


