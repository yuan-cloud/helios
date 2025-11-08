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
  if (!Array.isArray(functionEmbeddings) || functionEmbeddings.length < 2) {
    return {
      edges: [],
      stats: {
        functionsWithEmbeddings: Array.isArray(functionEmbeddings) ? functionEmbeddings.length : 0,
        candidatePairs: 0,
        evaluatedPairs: 0,
        finalEdges: 0,
        maxNeighbors: options.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS,
        similarityThreshold: options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
        bundleTopK: options.bundleTopK ?? DEFAULT_BUNDLE_TOP_K
      }
    };
  }

  const maxNeighbors = options.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS;
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const bundleTopK = options.bundleTopK ?? DEFAULT_BUNDLE_TOP_K;
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const count = functionEmbeddings.length;
  const candidateLists = Array.from({ length: count }, () => []);

  // Precompute representative similarities to narrow candidate pool.
  for (let i = 0; i < count; i++) {
    const entryA = functionEmbeddings[i];
    for (let j = i + 1; j < count; j++) {
      const entryB = functionEmbeddings[j];
      const repSimilarity = dot(entryA.representative, entryB.representative);
      if (!Number.isFinite(repSimilarity)) {
        continue;
      }
      candidateLists[i].push({ index: j, score: repSimilarity });
      candidateLists[j].push({ index: i, score: repSimilarity });
    }
  }

  candidateLists.forEach(list => {
    list.sort((a, b) => b.score - a.score);
    if (list.length > candidateLimit) {
      list.length = candidateLimit;
    }
  });

  const edgeMap = new Map();
  let evaluatedPairs = 0;

  for (let i = 0; i < count; i++) {
    const entryA = functionEmbeddings[i];
    const candidates = candidateLists[i];
    for (const candidate of candidates) {
      const j = candidate.index;
      if (i >= j) {
        continue;
      }
      const entryB = functionEmbeddings[j];
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
        representativeSimilarity: candidate.score,
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
      candidatePairs: edgeMap.size,
      evaluatedPairs,
      finalEdges: finalEdges.length,
      maxNeighbors,
      similarityThreshold,
      bundleTopK
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


