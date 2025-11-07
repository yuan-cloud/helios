/**
 * Call Graph Construction (Static, Best-Effort)
 * Following PLAN.md section 3.3 specifications
 * 
 * Builds directed call edges from extracted functions and call expressions
 * Resolves callees using symbol tables and lexical scope
 */

/**
 * Build call graph from extracted functions and calls
 * @param {Array} functions - Array of extracted function objects
 * @param {Array} allCalls - Array of all call expressions from all files
 * @param {SymbolTableManager} symbolTableManager - Symbol table manager for name resolution
 * @returns {Object} - Call graph with nodes and edges
 */
export function buildCallGraph(functions, allCalls, symbolTableManager) {
  // Create function index: id → function
  const functionIndex = new Map();
  const functionByName = new Map(); // name → [functions] (for resolution)
  const functionByFile = new Map(); // filePath → [functions]

  functions.forEach(func => {
    functionIndex.set(func.id, func);
    
    // Index by name (for resolution)
    if (!functionByName.has(func.name)) {
      functionByName.set(func.name, []);
    }
    functionByName.get(func.name).push(func);
    
    // Index by file
    if (!functionByFile.has(func.filePath)) {
      functionByFile.set(func.filePath, []);
    }
    functionByFile.get(func.filePath).push(func);
  });

  // Build edges: Map<edgeKey, edgeData>
  // edgeKey = "sourceId->targetId"
  const edgeMap = new Map();

  // Process each call expression
  for (const call of allCalls) {
    const callerFile = call.filePath;
    const callerFunctions = functionByFile.get(callerFile) || [];
    
    // Find the function that contains this call (caller)
    const caller = findContainingFunction(call, callerFunctions);
    if (!caller) {
      // Call is not inside any function (top-level)
      continue;
    }

    // Resolve callee
    const callees = resolveCallee(call, callerFile, functionByName, symbolTableManager);
    
    // Create edges for each resolved callee
    for (const callee of callees) {
      const edgeKey = `${caller.id}->${callee.id}`;
      
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          source: caller.id,
          target: callee.id,
          weight: 0,
          isDynamic: call.isDynamic || false,
          callSites: []
        });
      }
      
      const edge = edgeMap.get(edgeKey);
      edge.weight++;
      edge.callSites.push({
        file: call.filePath,
        line: call.startLine,
        column: call.startColumn,
        isDynamic: call.isDynamic || false
      });
    }
  }

  // Convert edge map to array
  const edges = Array.from(edgeMap.values()).map(edge => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
    isDynamic: edge.isDynamic,
    metadata: {
      callSites: edge.callSites.length,
      firstCallSite: edge.callSites[0] || null
    }
  }));

  return {
    nodes: functions,
    edges: edges,
    stats: {
      totalNodes: functions.length,
      totalEdges: edges.length,
      staticEdges: edges.filter(e => !e.isDynamic).length,
      dynamicEdges: edges.filter(e => e.isDynamic).length
    }
  };
}

/**
 * Find the function that contains a call expression
 * @param {Object} call - Call expression object
 * @param {Array} functions - Functions in the same file
 * @returns {Object|null} - Containing function or null
 */
function findContainingFunction(call, functions) {
  // Find function where call.start is between function.start and function.end
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
 * @returns {Array} - Array of resolved function objects (may be empty or multiple)
 */
function resolveCallee(call, callerFile, functionByName, symbolTableManager) {
  const callees = [];
  const calleeName = call.callee;

  // Handle member expressions: object.method
  if (call.isMemberCall) {
    // For now, tag as dynamic (heuristic: if object is a variable, it's dynamic)
    // Could be enhanced to resolve object types
    return []; // Member calls are generally dynamic, skip for now
  }

  // Handle identifier calls: functionName()
  // Try to resolve via symbol table first
  const resolved = symbolTableManager.resolve(callerFile, calleeName);
  
  if (resolved) {
    // Resolved via symbol table (import or local)
    // Extract function name from resolved path (e.g., "module.function" → "function")
    const parts = resolved.split('.');
    const functionName = parts[parts.length - 1];
    
    // Find functions with this name
    const candidates = functionByName.get(functionName) || [];
    if (candidates.length > 0) {
      callees.push(...candidates);
    }
  } else {
    // Try direct name match (local function in same file or global)
    const candidates = functionByName.get(calleeName) || [];
    if (candidates.length > 0) {
      // Prefer functions in the same file
      const sameFile = candidates.filter(f => f.filePath === callerFile);
      if (sameFile.length > 0) {
        callees.push(...sameFile);
      } else {
        // Use all candidates (ambiguous, but create edges)
        callees.push(...candidates);
      }
    }
  }

  // If no resolution found, create a "virtual" node for the callee
  // This represents an unresolved call (external function, dynamic call, etc.)
  if (callees.length === 0) {
    // Return empty - we'll track these as unresolved calls
    // Could create virtual nodes later if needed
  }

  return callees;
}

/**
 * Create a virtual function node for unresolved calls
 * @param {string} name - Function name
 * @param {string} filePath - File where it's called
 * @returns {Object} - Virtual function object
 */
export function createVirtualFunction(name, filePath) {
  return {
    id: `virtual:${name}:${filePath}`,
    name: name,
    filePath: filePath,
    isVirtual: true,
    start: 0,
    end: 0,
    startLine: 0,
    endLine: 0
  };
}

