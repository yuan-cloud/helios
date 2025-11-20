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
 * Enhanced with improved lexical scope, TypeScript patterns, and better module resolution
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
    // Enhanced: Attempt to resolve simple member calls like `obj.method()` where obj is an import
    const memberResolution = resolveMemberCall(call, callerFile, symbolTableManager);
    if (memberResolution) {
      summary.status = memberResolution.status;
      summary.matches = memberResolution.matches || [];
      summary.reason = memberResolution.reason || 'Member expression resolution';
      return summary;
    }
    
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

  // Enhanced: Lexical scope resolution - prefer functions defined before the call
  // This helps with closures and nested scopes
  const callerFunctions = getFunctionsInFile(callerFile, functionByName);
  const lexicalMatches = findLexicalMatches(call, calleeName, callerFunctions);
  lexicalMatches.forEach(match => {
    addMatch(match.func, 'lexical', match.confidence || 'high', { 
      ...match.details,
      scopeDepth: match.scopeDepth || 0
    });
  });

  // Prefer local matches (same file, any scope)
  candidates
    .filter(fn => normalizePath(fn.filePath) === normalizedCaller)
    .forEach(fn => {
      // Only add if not already added by lexical resolution
      if (!matches.has(fn.id)) {
        addMatch(fn, 'local', 'high', { filePath: fn.filePath });
      }
    });

  // Enhanced: Import-based matches with better module resolution
  if (importInfo) {
    const expectedFq = importInfo.moduleId
      ? `${importInfo.moduleId}.${importInfo.originalName}`
      : null;

    // Try exact module match first
    if (importInfo.moduleId) {
      candidates
        .filter(fn => {
          const fnPath = normalizePath(fn.filePath || '');
          const moduleMatch = fn.moduleId === importInfo.moduleId && fn.name === importInfo.originalName;
          const fileMatch = importInfo.resolvedFilePath && fnPath === importInfo.resolvedFilePath && fn.name === importInfo.originalName;
          return moduleMatch || fileMatch;
        })
        .forEach(fn => addMatch(fn, 'import-exact', 'high', { 
          moduleMatched: true,
          moduleId: importInfo.moduleId,
          originalName: importInfo.originalName
        }));
    }

    // Fallback: partial matches
    candidates
      .filter(fn => {
        if (matches.has(fn.id)) return false; // Skip already matched
        
        const fnPath = normalizePath(fn.filePath || '');
        const moduleMatch = importInfo.moduleId && fn.moduleId === importInfo.moduleId;
        const fileMatch = importInfo.resolvedFilePath && fnPath === importInfo.resolvedFilePath;
        const fqMatch = expectedFq && fn.fqName === expectedFq;
        const nameMatch = fn.name === importInfo.originalName;
        
        // More lenient matching: module or file or FQ match
        return (moduleMatch || fileMatch || fqMatch) && nameMatch;
      })
      .forEach(fn => addMatch(fn, 'import', 'medium', { 
        moduleMatched: !!importInfo.moduleId,
        partialMatch: true
      }));

    // Enhanced: Handle default exports more intelligently
    if (importInfo.isDefault) {
      // Default exports can be imported with any name, so we look for exported functions
      // in the target module that are marked as default exports
      const targetModuleFiles = importInfo.resolvedFilePath 
        ? [importInfo.resolvedFilePath]
        : symbolTableManager.getModuleFilePaths(importInfo.moduleId || '');
      
      for (const targetFile of targetModuleFiles) {
        const targetTable = symbolTableManager.getTable(targetFile);
        if (targetTable) {
          // Check for default export - default exports can be imported with any local name
          const exports = targetTable.getExports();
          const defaultExport = exports.find(exp => exp.isDefault);
          
          if (defaultExport) {
            // Match functions in the target file that match the default export name
            candidates
              .filter(fn => normalizePath(fn.filePath) === normalizePath(targetFile))
              .filter(fn => fn.name === defaultExport.name || fn.name === importInfo.originalName)
              .forEach(fn => {
                addMatch(fn, 'import-default', 'high', { 
                  isDefaultExport: true,
                  moduleId: importInfo.moduleId,
                  exportName: defaultExport.name,
                  importedAs: calleeName
                });
              });
          } else {
            // No default export found, but still try to match by original name
            // (fallback for cases where export info might be incomplete)
            candidates
              .filter(fn => normalizePath(fn.filePath) === normalizePath(targetFile))
              .filter(fn => fn.name === importInfo.originalName)
              .forEach(fn => {
                addMatch(fn, 'import-default', 'medium', { 
                  isDefaultExport: false,
                  moduleId: importInfo.moduleId,
                  originalName: importInfo.originalName
                });
              });
          }
        }
      }
    }
  }

  // Enhanced: Symbol table resolution with re-export tracking
  if (resolvedFqn) {
    const resolvedName = resolvedFqn.split('.').pop();
    
    // Exact FQN match (highest confidence)
    candidates
      .filter(fn => fn.fqName === resolvedFqn)
      .forEach(fn => addMatch(fn, 'symbol-table-exact', 'high', { resolvedFqn }));
    
    // Name match with module context
    candidates
      .filter(fn => {
        if (matches.has(fn.id)) return false;
        return fn.name === resolvedName && fn.moduleId && resolvedFqn.startsWith(fn.moduleId + '.');
      })
      .forEach(fn => addMatch(fn, 'symbol-table-module', 'medium', { 
        resolvedFqn,
        moduleId: fn.moduleId
      }));
    
    // Fallback: just name match
    candidates
      .filter(fn => {
        if (matches.has(fn.id)) return false;
        return fn.name === resolvedName;
      })
      .forEach(fn => addMatch(fn, 'symbol-table', 'medium', { resolvedFqn }));
  }

  // Enhanced: Relative path resolution for cross-file references
  // If no import info but we're in the same directory/module, prefer nearby files
  if (!importInfo) {
    const callerDir = getDirectory(callerFile);
    const sameModuleFiles = candidates
      .filter(fn => {
        const fnDir = getDirectory(fn.filePath);
        return fnDir === callerDir || isRelativePath(fn.filePath, callerFile);
      });
    
    sameModuleFiles
      .filter(fn => !matches.has(fn.id))
      .forEach(fn => {
        const pathSimilarity = computePathSimilarity(fn.filePath, callerFile);
        const confidence = pathSimilarity > 0.8 ? 'medium' : 'low';
        addMatch(fn, 'same-module', confidence, { 
          pathSimilarity,
          directory: callerDir
        });
      });
  }

  // Fallback: other functions with the same name, ordered by module organization
  candidates
    .filter(fn => !matches.has(fn.id))
    .forEach(fn => {
      let confidence = 'low';
      // Boost confidence if function has module organization
      if (fn.moduleId) {
        confidence = 'medium';
      }
      // Check if function name suggests it's a common utility
      if (isCommonUtilityName(fn.name)) {
        confidence = 'low'; // Utilities are often ambiguous
      }
      addMatch(fn, 'external', confidence, {});
    });

  // Enhanced: Better match ordering with confidence scoring
  const orderedMatches = Array.from(matches.values()).sort((a, b) => {
    // First, sort by match type priority
    const typeRank = { 
      'lexical': 0,           // Highest: lexical scope
      'local': 0,             // Same file
      'symbol-table-exact': 1, // Exact FQN match
      'import-exact': 1,      // Exact import match
      'import-default': 1,    // Default export match
      'symbol-table-module': 2, // Module context match
      'symbol-table': 2,      // FQN match
      'import': 2,            // Import match
      'same-module': 3,       // Same module/directory
      'external': 4           // External/unknown
    };
    
    const rankA = typeRank[a.matchType] ?? 5;
    const rankB = typeRank[b.matchType] ?? 5;
    
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    
    // Within same type, sort by confidence
    const confRank = { 'high': 0, 'medium': 1, 'low': 2 };
    const confA = confRank[a.confidence] ?? 2;
    const confB = confRank[b.confidence] ?? 2;
    
    if (confA !== confB) {
      return confA - confB;
    }
    
    // Finally, prefer matches with better details (scope depth, path similarity)
    const scoreA = (a.details?.scopeDepth || 0) + (a.details?.pathSimilarity || 0);
    const scoreB = (b.details?.scopeDepth || 0) + (b.details?.pathSimilarity || 0);
    
    return scoreA - scoreB;
  });

  summary.matches = orderedMatches.slice(0, 12);

  if (summary.matches.length === 0) {
    summary.status = 'unresolved';
    summary.reason = importInfo
      ? `Import '${calleeName}' from '${importInfo.from}' could not be resolved to a project function`
      : `No matching function found for '${calleeName}' in project`;
    return summary;
  }

  // Enhanced: Better status determination
  const topMatch = summary.matches[0];
  const topConfidence = topMatch.confidence;
  const hasHighConfidenceUnique = summary.matches.length === 1 && topConfidence === 'high';
  const hasMultipleHighConfidence = summary.matches.filter(m => m.confidence === 'high').length > 1;

  if (hasHighConfidenceUnique) {
    summary.status = 'resolved';
    summary.reason = getResolvedReason(topMatch.matchType, topMatch.details);
  } else if (hasMultipleHighConfidence) {
    summary.status = 'ambiguous';
    summary.reason = `Multiple high-confidence candidates match this call (${summary.matches.filter(m => m.confidence === 'high').length} candidates)`;
  } else if (summary.matches.length === 1) {
    summary.status = 'resolved';
    summary.reason = getResolvedReason(topMatch.matchType, topMatch.details);
  } else {
    summary.status = 'ambiguous';
    summary.reason = `Multiple candidate functions match this call (${summary.matches.length} candidates)`;
  }

  return summary;
}

/**
 * Enhanced: Resolve simple member calls like obj.method() where obj is an import
 * @param {Object} call - Call expression object
 * @param {string} callerFile - File path of the caller
 * @param {SymbolTableManager} symbolTableManager - Symbol table manager
 * @returns {Object|null} - Resolution summary or null if cannot resolve
 */
function resolveMemberCall(call, callerFile, symbolTableManager) {
  if (!call.callee || !call.callee.includes('.')) {
    return null;
  }
  
  // Extract object and method from member expression
  const parts = call.callee.split('.');
  if (parts.length !== 2) {
    return null; // Only handle simple obj.method() cases
  }
  
  const [objectName, methodName] = parts;
  const symbolTable = symbolTableManager.getTable(callerFile);
  
  // Check if object is an import (e.g., `utils.method()` where `utils` is imported)
  const importInfo = symbolTable ? symbolTable.getImportInfo(objectName) : null;
  if (!importInfo) {
    return null; // Not an import, can't resolve statically
  }
  
  // Try to find the method in the imported module
  const moduleId = importInfo.moduleId;
  if (!moduleId) {
    return null;
  }
  
  // This is a simplified resolution - in reality, we'd need to check if
  // the imported object has a method with that name. For now, we mark it
  // as potentially resolvable but ambiguous.
  return {
    status: 'ambiguous',
    matches: [],
    reason: `Member call '${call.callee}' - object '${objectName}' is imported, but method resolution requires deeper analysis`
  };
}

/**
 * Enhanced: Get all functions in a file for lexical scope analysis
 * @param {string} filePath - File path
 * @param {Map} functionByName - Map of name → [functions]
 * @returns {Array} - Array of functions in the file
 */
function getFunctionsInFile(filePath, functionByName) {
  const allFunctions = [];
  const normalizedPath = normalizePath(filePath);
  
  for (const functions of functionByName.values()) {
    for (const func of functions) {
      if (normalizePath(func.filePath) === normalizedPath) {
        allFunctions.push(func);
      }
    }
  }
  
  return allFunctions.sort((a, b) => a.start - b.start);
}

/**
 * Enhanced: Find lexical matches using scope analysis
 * Functions defined before the call in the same file are preferred
 * @param {Object} call - Call expression object
 * @param {string} calleeName - Name of the called function
 * @param {Array} functions - Functions in the same file
 * @returns {Array} - Array of lexical matches with scope depth
 */
function findLexicalMatches(call, calleeName, functions) {
  const matches = [];
  
  for (const func of functions) {
    if (func.name !== calleeName) {
      continue;
    }
    
    // Check if function is defined before the call
    if (func.end <= call.start) {
      // Function is defined before call - higher confidence
      // Calculate scope depth (how many nested scopes between call and definition)
      const scopeDepth = calculateScopeDepth(call.start, func.end);
      matches.push({
        func,
        confidence: scopeDepth === 0 ? 'high' : 'medium',
        details: { 
          definedBefore: true,
          scopeDepth
        }
      });
    } else if (func.start > call.end) {
      // Function is defined after call - lower confidence (hoisting in JS/TS)
      // Still valid for function declarations due to hoisting
      matches.push({
        func,
        confidence: 'medium',
        details: { 
          definedAfter: true,
          hoistingPossible: true
        }
      });
    }
  }
  
  return matches;
}

/**
 * Enhanced: Calculate scope depth between two positions
 * Simplified heuristic: count function boundaries between positions
 * @param {number} callPos - Position of the call
 * @param {number} defPos - Position of the definition
 * @returns {number} - Scope depth (0 = same scope, higher = more nested)
 */
function calculateScopeDepth(callPos, defPos) {
  // Simplified: assume functions define new scopes
  // In practice, we'd analyze the AST to count actual scope boundaries
  // For now, return 0 if definition comes before call (same or outer scope)
  // and estimate based on distance
  if (defPos <= callPos) {
    return 0; // Definition before call, same or outer scope
  }
  
  // Definition after call - estimate scope depth based on proximity
  // This is a heuristic - actual scope analysis would require AST traversal
  return 1; // Assume one scope level
}

/**
 * Enhanced: Get directory from file path
 * @param {string} filePath - File path
 * @returns {string} - Directory path
 */
function getDirectory(filePath) {
  const normalized = normalizePath(filePath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : '';
}

/**
 * Enhanced: Check if two paths are relatively close (same module)
 * @param {string} path1 - First path
 * @param {string} path2 - Second path
 * @returns {boolean} - True if paths are relatively close
 */
function isRelativePath(path1, path2) {
  const dir1 = getDirectory(path1);
  const dir2 = getDirectory(path2);
  
  // Check if one directory is a parent/child of the other
  return dir1 === dir2 || dir1.startsWith(dir2 + '/') || dir2.startsWith(dir1 + '/');
}

/**
 * Enhanced: Compute path similarity between two file paths
 * Returns a value between 0 and 1, where 1 means identical paths
 * @param {string} path1 - First path
 * @param {string} path2 - Second path
 * @returns {number} - Similarity score (0-1)
 */
function computePathSimilarity(path1, path2) {
  const norm1 = normalizePath(path1);
  const norm2 = normalizePath(path2);
  
  if (norm1 === norm2) {
    return 1.0;
  }
  
  const dir1 = getDirectory(norm1);
  const dir2 = getDirectory(norm2);
  
  if (dir1 === dir2) {
    return 0.9; // Same directory
  }
  
  // Count common path segments
  const segments1 = dir1.split('/').filter(s => s);
  const segments2 = dir2.split('/').filter(s => s);
  
  let commonSegments = 0;
  const minLength = Math.min(segments1.length, segments2.length);
  
  for (let i = 0; i < minLength; i++) {
    if (segments1[i] === segments2[i]) {
      commonSegments++;
    } else {
      break;
    }
  }
  
  if (commonSegments === 0) {
    return 0.0;
  }
  
  // Similarity based on common segments ratio
  const maxLength = Math.max(segments1.length, segments2.length);
  return commonSegments / maxLength;
}

/**
 * Enhanced: Check if function name suggests it's a common utility
 * These are often ambiguous across modules
 * @param {string} name - Function name
 * @returns {boolean} - True if name suggests common utility
 */
function isCommonUtilityName(name) {
  const commonUtils = ['get', 'set', 'create', 'delete', 'update', 'find', 'map', 'filter', 'reduce', 'forEach'];
  return commonUtils.some(util => name.toLowerCase().startsWith(util.toLowerCase()));
}

/**
 * Enhanced: Get human-readable reason for resolved status
 * @param {string} matchType - Type of match
 * @param {Object} details - Match details
 * @returns {string} - Human-readable reason
 */
function getResolvedReason(matchType, details) {
  const reasons = {
    'lexical': `Resolved to lexically scoped function${details?.scopeDepth > 0 ? ` (${details.scopeDepth} scope${details.scopeDepth > 1 ? 's' : ''} deep)` : ''}`,
    'local': 'Resolved to local function definition',
    'symbol-table-exact': `Resolved via exact symbol table match${details?.resolvedFqn ? ` (${details.resolvedFqn})` : ''}`,
    'import-exact': `Resolved via exact import match${details?.moduleId ? ` (module: ${details.moduleId})` : ''}`,
    'import-default': `Resolved via default export import${details?.moduleId ? ` (module: ${details.moduleId})` : ''}`,
    'symbol-table-module': `Resolved via module-scoped symbol table match${details?.moduleId ? ` (${details.moduleId})` : ''}`,
    'symbol-table': `Resolved via symbol table match${details?.resolvedFqn ? ` (${details.resolvedFqn})` : ''}`,
    'import': `Resolved via import${details?.moduleId ? ` (module: ${details.moduleId})` : ''}`,
    'same-module': `Resolved via same module context${details?.directory ? ` (${details.directory})` : ''}`,
    'external': 'Resolved to external function (low confidence)'
  };
  
  return reasons[matchType] || 'Resolved via heuristic matching';
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
  // Confidence must be numeric (0-1) per payload schema
  const convertConfidence = (conf) => {
    if (typeof conf === 'number') return conf;
    if (typeof conf === 'string') {
      // Convert string confidence to numeric: 'high' -> 0.9, 'medium' -> 0.6, 'low' -> 0.3
      const map = { 'high': 0.9, 'medium': 0.6, 'low': 0.3 };
      return map[conf] || 0.5;
    }
    return 0.5; // Default
  };
  
  let candidates = [];
  
  if (selectedMatch) {
    // For resolved edges: single candidate with the selected match
    candidates = [{
      id: selectedMatch.func.id,
      confidence: convertConfidence(selectedMatch.confidence) || 0.99
    }];
  } else if (resolution.matches && resolution.matches.length > 0) {
    // For ambiguous/unresolved: all matches as candidates
    candidates = resolution.matches.map(match => ({
      id: match.func.id,
      confidence: convertConfidence(match.confidence) || 0.5
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

    const status = edge.resolution?.status;
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
