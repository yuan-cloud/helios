import { StorageWorkerClient } from '../storage/client.js';

const DEFAULT_OPTIONS = {
  fileChunkSize: 125
};

const KV_KEYS = Object.freeze({
  FINGERPRINT: 'embeddings.fingerprint',
  METADATA: 'embeddings.metadata'
});

let singletonClient = null;

function getClient(options = {}) {
  if (options.client) {
    return options.client;
  }
  if (!singletonClient) {
    singletonClient = new StorageWorkerClient();
  }
  return singletonClient;
}

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function buildPlaceholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

async function fetchFileIds(client, paths, chunkSize) {
  const map = new Map();
  if (!paths.length) {
    return map;
  }
  const chunks = chunkArray(paths, chunkSize);
  for (const chunk of chunks) {
    const placeholders = buildPlaceholders(chunk.length);
    const { rows = [] } = await client.query(
      `SELECT file_id, path FROM files WHERE path IN (${placeholders})`,
      chunk
    );
    rows.forEach((row) => {
      map.set(row.path, row.file_id);
    });
  }
  return map;
}

async function fetchFunctionIds(client, fileIds, chunkSize) {
  const map = new Map();
  if (!fileIds.length) {
    return map;
  }
  const chunks = chunkArray(fileIds, chunkSize);
  for (const chunk of chunks) {
    const placeholders = buildPlaceholders(chunk.length);
    const { rows = [] } = await client.query(
      `SELECT fn_id, file_id, name, start FROM functions WHERE file_id IN (${placeholders})`,
      chunk
    );
    rows.forEach((row) => {
      const key = `${row.file_id}:${row.name}:${row.start}`;
      map.set(key, row.fn_id);
    });
  }
  return map;
}

async function fetchChunkIds(client, fnIds, chunkSize) {
  const map = new Map();
  if (!fnIds.length) {
    return map;
  }
  const chunks = chunkArray(fnIds, chunkSize);
  for (const chunk of chunks) {
    const placeholders = buildPlaceholders(chunk.length);
    const { rows = [] } = await client.query(
      `SELECT chunk_id, fn_id, start, "end" FROM chunks WHERE fn_id IN (${placeholders})`,
      chunk
    );
    rows.forEach((row) => {
      const key = `${row.fn_id}:${row.start}:${row.end}`;
      map.set(key, row.chunk_id);
    });
  }
  return map;
}

function toUint8(vector) {
  if (vector instanceof Uint8Array) {
    return vector;
  }
  if (vector instanceof Float32Array) {
    return new Uint8Array(
      vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)
    );
  }
  if (Array.isArray(vector)) {
    return new Uint8Array(new Float32Array(vector).buffer);
  }
  throw new TypeError('Unsupported vector type for persistence');
}

function serializeMetrics(metrics) {
  if (!metrics) {
    return null;
  }
  try {
    return JSON.stringify(metrics);
  } catch {
    return null;
  }
}

function buildFunctionKey(fn, fileId) {
  return `${fileId}:${fn.name}:${fn.start}`;
}

function buildChunkKey(fnId, chunk) {
  return `${fnId}:${chunk.start}:${chunk.end}`;
}

export async function persistEmbeddingRun(
  {
    functions = [],
    chunks = [],
    embeddings = [],
    similarityEdges = [],
    metadata = {},
    fingerprint = ''
  },
  options = {}
) {
  if (!functions.length || !chunks.length || !embeddings.length) {
    return null;
  }

  const client = getClient(options);
  await client.ensureInitialized();

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const fileEntries = new Map();

  const functionById = new Map();
  functions.forEach((fn) => {
    if (!fileEntries.has(fn.filePath)) {
      fileEntries.set(fn.filePath, {
        lang: fn.lang || null
      });
    }
    functionById.set(fn.id, fn);
  });

  const fileStatements = Array.from(fileEntries.entries()).map(([path, info]) => ({
    sql: `INSERT INTO files (path, lang) VALUES (?1, ?2)
          ON CONFLICT(path) DO UPDATE SET lang=excluded.lang`,
    params: [path, info.lang]
  }));

  if (fileStatements.length) {
    await client.batch(fileStatements);
  }

  const fileIdMap = await fetchFileIds(client, Array.from(fileEntries.keys()), opts.fileChunkSize);
  const fileIds = Array.from(fileIdMap.values());

  if (fileIds.length) {
    const placeholders = buildPlaceholders(fileIds.length);
    await client.exec(
      `DELETE FROM functions WHERE file_id IN (${placeholders})`,
      fileIds
    );
  }

  const functionStatements = functions.map((fn) => {
    const fileId = fileIdMap.get(fn.filePath);
    if (!fileId) {
      throw new Error(`Missing file_id for path ${fn.filePath}`);
    }
    const doc = fn.doc || null;
    const loc = fn.loc ?? (fn.endLine && fn.startLine ? fn.endLine - fn.startLine + 1 : null);
    return {
      sql: `INSERT INTO functions (file_id, name, fq_name, start, "end", loc, doc, metrics_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      params: [
        fileId,
        fn.name,
        fn.fqName || fn.name,
        fn.start,
        fn.end,
        loc,
        doc,
        serializeMetrics(fn.metrics)
      ]
    };
  });

  if (functionStatements.length) {
    await client.batch(functionStatements);
  }

  const functionIdMap = await fetchFunctionIds(client, fileIds, opts.fileChunkSize);
  const functionIdLookup = new Map();
  functions.forEach((fn) => {
    const fileId = fileIdMap.get(fn.filePath);
    if (!fileId) {
      return;
    }
    const key = buildFunctionKey(fn, fileId);
    const fnId = functionIdMap.get(key);
    if (fnId) {
      functionIdLookup.set(fn.id, fnId);
    }
  });

  const chunkStatements = [];
  const chunkLookupEntries = [];

  chunks.forEach((chunk) => {
    const functionIdentifier = chunk.functionId ?? chunk.function?.id;
    if (!functionIdentifier) {
      return;
    }
    const fn = functionById.get(functionIdentifier);
    if (!fn) {
      return;
    }
    const fnId = functionIdLookup.get(fn.id);
    if (!fnId) {
      return;
    }
    chunkStatements.push({
      sql: `INSERT INTO chunks (fn_id, start, "end", tok_count)
            VALUES (?1, ?2, ?3, ?4)`,
      params: [fnId, chunk.start, chunk.end, chunk.tokenCount ?? null]
    });
    chunkLookupEntries.push({ chunk, fnId });
  });

  if (chunkStatements.length) {
    await client.batch(chunkStatements);
  }

  const chunkIdMap = await fetchChunkIds(
    client,
    Array.from(new Set(chunkLookupEntries.map((info) => info.fnId))),
    opts.fileChunkSize
  );
  const chunkIdLookup = new Map();
  chunkLookupEntries.forEach(({ chunk, fnId }) => {
    const key = buildChunkKey(fnId, chunk);
    const chunkId = chunkIdMap.get(key);
    if (chunkId) {
      chunkIdLookup.set(chunk.id, chunkId);
    }
  });

  const embeddingStatements = embeddings
    .map((entry) => {
      const chunkMeta = entry.chunk;
      const chunkId = chunkIdLookup.get(chunkMeta.id);
      if (!chunkId) {
        return null;
      }
      const vectorBlob = toUint8(entry.vector);
      return {
        sql: `INSERT INTO embeddings (chunk_id, vec, dim, quant, backend, model)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6)
              ON CONFLICT(chunk_id) DO UPDATE SET
                vec=excluded.vec,
                dim=excluded.dim,
                quant=excluded.quant,
                backend=excluded.backend,
                model=excluded.model`,
        params: [
          chunkId,
          vectorBlob,
          metadata.dimension ?? entry.vector.length ?? null,
          metadata.quantization ?? (metadata.quantized ? 'int8' : 'float32'),
          metadata.backend ?? null,
          metadata.modelId ?? null
        ]
      };
    })
    .filter(Boolean);

  if (embeddingStatements.length) {
    await client.batch(embeddingStatements);
  }

  if (similarityEdges?.length) {
    const simStatements = similarityEdges
      .map((edge) => {
        const sourceFn = functionById.get(edge.source);
        const targetFn = functionById.get(edge.target);
        if (!sourceFn || !targetFn) {
          return null;
        }
        const sourceFnId = functionIdLookup.get(sourceFn.id);
        const targetFnId = functionIdLookup.get(targetFn.id);
        if (!sourceFnId || !targetFnId) {
          return null;
        }
        const [aId, bId] =
          sourceFnId < targetFnId ? [sourceFnId, targetFnId] : [targetFnId, sourceFnId];
        return {
          sql: `INSERT INTO sim_edges (a_fn_id, b_fn_id, sim, method)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(a_fn_id, b_fn_id) DO UPDATE SET
                  sim=excluded.sim,
                  method=excluded.method`,
          params: [aId, bId, edge.similarity ?? 0, edge.method || 'topk-avg']
        };
      })
      .filter(Boolean);
    if (simStatements.length) {
      await client.batch(simStatements);
    }
  }

  await client.setKv(KV_KEYS.FINGERPRINT, fingerprint);
  await client.setKv(KV_KEYS.METADATA, {
    backend: metadata.backend ?? null,
    modelId: metadata.modelId ?? null,
    dimension: metadata.dimension ?? null,
    quantized: metadata.quantized ?? false,
    chunkCount: chunks.length,
    embeddingCount: embeddings.length,
    edgeCount: similarityEdges?.length ?? 0,
    updatedAt: new Date().toISOString()
  });

  return {
    fileCount: fileEntries.size,
    functionCount: functions.length,
    chunkCount: chunks.length,
    embeddingCount: embeddings.length,
    edgeCount: similarityEdges?.length ?? 0
  };
}

export async function tryLoadEmbeddingRun(
  { functions = [], chunks = [], fingerprint = '' },
  options = {}
) {
  if (!functions.length || !chunks.length) {
    return null;
  }
  const client = getClient(options);
  await client.ensureInitialized();

  const metadata = await client.getKv(KV_KEYS.METADATA);
  if (!metadata) {
    return null;
  }
  const storedFingerprint = await client.getKv(KV_KEYS.FINGERPRINT);
  if (!storedFingerprint || storedFingerprint !== fingerprint) {
    return null;
  }

  const filePaths = Array.from(new Set(functions.map((fn) => fn.filePath)));
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const fileIdMap = await fetchFileIds(client, filePaths, opts.fileChunkSize);
  const fileIds = Array.from(fileIdMap.values());
  if (!fileIds.length) {
    return null;
  }

  const { rows = [] } = await client.query(
    `SELECT
       files.path AS file_path,
       functions.fn_id,
       functions.name,
       functions.start AS fn_start,
       functions."end" AS fn_end,
       chunks.chunk_id,
       chunks.start AS chunk_start,
       chunks."end" AS chunk_end,
       chunks.tok_count,
       embeddings.vec,
       embeddings.dim,
       embeddings.backend,
       embeddings.model
     FROM embeddings
     JOIN chunks ON chunks.chunk_id = embeddings.chunk_id
     JOIN functions ON functions.fn_id = chunks.fn_id
     JOIN files ON files.file_id = functions.file_id
     WHERE files.path IN (${buildPlaceholders(filePaths.length)})`,
    filePaths
  );

  if (!rows.length) {
    return null;
  }

  const functionBySignature = new Map();
  functions.forEach((fn) => {
    const signature = `${fn.filePath}:${fn.start}:${fn.end}`;
    functionBySignature.set(signature, fn);
  });

  const chunkBySignature = new Map();
  const chunkById = new Map();
  chunks.forEach((chunk) => {
    const functionIdentifier = chunk.functionId ?? chunk.function?.id;
    if (!functionIdentifier) {
      return;
    }
    const signature = `${functionIdentifier}:${chunk.start}:${chunk.end}`;
    chunkBySignature.set(signature, chunk);
    chunkById.set(chunk.id, chunk);
  });

  const chunkVectorMap = new Map();
  rows.forEach((row) => {
    const functionSignature = `${row.file_path}:${row.fn_start}:${row.fn_end}`;
    const fn = functionBySignature.get(functionSignature);
    if (!fn) {
      return;
    }
    const chunkSignature = `${fn.id}:${row.chunk_start}:${row.chunk_end}`;
    const chunk = chunkBySignature.get(chunkSignature);
    if (!chunk) {
      return;
    }
    const vectorData =
      row.vec instanceof Uint8Array
        ? row.vec
        : row.vec?.data instanceof Uint8Array
          ? row.vec.data
          : typeof row.vec === 'string'
            ? Uint8Array.from(atob(row.vec), (c) => c.charCodeAt(0))
            : new Uint8Array(row.vec);
    const aligned = vectorData.buffer.slice(
      vectorData.byteOffset,
      vectorData.byteOffset + vectorData.byteLength
    );
    chunkVectorMap.set(chunk.id, new Float32Array(aligned));
  });

  const loadedEmbeddings = [];
  let missingChunks = 0;
  chunks.forEach((chunk) => {
    const vector = chunkVectorMap.get(chunk.id);
    if (!vector) {
      missingChunks += 1;
      return;
    }
    loadedEmbeddings.push({
      chunk,
      vector
    });
  });

  if (!loadedEmbeddings.length || missingChunks > 0) {
    return null;
  }

  const { rows: simRows = [] } = await client.query(
    `SELECT
       s.sim,
       s.method,
       fa.start AS a_start,
       fa."end" AS a_end,
       fb.start AS b_start,
       fb."end" AS b_end,
       filesA.path AS a_path,
       filesB.path AS b_path
     FROM sim_edges s
     JOIN functions fa ON fa.fn_id = s.a_fn_id
     JOIN files filesA ON filesA.file_id = fa.file_id
     JOIN functions fb ON fb.fn_id = s.b_fn_id
     JOIN files filesB ON filesB.file_id = fb.file_id
     WHERE filesA.path IN (${buildPlaceholders(filePaths.length)})
       AND filesB.path IN (${buildPlaceholders(filePaths.length)})`,
    [...filePaths, ...filePaths]
  );

  const similarityEdges = simRows.map((row) => {
    const sourceFn = functionBySignature.get(`${row.a_path}:${row.a_start}:${row.a_end}`);
    const targetFn = functionBySignature.get(`${row.b_path}:${row.b_start}:${row.b_end}`);
    if (!sourceFn || !targetFn) {
      return null;
    }
    return {
      source: sourceFn.id,
      target: targetFn.id,
      similarity: row.sim,
      method: row.method || 'topk-avg'
    };
  }).filter(Boolean);

  return {
    metadata,
    embeddings: loadedEmbeddings,
    similarityEdges
  };
}

export async function computeFunctionFingerprint(functions = []) {
  if (!functions.length) {
    return 'fn:0';
  }
  const encoder = new TextEncoder();
  const sorted = functions
    .map((fn) => `${fn.id}:${fn.source?.length ?? 0}:${fn.lang || ''}`)
    .sort()
    .join('|');

  if (globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(sorted));
    const bytes = new Uint8Array(hashBuffer);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    hash = (hash << 5) - hash + sorted.charCodeAt(i);
    hash |= 0;
  }
  return `fn:${Math.abs(hash)}`;
}

export function __setStorageClient(client) {
  singletonClient = client;
}


