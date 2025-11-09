/**
 * Similarity computation utilities (PLAN.md §3.5).
 *
 * - Aggregates chunk embeddings per function.
 * - Computes representative vectors for quick candidate search.
 * - Calculates bundle similarity using top-k cosine scores.
 */

const DEFAULT_MAX_NEIGHBORS = 8;
const DEFAULT_CANDIDATE_LIMIT = 20;
const DEFAULT_BUNDLE_TOP_K = 3;
const DEFAULT_SIMILARITY_THRESHOLD = 0.65;

const DEFAULT_APPROXIMATE_THRESHOLD = 600;
const DEFAULT_APPROXIMATE_PROJECTIONS = 12;
const DEFAULT_APPROXIMATE_BAND_SIZE = 24;
const DEFAULT_APPROXIMATE_OVERSAMPLE = 2;
const DEFAULT_APPROXIMATE_SEED = 1337;

/**
 * Aggregate chunk embeddings per function.
 * @param {Object} params
 * @param {Array<Object>} params.functions - Function metadata array.
 * @param {Array<Object>} params.embeddings - Array of { chunk, vector } pairs.
 * @param {number} params.dimension - Embedding dimensionality.
 * @returns {Array<Object>}
 */
export function buildFunctionEmbeddings({ functions = [], embeddings = [], dimension = 0 }) {
  if (!Array.isArray(functions) || !Array.isArray(embeddings) || dimension <= 0) {
    return [];
  }

  const byFunction = new Map();
  functions.forEach(fn => {
    if (!fn?.id) {
      return;
    }
    byFunction.set(fn.id, {
      id: fn.id,
      function: fn,
      chunks: [],
      representative: null
    });
  });

  embeddings.forEach(entry => {
    const chunk = entry?.chunk;
    const vector = entry?.vector;
    if (!chunk?.functionId || !vector || vector.length !== dimension) {
      return;
    }
    const target = byFunction.get(chunk.functionId);
    if (!target) {
      return;
    }
    target.chunks.push({
      chunk,
      vector
    });
  });

  const results = [];
  for (const [, entry] of byFunction.entries()) {
    if (!entry.chunks.length) {
      continue;
    }
    const representative = computeRepresentative(entry.chunks, dimension);
    if (!representative) {
      continue;
    }
    entry.representative = representative;
    entry.chunkCount = entry.chunks.length;
    results.push(entry);
  }

  return results;
}

/**
 * Compute similarity graph edges from function embeddings.
 * @param {Array<Object>} functionEmbeddings
 * @param {Object} options
 * @param {number} [options.maxNeighbors]
 * @param {number} [options.candidateLimit]
 * @param {number} [options.bundleTopK]
 * @param {number} [options.similarityThreshold]
 * @returns {{edges: Array<Object>, stats: Object}}
 */
export function computeSimilarityGraph(functionEmbeddings, options = {}) {
  const functionsCount = Array.isArray(functionEmbeddings) ? functionEmbeddings.length : 0;
  if (!Array.isArray(functionEmbeddings) || functionsCount < 2) {
    return {
      edges: [],
      stats: {
        functionsWithEmbeddings: functionsCount,
        candidatePairs: 0,
        evaluatedPairs: 0,
        finalEdges: 0,
        maxNeighbors: options.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS,
        similarityThreshold: options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
        bundleTopK: options.bundleTopK ?? DEFAULT_BUNDLE_TOP_K,
        approximate: false
      }
    };
  }

  const maxNeighbors = options.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS;
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const bundleTopK = options.bundleTopK ?? DEFAULT_BUNDLE_TOP_K;
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const approximateRequested = Boolean(options.approximate);
  const approximateThreshold = options.approximateThreshold ?? DEFAULT_APPROXIMATE_THRESHOLD;
  const useApproximate = approximateRequested || (approximateThreshold > 0 && functionsCount >= approximateThreshold);

  const candidateLists = useApproximate
    ? buildApproximateCandidateLists(functionEmbeddings, candidateLimit, {
        projectionCount: options.approximateProjectionCount,
        bandSize: options.approximateBandSize,
        oversampleFactor: options.approximateOversample,
        seed: options.approximateSeed
      })
    : buildExactCandidateLists(functionEmbeddings, candidateLimit);

  const edgeMap = new Map();
  let evaluatedPairs = 0;
  let candidatePairs = 0;

  for (let i = 0; i < functionsCount; i++) {
    const entryA = functionEmbeddings[i];
    const candidates = candidateLists[i];
    if (!Array.isArray(candidates) || !candidates.length) {
      continue;
    }
    for (const candidate of candidates) {
      const j = candidate.index;
      if (i >= j) {
        continue;
      }
      candidatePairs++;
      const entryB = functionEmbeddings[j];
      const representativeSimilarity = Number.isFinite(candidate.score)
        ? candidate.score
        : dot(entryA.representative, entryB.representative);
      if (!Number.isFinite(representativeSimilarity)) {
        continue;
      }
      const bundle = computeBundleSimilarity(entryA.chunks, entryB.chunks, bundleTopK);
      evaluatedPairs++;
      if (!bundle || bundle.score < similarityThreshold) {
        continue;
      }

      const key = `${entryA.id}::${entryB.id}`;
      edgeMap.set(key, {
        key,
        source: entryA.id,
        target: entryB.id,
        similarity: bundle.score,
        method: 'topk-avg',
        representativeSimilarity,
        topPairs: bundle.topPairs
      });
    }
  }

  const adjacency = new Map();
  for (const edge of edgeMap.values()) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, []);
    }
    adjacency.get(edge.source).push({ neighbor: edge.target, similarity: edge.similarity, key: edge.key });
    adjacency.get(edge.target).push({ neighbor: edge.source, similarity: edge.similarity, key: edge.key });
  }

  const edgesToKeep = new Set();
  for (const [, neighbors] of adjacency.entries()) {
    neighbors.sort((a, b) => b.similarity - a.similarity);
    for (let idx = 0; idx < neighbors.length && idx < maxNeighbors; idx++) {
      edgesToKeep.add(neighbors[idx].key);
    }
  }

  const finalEdges = Array.from(edgeMap.values()).filter(edge => edgesToKeep.has(edge.key));

  return {
    edges: finalEdges.map(edge => ({
      source: edge.source,
      target: edge.target,
      similarity: edge.similarity,
      method: edge.method,
      representativeSimilarity: edge.representativeSimilarity,
      topPairs: edge.topPairs
    })),
    stats: {
      functionsWithEmbeddings: functionEmbeddings.length,
      candidatePairs,
      evaluatedPairs,
      finalEdges: finalEdges.length,
      maxNeighbors,
      similarityThreshold,
      bundleTopK,
      approximate: useApproximate,
      approximateConfig: useApproximate
        ? {
            projectionCount: options.approximateProjectionCount ?? DEFAULT_APPROXIMATE_PROJECTIONS,
            bandSize: options.approximateBandSize ?? DEFAULT_APPROXIMATE_BAND_SIZE,
            oversampleFactor: options.approximateOversample ?? DEFAULT_APPROXIMATE_OVERSAMPLE
          }
        : null
    }
  };
}

function computeRepresentative(chunks, dimension) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return null;
  }
  const accumulator = new Float32Array(dimension);
  for (const item of chunks) {
    const vector = item.vector;
    if (!vector || vector.length !== dimension) {
      continue;
    }
    for (let i = 0; i < dimension; i++) {
      accumulator[i] += vector[i];
    }
  }
  const count = chunks.length;
  if (!count) {
    return null;
  }
  for (let i = 0; i < dimension; i++) {
    accumulator[i] /= count;
  }
  return normalize(accumulator);
}

function computeBundleSimilarity(chunksA, chunksB, topK) {
  if (!Array.isArray(chunksA) || !Array.isArray(chunksB) || !chunksA.length || !chunksB.length) {
    return null;
  }

  const scores = [];
  for (const itemA of chunksA) {
    const vectorA = itemA.vector;
    if (!vectorA) continue;
    for (const itemB of chunksB) {
      const vectorB = itemB.vector;
      if (!vectorB) continue;
      const score = dot(vectorA, vectorB);
      if (!Number.isFinite(score)) {
        continue;
      }
      scores.push({
        score,
        pair: {
          aChunkId: itemA.chunk?.id ?? null,
          bChunkId: itemB.chunk?.id ?? null
        }
      });
    }
  }

  if (!scores.length) {
    return null;
  }

  scores.sort((a, b) => b.score - a.score);
  const k = Math.min(topK ?? DEFAULT_BUNDLE_TOP_K, scores.length);
  let total = 0;
  const topPairs = [];
  for (let i = 0; i < k; i++) {
    total += scores[i].score;
    topPairs.push({
      ...scores[i].pair,
      score: scores[i].score
    });
  }

  return {
    score: total / k,
    topPairs
  };
}

function dot(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return NaN;
  }
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

function normalize(vector) {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  if (!Number.isFinite(norm) || norm === 0) {
    return vector;
  }
  const magnitude = Math.sqrt(norm);
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= magnitude;
  }
  return vector;
}

function buildExactCandidateLists(functionEmbeddings, candidateLimit) {
  const count = functionEmbeddings.length;
  if (count < 2) {
    return Array.from({ length: count }, () => []);
  }

  const lists = Array.from({ length: count }, () => []);

  for (let i = 0; i < count; i++) {
    const repA = functionEmbeddings[i]?.representative;
    if (!repA) {
      continue;
    }
    for (let j = i + 1; j < count; j++) {
      const repB = functionEmbeddings[j]?.representative;
      if (!repB) {
        continue;
      }
      const repSimilarity = dot(repA, repB);
      if (!Number.isFinite(repSimilarity)) {
        continue;
      }
      lists[i].push({ index: j, score: repSimilarity });
      lists[j].push({ index: i, score: repSimilarity });
    }
  }

  lists.forEach(list => {
    if (!list.length) {
      return;
    }
    list.sort((a, b) => b.score - a.score);
    if (list.length > candidateLimit) {
      list.length = candidateLimit;
    }
  });

  return lists;
}

function buildApproximateCandidateLists(functionEmbeddings, candidateLimit, config = {}) {
  const count = functionEmbeddings.length;
  if (count < 2) {
    return Array.from({ length: count }, () => []);
  }

  const dimension = functionEmbeddings[0]?.representative?.length ?? 0;
  if (!dimension) {
    return Array.from({ length: count }, () => []);
  }

  const projectionCount = clampInteger(
    config.projectionCount ?? DEFAULT_APPROXIMATE_PROJECTIONS,
    1,
    64
  );
  const bandSize = clampInteger(
    config.bandSize ?? DEFAULT_APPROXIMATE_BAND_SIZE,
    1,
    Math.max(count - 1, 1)
  );
  const oversampleFactor = Math.max(config.oversampleFactor ?? DEFAULT_APPROXIMATE_OVERSAMPLE, 1);
  const rng = createSeededRandom(config.seed ?? DEFAULT_APPROXIMATE_SEED);

  const projections = [];
  for (let i = 0; i < projectionCount; i++) {
    projections.push(randomUnitVector(dimension, rng));
  }

  const scoresByProjection = projections.map(() => new Float32Array(count));

  for (let idx = 0; idx < count; idx++) {
    const rep = functionEmbeddings[idx]?.representative;
    if (!rep) {
      continue;
    }
    for (let p = 0; p < projectionCount; p++) {
      scoresByProjection[p][idx] = dot(rep, projections[p]);
    }
  }

  const sortedIndices = projections.map((_, p) => {
    const indices = Array.from({ length: count }, (_, idx) => idx);
    const scores = scoresByProjection[p];
    indices.sort((a, b) => scores[a] - scores[b]);
    return indices;
  });

  const candidateMaps = Array.from({ length: count }, () => new Map());

  for (let p = 0; p < projectionCount; p++) {
    const sorted = sortedIndices[p];
    const scores = scoresByProjection[p];
    for (let position = 0; position < count; position++) {
      const currentIndex = sorted[position];
      const rep = functionEmbeddings[currentIndex]?.representative;
      if (!rep) {
        continue;
      }
      for (let offset = 1; offset <= bandSize; offset++) {
        const leftPos = position - offset;
        if (leftPos >= 0) {
          const leftIndex = sorted[leftPos];
          const delta = Math.abs(scores[currentIndex] - scores[leftIndex]);
          addApproximateCandidate(candidateMaps, currentIndex, leftIndex, delta);
        }
        const rightPos = position + offset;
        if (rightPos < count) {
          const rightIndex = sorted[rightPos];
          const delta = Math.abs(scores[currentIndex] - scores[rightIndex]);
          addApproximateCandidate(candidateMaps, currentIndex, rightIndex, delta);
        }
      }
    }
  }

  const oversampledLimit = Math.min(candidateLimit * oversampleFactor, Math.max(count - 1, 1));
  const lists = Array.from({ length: count }, () => []);

  for (let i = 0; i < count; i++) {
    const repA = functionEmbeddings[i]?.representative;
    if (!repA) {
      continue;
    }
    const neighborMap = candidateMaps[i];
    if (!neighborMap || neighborMap.size === 0) {
      lists[i] = [];
      continue;
    }
    const neighbors = [];
    for (const [neighborIndex] of neighborMap) {
      const repB = functionEmbeddings[neighborIndex]?.representative;
      if (!repB) {
        continue;
      }
      const repSimilarity = dot(repA, repB);
      if (!Number.isFinite(repSimilarity)) {
        continue;
      }
      neighbors.push({
        index: neighborIndex,
        score: repSimilarity
      });
    }
    if (!neighbors.length) {
      lists[i] = [];
      continue;
    }
    neighbors.sort((a, b) => b.score - a.score);
    if (neighbors.length > oversampledLimit) {
      neighbors.length = oversampledLimit;
    }
    lists[i] = neighbors;
  }

  return lists;
}

function addApproximateCandidate(candidateMaps, a, b, distance) {
  if (!Number.isFinite(distance) || a === b) {
    return;
  }
  const mapA = candidateMaps[a];
  const mapB = candidateMaps[b];
  if (!mapA || !mapB) {
    return;
  }
  const existingA = mapA.get(b);
  if (existingA === undefined || distance < existingA) {
    mapA.set(b, distance);
  }
  const existingB = mapB.get(a);
  if (existingB === undefined || distance < existingB) {
    mapB.set(a, distance);
  }
}

function randomUnitVector(dimension, randomFn) {
  const vector = new Float32Array(dimension);
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    // Box-Muller transform to approximate normal distribution
    const u1 = Math.max(randomFn(), Number.EPSILON);
    const u2 = randomFn();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const z0 = mag * Math.cos(2.0 * Math.PI * u2);
    vector[i] = z0;
    norm += z0 * z0;
  }
  if (!Number.isFinite(norm) || norm === 0) {
    vector[0] = 1;
    return vector;
  }
  const invMag = 1 / Math.sqrt(norm);
  for (let i = 0; i < dimension; i++) {
    vector[i] *= invMag;
  }
  return vector;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function seededRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}


