const demoSourceFiles = [
  { path: 'src/app.ts', language: 'typescript', moduleId: 'src/app', moduleAliases: ['app'] },
  { path: 'src/graph/metrics.ts', language: 'typescript', moduleId: 'src/graph/metrics', moduleAliases: ['metrics'] },
  { path: 'src/ui/panel.ts', language: 'typescript', moduleId: 'src/ui/panel', moduleAliases: ['panel'] },
  { path: 'src/storage/cache.ts', language: 'typescript', moduleId: 'src/storage/cache', moduleAliases: ['storage'] }
];

const demoFunctions = [
  {
    id: 'demo:app:main',
    name: 'main',
    fqName: 'app.main',
    filePath: 'src/app.ts',
    lang: 'typescript',
    moduleId: 'src/app',
    startLine: 12,
    endLine: 74,
    startColumn: 0,
    endColumn: 1,
    loc: 62,
    doc: 'Entrypoint that orchestrates parsing, analysis, and visualization bootstrapping.',
    source: 'export async function main() {\n  const project = await loadProject();\n  const graph = await computeGraph(project);\n  renderDashboard({ project, graph });\n}',
    metrics: { cyclomatic: 4 }
  },
  {
    id: 'demo:graph:computeMetrics',
    name: 'computeMetrics',
    fqName: 'analysis.computeMetrics',
    filePath: 'src/graph/metrics.ts',
    lang: 'typescript',
    moduleId: 'src/graph/metrics',
    startLine: 18,
    endLine: 98,
    startColumn: 0,
    endColumn: 1,
    loc: 80,
    doc: 'Runs Graphology centrality + community algorithms and normalizes results for viz.',
    source: 'export function computeMetrics(graph) {\n  const analysis = runNetworkAnalysis(graph);\n  return normalizeAnalysis(analysis);\n}',
    metrics: { cyclomatic: 6 }
  },
  {
    id: 'demo:ui:renderDashboard',
    name: 'renderDashboard',
    fqName: 'ui.renderDashboard',
    filePath: 'src/ui/panel.ts',
    lang: 'typescript',
    moduleId: 'src/ui/panel',
    startLine: 10,
    endLine: 56,
    startColumn: 0,
    endColumn: 1,
    loc: 46,
    doc: 'Builds the HUD for hover/selection and injects performance + summary panels.',
    source: 'export function renderDashboard(options) {\n  mountControls(options);\n  mountInspector(options);\n  monitorPerformance(options);\n}',
    metrics: { cyclomatic: 5 }
  },
  {
    id: 'demo:storage:saveSnapshot',
    name: 'saveSnapshot',
    fqName: 'storage.saveSnapshot',
    filePath: 'src/storage/cache.ts',
    lang: 'typescript',
    moduleId: 'src/storage/cache',
    startLine: 30,
    endLine: 92,
    startColumn: 0,
    endColumn: 1,
    loc: 62,
    doc: 'Persists analysis snapshot into OPFS via the storage worker.',
    source: 'export async function saveSnapshot(db, payload) {\n  await db.transaction(() => {\n    persistFunctions(payload.functions);\n    persistEdges(payload.edges);\n  });\n}',
    metrics: { cyclomatic: 4 }
  }
];

const demoCalls = [
  { filePath: 'src/app.ts', callee: 'computeMetrics', start: 420, end: 445, startLine: 34, startColumn: 8, isMemberCall: false },
  { filePath: 'src/app.ts', callee: 'renderDashboard', start: 470, end: 498, startLine: 39, startColumn: 6, isMemberCall: false },
  { filePath: 'src/graph/metrics.ts', callee: 'saveSnapshot', start: 880, end: 912, startLine: 72, startColumn: 4, isMemberCall: false },
  { filePath: 'src/ui/panel.ts', callee: 'saveSnapshot', start: 612, end: 642, startLine: 44, startColumn: 4, isMemberCall: false }
];

const analysisByNode = {
  'demo:app:main': {
    community: 0,
    coreNumber: 2,
    metrics: {
      centrality: { degree: 0.75, pageRank: 0.32, betweenness: 0.41 }
    }
  },
  'demo:graph:computeMetrics': {
    community: 1,
    coreNumber: 3,
    metrics: {
      centrality: { degree: 0.85, pageRank: 0.37, betweenness: 0.48 }
    }
  },
  'demo:ui:renderDashboard': {
    community: 1,
    coreNumber: 2,
    metrics: {
      centrality: { degree: 0.64, pageRank: 0.28, betweenness: 0.22 }
    }
  },
  'demo:storage:saveSnapshot': {
    community: 2,
    coreNumber: 2,
    metrics: {
      centrality: { degree: 0.5, pageRank: 0.21, betweenness: 0.27 }
    }
  }
};

const demoCallGraphNodes = demoFunctions.map(fn => {
  const analysis = analysisByNode[fn.id] || {};
  return {
    id: fn.id,
    name: fn.name,
    fqName: fn.fqName,
    filePath: fn.filePath,
    lang: fn.lang,
    moduleId: fn.moduleId,
    loc: fn.loc,
    metrics: {
      ...(analysis.metrics || {})
    },
    community: analysis.community ?? null,
    coreNumber: analysis.coreNumber ?? null
  };
});

const demoCallGraphEdges = [
  buildCallEdge('demo:app:main', 'demo:graph:computeMetrics', {
    callSites: [
      { file: 'src/app.ts', line: 34, column: 8 },
      { file: 'src/app.ts', line: 52, column: 8 }
    ],
    weight: 2
  }),
  buildCallEdge('demo:app:main', 'demo:ui:renderDashboard', {
    callSites: [
      { file: 'src/app.ts', line: 39, column: 6 }
    ],
    weight: 1
  }),
  buildCallEdge('demo:graph:computeMetrics', 'demo:storage:saveSnapshot', {
    callSites: [
      { file: 'src/graph/metrics.ts', line: 76, column: 6 }
    ],
    weight: 1
  }),
  buildCallEdge('demo:ui:renderDashboard', 'demo:storage:saveSnapshot', {
    callSites: [
      { file: 'src/ui/panel.ts', line: 44, column: 4 }
    ],
    weight: 1
  })
];

const demoCallGraphStats = {
  totalNodes: demoCallGraphNodes.length,
  totalEdges: demoCallGraphEdges.length,
  staticEdges: demoCallGraphEdges.length,
  dynamicEdges: 0,
  resolvedEdges: demoCallGraphEdges.length,
  ambiguousEdges: 0,
  unresolvedEdges: 0
};

const demoSimilarityEdges = [
  { source: 'demo:graph:computeMetrics', target: 'demo:ui:renderDashboard', similarity: 0.62, method: 'topk-avg', metadata: { method: 'topk-avg' } },
  { source: 'demo:graph:computeMetrics', target: 'demo:storage:saveSnapshot', similarity: 0.58, method: 'topk-avg', metadata: { method: 'topk-avg' } },
  { source: 'demo:ui:renderDashboard', target: 'demo:storage:saveSnapshot', similarity: 0.55, method: 'topk-avg', metadata: { method: 'topk-avg' } }
];

const demoEmbedding = {
  chunkCount: 12,
  metadata: {
    backend: 'wasm',
    modelId: 'all-MiniLM-L6-v2',
    dimension: 384
  },
  reuse: {
    reused: 12,
    embedded: 0
  },
  stats: {
    processedFunctions: demoFunctions.length,
    chunkCount: 12,
    averageTokens: 92
  },
  functionEmbeddings: [
    { functionId: 'demo:app:main', chunkCount: 4 },
    { functionId: 'demo:graph:computeMetrics', chunkCount: 4 },
    { functionId: 'demo:ui:renderDashboard', chunkCount: 2 },
    { functionId: 'demo:storage:saveSnapshot', chunkCount: 2 }
  ],
  chunks: [
    { functionId: 'demo:app:main', start: 0, end: 180 },
    { functionId: 'demo:graph:computeMetrics', start: 0, end: 210 },
    { functionId: 'demo:ui:renderDashboard', start: 0, end: 150 },
    { functionId: 'demo:storage:saveSnapshot', start: 0, end: 170 }
  ],
  functionsWithEmbeddings: demoFunctions.length,
  functionFingerprintMap: {
    'demo:app:main': 'fp-demo-app-main',
    'demo:graph:computeMetrics': 'fp-demo-graph-compute',
    'demo:ui:renderDashboard': 'fp-demo-ui-render',
    'demo:storage:saveSnapshot': 'fp-demo-storage-save'
  }
};

const baseDataset = {
  sourceFiles: demoSourceFiles,
  functions: demoFunctions,
  calls: demoCalls,
  callGraph: {
    nodes: demoCallGraphNodes,
    edges: demoCallGraphEdges,
    stats: demoCallGraphStats
  },
  similarityEdges: demoSimilarityEdges,
  embedding: demoEmbedding
};

function buildCallEdge(source, target, { callSites = [], weight = 1 }) {
  const firstCallSite = callSites[0] || null;
  const targetMeta = findFunctionMeta(target);
  return {
    source,
    target,
    weight,
    isDynamic: false,
    layer: 'call',
    metadata: {
      callSites: callSites.length,
      firstCallSite,
      callSiteSamples: callSites.slice(0, 10),
      resolution: {
        status: 'resolved',
        reason: 'Resolved to local definition',
        matchCount: 1,
        matches: [
          {
            id: target,
            name: targetMeta?.fqName || target,
            filePath: targetMeta?.filePath || inferFilePathFromId(target),
            moduleId: targetMeta?.moduleId || inferModuleIdFromId(target),
            matchType: 'local',
            confidence: 'high'
          }
        ],
        selectedMatch: {
          id: target,
          matchType: 'local',
          confidence: 'high'
        },
        calleeName: targetMeta?.name || inferNameFromId(target)
      }
    }
  };
}

function findFunctionMeta(id) {
  return demoFunctions.find(fn => fn.id === id) || null;
}

function inferFilePathFromId(id) {
  const meta = findFunctionMeta(id);
  if (meta?.filePath) {
    return meta.filePath;
  }
  const parts = id.split(':');
  return parts.length >= 3 ? parts[1].replace(/\./g, '/') + '.ts' : id;
}

function inferModuleIdFromId(id) {
  const meta = findFunctionMeta(id);
  if (meta?.moduleId) {
    return meta.moduleId;
  }
  const parts = id.split(':');
  return parts.length >= 3 ? parts[1] : null;
}

function inferNameFromId(id) {
  const meta = findFunctionMeta(id);
  if (meta?.name) {
    return meta.name;
  }
  const parts = id.split(':');
  return parts.length ? parts[parts.length - 1] : id;
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // structuredClone not supported for this payload – fall back
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function getDemoDataset() {
  return deepClone(baseDataset);
}

