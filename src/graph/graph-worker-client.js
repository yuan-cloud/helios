import { mergeGraphPayload } from './merge.js';
import { collectGraphPayload, buildAnalyzedGraph, serializeGraph } from './pipeline.js';
import { validateGraphPayload } from './payload-validator.js';

function inflateError(error) {
  if (!error) {
    return new Error('Graph worker error');
  }
  const err = new Error(error.message || 'Graph worker error');
  err.name = error.name || 'Error';
  if (error.stack) {
    err.stack = error.stack;
  }
  if (error.code) {
    err.code = error.code;
  }
  if (error.cause) {
    err.cause = inflateError(error.cause);
  }
  return err;
}

export class GraphWorkerClient {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.useWorker=true]
   */
  constructor(options = {}) {
    this.useWorker = options.useWorker !== false && typeof Worker !== 'undefined';
    this.workerModulePath = new URL('../workers/graph-worker.js', import.meta.url);
    this.worker = null;
    this.requestSeq = 0;
    this.pending = new Map();
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // Only reject pending requests if worker was actually disposed unexpectedly
    // (not during normal error fallback)
    if (this.pending.size > 0) {
      const pendingCount = this.pending.size;
      this.pending.forEach(entry => entry.reject(new Error('Graph worker disposed')));
      this.pending.clear();
      // Only warn if there were pending requests (unexpected disposal)
      if (pendingCount > 0) {
        console.debug(`[GraphWorkerClient] Disposed worker with ${pendingCount} pending request(s)`);
      }
    }
  }

  async analyze(input, options = {}) {
    const payload = this.#normalizeInput(input);

    if (this.useWorker) {
      try {
        const response = await this.#postRequest('analyze', payload, options);
        return {
          graph: null,
          payload: response.payload || payload,
          collected: response.collected,
          summary: response.summary,
          serialized: response.serialized,
          validation: response.validation || { valid: true, errors: [] },
          viaWorker: true
        };
      } catch (error) {
        console.warn('[GraphWorkerClient] Worker request failed, falling back to inline computation:', error);
        this.useWorker = false;
        this.dispose();
      }
    }

    const collected = collectGraphPayload(payload);
    const { graph, summary } = buildAnalyzedGraph(collected, {
      assignMetrics: options.assignMetrics !== false,
      analysis: options.analysis || {}
    });
    const serialized = serializeGraph(graph);
    const validation = runInlineValidation(payload, options);

    return {
      graph,
      payload,
      collected,
      summary,
      serialized,
      validation,
      viaWorker: false
    };
  }

  #normalizeInput(input) {
    if (!input || typeof input !== 'object') {
      return { functions: [], callEdges: [], similarityEdges: [], extras: null };
    }
    if (input.functions && input.callEdges && input.similarityEdges && !input.parser && !input.embeddings) {
      return input;
    }
    return mergeGraphPayload(input);
  }

  async #ensureWorker() {
    if (this.worker) {
      return this.worker;
    }
    this.worker = new Worker(this.workerModulePath, { type: 'module' });
    this.worker.onmessage = (event) => this.#handleMessage(event);
    this.worker.addEventListener('error', (event) => {
      const message =
        event?.message ||
        event?.error?.message ||
        (event?.filename ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : 'unknown error');
      console.warn(`[GraphWorkerClient] Graph worker failed (${message}); falling back to inline analysis.`);
      this.useWorker = false;
      this.dispose();
    });
    return this.worker;
  }

  async #postRequest(type, payload, options) {
    const worker = await this.#ensureWorker();
    const requestId = ++this.requestSeq;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage({
          type,
          requestId,
          payload,
          options
        });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  #handleMessage(event) {
    const { data } = event;
    if (!data || typeof data.requestId !== 'number') {
      return;
    }
    const { requestId, type, data: payload, error } = data;
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);

    if (type === 'error') {
      pending.reject(inflateError(error));
      return;
    }
    if (type === 'analyze-result') {
      pending.resolve(payload || {});
      return;
    }
    pending.reject(new Error(`Unexpected worker response type: ${type}`));
  }
}

function runInlineValidation(payload, options) {
  if (typeof validateGraphPayload !== 'function') {
    return { valid: true, errors: [] };
  }
  try {
    const result = validateGraphPayload(payload, { strict: options.strict === true });
    return {
      valid: result.valid,
      errors: result.errors
    };
  } catch (error) {
    console.warn('[GraphWorkerClient] Inline validation error:', error);
    return { valid: false, errors: [error?.message || 'Validation failed'] };
  }
}



