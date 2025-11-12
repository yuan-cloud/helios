/**
 * Backend detection helpers for embeddings (PLAN.md §3.4).
 */

const WEBGPU_BACKEND = 'webgpu';
const WASM_BACKEND = 'wasm';

/**
 * Check if WebGPU is available and an adapter can be requested.
 * @returns {Promise<boolean>}
 */
export async function isWebGPUAvailable() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (err) {
    console.warn('[Embeddings] WebGPU adapter request failed:', err);
    return false;
  }
}

/**
 * Detect the preferred runtime backend.
 * @param {Object} options
 * @param {string|null} [options.forceBackend]
 * @returns {Promise<string>}
 */
export async function detectPreferredBackend(options = {}) {
  const { forceBackend = null } = options;
  if (forceBackend) {
    return forceBackend;
  }

  if (await isWebGPUAvailable()) {
    return WEBGPU_BACKEND;
  }

  return WASM_BACKEND;
}

/**
 * Recommend a worker count for the current device.
 * Keeps a single worker on lower core counts.
 * @returns {number}
 */
export function recommendWorkerCount() {
  if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) {
    return 1;
  }
  const cores = navigator.hardwareConcurrency;
  if (cores <= 2) {
    return 1;
  }
  if (cores <= 4) {
    return 1;
  }
  return Math.min(4, Math.max(1, cores - 2));
}

export const BACKENDS = {
  WEBGPU: WEBGPU_BACKEND,
  WASM: WASM_BACKEND
};

/**
 * Detect overall embedding environment characteristics.
 * Returns the preferred backend alongside capability markers.
 * @param {Object} options
 * @param {string|null} [options.forceBackend]
 * @returns {Promise<{backend: string, webgpuAvailable: boolean, forcedBackend: string|null}>}
 */
export async function detectEmbeddingEnvironment(options = {}) {
  const { forceBackend = null } = options;
  let backend = forceBackend ?? null;
  let webgpuAvailable = false;

  if (!backend) {
    webgpuAvailable = await isWebGPUAvailable();
    backend = webgpuAvailable ? WEBGPU_BACKEND : WASM_BACKEND;
  } else if (backend === WEBGPU_BACKEND) {
    webgpuAvailable = await isWebGPUAvailable();
  } else {
    // Forcing WASM — still probe WebGPU once for telemetry.
    webgpuAvailable = await isWebGPUAvailable();
  }

  return {
    backend,
    webgpuAvailable,
    forcedBackend: forceBackend ?? null
  };
}

