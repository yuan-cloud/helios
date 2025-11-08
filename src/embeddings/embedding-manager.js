import { chunkFunctions, chunkingDefaults } from './chunker.js';
import { detectPreferredBackend, recommendWorkerCount, BACKENDS } from './backend.js';

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_BATCH_SIZE = 8;

/**
 * EmbeddingManager coordinates chunking and worker-based embedding inference.
 */
export class EmbeddingManager {
  /**
   * @param {Object} options
   * @param {string} [options.modelId]
   * @param {boolean} [options.quantized]
   * @param {number} [options.batchSize]
   * @param {number} [options.maxTokens]
   * @param {number} [options.minTokens]
   * @param {string|null} [options.backend]
   */
  constructor(options = {}) {
    this.modelId = options.modelId || DEFAULT_MODEL_ID;
    this.quantized = options.quantized !== false;
    this.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.chunkOptions = {
      maxTokens: options.maxTokens || chunkingDefaults.maxTokens,
      minTokens: options.minTokens || chunkingDefaults.minTokens
    };
    this.forcedBackend = options.backend || null;
    this.workerCount = options.workerCount || recommendWorkerCount();

    this.worker = null;
    this.requestSeq = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.initializingPromise = null;
    this.backend = null;
    this.dimension = null;
  }

  /**
   * Prepare chunks for a list of functions.
   * @param {Array<Object>} functions
   * @param {Object} [options]
   * @returns {{chunks: Array<Object>, stats: Object}}
   */
  prepareFunctionChunks(functions, options = {}) {
    const chunkOpts = {
      ...this.chunkOptions,
      ...options
    };
    return chunkFunctions(functions, chunkOpts);
  }

  /**
   * Initialize the embedding worker and load the model.
   * @param {Object} [options]
   * @returns {Promise<{backend: string, modelId: string, dimension: number}>}
   */
  async initialize(options = {}) {
    if (this.initialized) {
      return {
        backend: this.backend,
        modelId: this.modelId,
        dimension: this.dimension
      };
    }

    if (!this.initializingPromise) {
      this.initializingPromise = this.#spawnWorker(options)
        .catch(err => {
          this.initializingPromise = null;
          throw err;
        });
    }

    return this.initializingPromise;
  }

  /**
   * Terminate worker and reset state.
   */
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.forEach(entry => {
      entry.reject(new Error('Embedding manager disposed'));
    });
    this.pendingRequests.clear();
    this.initialized = false;
    this.initializingPromise = null;
    this.backend = null;
    this.dimension = null;
  }

  /**
   * Generate embeddings for provided functions (chunk + embed).
   * @param {Array<Object>} functions
   * @param {Object} [options]
   * @returns {Promise<{chunks: Array<Object>, embeddings: Array<Object>, backend: string, modelId: string, dimension: number}>}
   */
  async embedFunctions(functions, options = {}) {
    const precomputed = options.preparedChunks && Array.isArray(options.preparedChunks.chunks)
      ? options.preparedChunks
      : null;
    const chunkResult = precomputed || this.prepareFunctionChunks(functions, options.chunkOptions);
    if (!chunkResult.chunks.length) {
      return {
        chunks: [],
        embeddings: [],
        backend: null,
        modelId: this.modelId,
        dimension: this.dimension ?? null,
        stats: chunkResult.stats || { processedFunctions: 0, chunkCount: 0, totalTokens: 0, averageTokens: 0, averageChunksPerFunction: 0 }
      };
    }

    const initInfo = await this.initialize(options);

    const payload = {
      chunks: chunkResult.chunks.map(chunk => ({
        id: chunk.id,
        text: chunk.text
      })),
      batchSize: options.batchSize || this.batchSize
    };

    const response = await this.#postRequest('embed-chunks', payload);

    const vectorByChunkId = new Map();
    (response.embeddings || []).forEach(item => {
      vectorByChunkId.set(item.chunkId, item.vector);
    });

    const embeddings = chunkResult.chunks.map(chunk => ({
      chunk,
      vector: vectorByChunkId.get(chunk.id) || null
    }));

    return {
      chunks: chunkResult.chunks,
      embeddings,
      backend: response.backend || initInfo.backend,
      modelId: response.modelId || initInfo.modelId,
      dimension: response.dimension || initInfo.dimension,
      stats: chunkResult.stats
    };
  }

  /**
   * Internal: spawn worker and perform init handshake.
   * @param {Object} options
   * @returns {Promise<{backend: string, modelId: string, dimension: number}>}
   */
  async #spawnWorker(options = {}) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment.');
    }

    if (!this.worker) {
      const workerUrl = new URL('../workers/embedding-worker.js', import.meta.url);
      this.worker = new Worker(workerUrl, { type: 'module' });
      this.worker.onmessage = event => this.#handleMessage(event);
      this.worker.onerror = error => {
        console.error('[Embeddings] Worker error:', error);
      };
    }

    const backendPreference = options.backend || this.forcedBackend || await detectPreferredBackend();
    const initResponse = await this.#postRequest('init', {
      modelId: this.modelId,
      backendPreference,
      quantized: this.quantized,
      batchSize: this.batchSize
    });

    this.backend = initResponse.backend || backendPreference;
    this.dimension = initResponse.dimension || null;
    this.modelId = initResponse.modelId || this.modelId;
    this.initialized = true;

    return {
      backend: this.backend,
      modelId: this.modelId,
      dimension: this.dimension
    };
  }

  /**
   * Internal: send request message and await response.
   * @param {string} type
   * @param {Object} payload
   * @returns {Promise<any>}
   */
  #postRequest(type, payload) {
    if (!this.worker) {
      throw new Error('Embedding worker not initialized.');
    }
    const requestId = ++this.requestSeq;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage({ type, requestId, payload });
      } catch (err) {
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Internal: handle worker messages.
   * @param {MessageEvent} event
   */
  #handleMessage(event) {
    const { type, requestId, data, error } = event.data || {};
    if (requestId == null) {
      if (type === 'log' && data) {
        console.log('[Embeddings Worker]', data);
      }
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(requestId);

    if (type === 'error') {
      pending.reject(this.#inflateError(error));
      return;
    }

    if (type === 'init-done') {
      if (data?.backend) {
        this.backend = data.backend;
      }
      if (data?.modelId) {
        this.modelId = data.modelId;
      }
      if (data?.dimension) {
        this.dimension = data.dimension;
      }
      pending.resolve(data);
      return;
    }

    if (type === 'embed-chunks-result') {
      if (data?.dimension && !this.dimension) {
        this.dimension = data.dimension;
      }
      pending.resolve(data);
      return;
    }

    pending.reject(new Error(`Unexpected worker response type: ${type}`));
  }

  /**
   * Convert serialized error into Error instance.
   * @param {Object} error
   * @returns {Error}
   */
  #inflateError(error) {
    if (!error) {
      return new Error('Unknown worker error');
    }
    const err = new Error(error.message || 'Worker error');
    if (error.stack) {
      err.stack = error.stack;
    }
    err.name = error.name || 'Error';
    err.cause = error.cause || undefined;
    return err;
  }
}

export { BACKENDS } from './backend.js';

