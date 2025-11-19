// Workers don't inherit import maps, so we need to pre-load graphology using absolute URLs
// and make it available globally before importing modules that depend on it
const graphologyUrl = '/public/vendor/graphology/graphology.esm.js';
const louvainUrl = '/public/vendor/graphology-communities-louvain/index.js';

// Pre-load graphology modules and store them globally so dependent modules can use them
// If this fails, the worker will fail to initialize and the client will fall back to inline computation
try {
  const [graphologyModule, louvainModule] = await Promise.all([
    import(graphologyUrl),
    import(louvainUrl)
  ]);

  // Store in global scope so graph-builder.js and communities.js can access them
  // Use double underscore prefix to indicate internal/private global
  self.__graphology = graphologyModule.default || graphologyModule;
  self.__graphologyLouvain = louvainModule.default || louvainModule;
} catch (error) {
  // If graphology fails to load, throw to prevent worker initialization
  // The worker client will catch this and fall back to inline computation
  throw new Error(`Failed to load graphology modules in worker: ${error.message}`);
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


