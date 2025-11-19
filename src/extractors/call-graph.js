/**
 * Call Graph Construction (Static, Best-Effort)
 * Following PLAN.md section 3.3 specifications
 *
 * Builds directed call edges from extracted functions and call expressions
 * Resolves callees using symbol tables and lexical scope
 */

const STATUS_PRIORITY = {
  resolved: 1,
  ambiguous: 2,
  unresolved: 3
};

/**
 * Build call graph from extracted functions and calls
 * @param {Array} functions - Array of extracted function objects
 * @param {Array} allCalls - Array of all call expressions from all files
 * @param {SymbolTableManager} symbolTableManager - Symbol table manager for name resolution
 * @returns {Object} - Call graph with nodes and edges
 */
export function buildCallGraph(functions, allCalls, symbolTableManager) {
  const nodes = [...functions];

  const functionByName = new Map(); // name → [functions] (for resolution)
  const functionByFile = new Map(); // filePath → [functions]

  functions.forEach(func => {
    if (!functionByName.has(func.name)) {
      functionByName.set(func.name, []);
    }
    functionByName.get(func.name).push(func);

    if (!functionByFile.has(func.filePath)) {
      functionByFile.set(func.filePath, []);
    }
    functionByFile.get(func.filePath).push(func);
  });

  const virtualNodeMap = new Map();
  const edgeMap = new Map(); // Map<edgeKey, edgeData>

  for (const call of allCalls) {
    const callerFile = call.filePath;
    const callerFunctions = functionByFile.get(callerFile) || [];

    const caller = findContainingFunction(call, callerFunctions);
    if (!caller) {
      continue;
    }

    const resolution = resolveCallee(call, callerFile, functionByName, symbolTableManager);

    if (resolution.status === 'member-expression') {
      continue;
    }

    if (resolution.status === 'unresolved' || resolution.matches.length === 0) {
      const virtualNode = getOrCreateVirtualNode(
        resolution.calleeName,
        callerFile,
        virtualNodeMap,
        nodes
      );
      const edge = upsertEdge(edgeMap, caller.id, virtualNode.id, call);
      edge.resolution = mergeResolution(
        edge.resolution,
        buildResolutionMetadata({ ...resolution, status: 'unresolved' })
      );
      continue;
    }

    resolution.matches.forEach(match => {
      const target = match.func;
      const edge = upsertEdge(edgeMap, caller.id, target.id, call);
      edge.resolution = mergeResolution(
        edge.resolution,
        buildResolutionMetadata(resolution, match)
      );
    });
  }

  // Format edges according to payload schema:
  // - callSites and resolution are top-level (not nested in metadata)
  // - id is recommended (format: "call::source→target")
  // - language is recommended (copy from parser)
  // - metadata is for parser extras only
  const edges = Array.from(edgeMap.values()).map(edge => {
    const edgeId = `call::${edge.source}→${edge.target}`;
    const formattedEdge = {
      id: edgeId,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      isDynamic: edge.isDynamic || false,
      language: edge.language || undefined,
      callSites: edge.callSites.slice(0, 100), // Limit to reasonable size
      resolution: edge.resolution || undefined
    };

    // Only include metadata if we have parser extras to store
    // (currently none, but leaving structure for future use)
    const metadata = {};
    if (Object.keys(metadata).length > 0) {
      formattedEdge.metadata = metadata;
    }

    return formattedEdge;
  });

  const stats = computeStats(nodes, edges);

  return {
    nodes,
    edges,
    stats
  };
}

/**
 * Find the function that contains a call expression
 * @param {Object} call - Call expression object
 * @param {Array} functions - Functions in the same file
 * @returns {Object|null} - Containing function or null
 */
function findContainingFunction(call, functions) {
  for (const func of functions) {
    if (call.start >= func.start && call.end <= func.end) {
      return func;
    }
  }
  return null;
}

/**
 * Resolve callee from call expression
 * Following PLAN.md section 3.3 and 10.2 specifications
 * @param {Object} call - Call expression object
 * @param {string} callerFile - File path of the caller
 * @param {Map} functionByName - Map of name → [functions]
 * @param {SymbolTableManager} symbolTableManager - Symbol table manager
 * @returns {Object} - Resolution summary ({status, matches, ...})
 */
function resolveCallee(call, callerFile, functionByName, symbolTableManager) {
  const calleeName = call.callee;
  const summary = {
    status: 'unresolved',
    matches: [],
    callerFile,
    calleeName,
    importInfo: null,
    reason: null
  };

  if (!calleeName) {
    summary.reason = 'Anonymous call cannot be resolved';
    return summary;
  }

  if (call.isMemberCall) {
    summary.status = 'member-expression';
    summary.reason = 'Member expression treated as dynamic';
    return summary;
  }

  const symbolTable = symbolTableManager.getTable(callerFile);
  const importInfoRaw = symbolTable ? symbolTable.getImportInfo(calleeName) : null;
  const importInfo = importInfoRaw
    ? {
        from: importInfoRaw.from || '',
        originalName: importInfoRaw.originalName || calleeName,
        isDefault: !!importInfoRaw.isDefault,
        moduleId: importInfoRaw.moduleId || null,
        resolvedFilePath: importInfoRaw.resolvedFilePath
          ? normalizePath(importInfoRaw.resolvedFilePath)
          : null
      }
    : null;

  summary.importInfo = importInfo;

  const candidates = functionByName.get(calleeName) || [];
  const resolvedFqn = symbolTableManager.resolve(callerFile, calleeName);
  const matches = new Map();
  const normalizedCaller = normalizePath(callerFile);

  const addMatch = (fn, matchType, confidence, details = {}) => {
    if (!fn || matches.has(fn.id)) {
      return;
    }
    matches.set(fn.id, {
      func: fn,
      matchType,
      confidence,
      details
    });
  };

  // Prefer local matches first
  candidates
    .filter(fn => normalizePath(fn.filePath) === normalizedCaller)
    .forEach(fn => addMatch(fn, 'local', 'high', { filePath: fn.filePath }));

  // Import-based matches
  if (importInfo) {
    const expectedFq = importInfo.moduleId
      ? `${importInfo.moduleId}.${importInfo.originalName}`
      : null;

    candidates
      .filter(fn => {
        const fnPath = normalizePath(fn.filePath || '');
        const moduleMatch = importInfo.moduleId && fn.moduleId === importInfo.moduleId;
        const fileMatch = importInfo.resolvedFilePath && fnPath === importInfo.resolvedFilePath;
        const fqMatch = expectedFq && fn.fqName === expectedFq;
        return moduleMatch || fileMatch || fqMatch;
      })
      .forEach(fn => addMatch(fn, 'import', 'high', { moduleMatched: true }));
  }

  // Symbol table resolution (FQN)
  if (resolvedFqn) {
    const resolvedName = resolvedFqn.split('.').pop();
    candidates
      .filter(fn => {
        const matchesFqn = fn.fqName === resolvedFqn;
        const matchesName = fn.name === resolvedName;
        return matchesFqn || matchesName;
      })
      .forEach(fn => addMatch(fn, 'symbol-table', 'high', { resolvedFqn }));
  }

  // Fallback: other functions with the same name
  candidates
    .filter(fn => !matches.has(fn.id))
    .forEach(fn => {
      const confidence = fn.moduleId ? 'medium' : 'low';
      addMatch(fn, 'external', confidence, {});
    });

  const orderedMatches = Array.from(matches.values()).sort((a, b) => {
    const rank = { local: 0, 'symbol-table': 1, import: 1, external: 2 };
    return (rank[a.matchType] || 3) - (rank[b.matchType] || 3);
  });

  summary.matches = orderedMatches.slice(0, 12);

  if (summary.matches.length === 0) {
    summary.status = 'unresolved';
    summary.reason = importInfo
      ? 'Import could not be resolved to a project function'
      : 'No matching function found in project';
    return summary;
  }

  if (summary.matches.length === 1) {
    summary.status = 'resolved';
    summary.reason =
      summary.matches[0].matchType === 'local'
        ? 'Resolved to local definition'
        : 'Resolved via import';
  } else {
    summary.status = 'ambiguous';
    summary.reason = 'Multiple candidate functions match this call';
  }

  return summary;
}

/**
 * Create a virtual function node for unresolved calls
 * @param {string} name - Function name
 * @param {string} filePath - File where it's called
 * @returns {Object} - Virtual function object
 */
export function createVirtualFunction(name, filePath) {
  const safeName = name || '<unknown>';
  const normalizedCaller = normalizePath(filePath || '');
  return {
    id: `virtual:${safeName}:${normalizedCaller}`,
    name: safeName,
    fqName: `[unresolved] ${safeName}`,
    filePath: filePath,
    lang: 'unknown',
    moduleId: null,
    isVirtual: true,
    start: 0,
    end: 0,
    startLine: 0,
    endLine: 0,
    loc: 0,
    doc: '',
    source: ''
  };
}

function getOrCreateVirtualNode(name, callerFile, virtualNodeMap, nodes) {
  const key = `${normalizePath(callerFile)}::${name || '<unknown>'}`;
  if (!virtualNodeMap.has(key)) {
    const virtualNode = createVirtualFunction(name, callerFile);
    nodes.push(virtualNode);
    virtualNodeMap.set(key, virtualNode);
  }
  return virtualNodeMap.get(key);
}

function upsertEdge(edgeMap, sourceId, targetId, call) {
  const edgeKey = `${sourceId}->${targetId}`;
  if (!edgeMap.has(edgeKey)) {
    edgeMap.set(edgeKey, {
      source: sourceId,
      target: targetId,
      weight: 0,
      isDynamic: false,
      language: call.language || null,
      callSites: [],
      resolution: null
    });
  }

  const edge = edgeMap.get(edgeKey);
  edge.weight += 1;
  edge.isDynamic = edge.isDynamic || !!call.isDynamic;
  // Store language from first call (should be consistent for same edge)
  if (!edge.language && call.language) {
    edge.language = call.language;
  }
  // Format call sites according to payload schema: {filePath, line, column, context?}
  edge.callSites.push({
    filePath: call.filePath,
    line: call.startLine,
    column: call.startColumn || 0,
    context: call.context || null // context is optional, will be extracted if available
  });

  return edge;
}

function buildResolutionMetadata(resolution, selectedMatch = null) {
  // Convert matches to candidates format per payload schema: { id, confidence }
  // For resolved edges: single candidate with the selected match (high confidence)
  // For ambiguous edges: multiple matches as candidates
  let candidates = [];
  
  if (selectedMatch) {
    // For resolved edges: single candidate with the selected match
    candidates = [{
      id: selectedMatch.func.id,
      confidence: selectedMatch.confidence || 0.99
    }];
  } else if (resolution.matches && resolution.matches.length > 0) {
    // For ambiguous/unresolved: all matches as candidates
    candidates = resolution.matches.map(match => ({
      id: match.func.id,
      confidence: match.confidence || 0.5
    })).slice(0, 12);
  }

  // Build resolution object per payload schema
  return {
    status: resolution.status,
    reason: resolution.reason || null,
    candidates: candidates.length > 0 ? candidates : undefined,
    importInfo: resolution.importInfo || undefined
  };
}

function mergeResolution(existing, incoming) {
  if (!incoming) {
    return existing || null;
  }

  if (!existing) {
    return { ...incoming };
  }

  // Merge by worst status (unresolved > ambiguous > resolved)
  if (STATUS_PRIORITY[incoming.status] > STATUS_PRIORITY[existing.status]) {
    existing.status = incoming.status;
    existing.reason = incoming.reason;
  }

  // Merge candidates (keep unique by id, prefer higher confidence)
  const candidateMap = new Map();
  (existing.candidates || []).forEach(c => candidateMap.set(c.id, c));
  (incoming.candidates || []).forEach(c => {
    const existingCandidate = candidateMap.get(c.id);
    if (!existingCandidate || (c.confidence || 0) > (existingCandidate.confidence || 0)) {
      candidateMap.set(c.id, c);
    }
  });
  const mergedCandidates = Array.from(candidateMap.values());
  existing.candidates = mergedCandidates.length > 0 ? mergedCandidates : undefined;

  // Merge importInfo (prefer non-null)
  existing.importInfo = existing.importInfo || incoming.importInfo || undefined;

  return existing;
}

function mergeMatches(current = [], incoming = []) {
  const map = new Map();
  [...current, ...incoming].forEach(match => {
    if (!match) {
      return;
    }
    const key = match.id || `${match.filePath}:${match.name}`;
    if (!map.has(key)) {
      map.set(key, match);
    }
  });
  return Array.from(map.values()).slice(0, 12);
}

function computeStats(nodes, edges) {
  let staticEdges = 0;
  let dynamicEdges = 0;
  let resolvedEdges = 0;
  let ambiguousEdges = 0;
  let unresolvedEdges = 0;

  edges.forEach(edge => {
    if (edge.isDynamic) {
      dynamicEdges += 1;
    } else {
      staticEdges += 1;
    }

    const status = edge.metadata?.resolution?.status;
    if (status === 'resolved') {
      resolvedEdges += 1;
    } else if (status === 'ambiguous') {
      ambiguousEdges += 1;
    } else if (status === 'unresolved') {
      unresolvedEdges += 1;
    }
  });

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    staticEdges,
    dynamicEdges,
    resolvedEdges,
    ambiguousEdges,
    unresolvedEdges
  };
}

function normalizePath(path = '') {
  return path.replace(/\\/g, '/');
}
