/**
 * JavaScript/TypeScript function and call expression extractor
 * Following PLAN.md section 3.2 and 10.1 specifications
 */

import { parserManager } from '../parser/parser.js';
import { JAVASCRIPT_QUERIES, compileQuery } from '../parser/queries.js';

/**
 * Extract functions, exports, imports, and calls from JavaScript/TypeScript code
 * @param {string} source - Source code to parse
 * @param {string} filePath - File path for context
 * @param {Language} language - Tree-sitter Language object
 * @returns {Object} - Extracted data: { functions, exports, imports, calls }
 */
export async function extractJavaScript(source, filePath, language) {
  // Parse the source code
  const tree = await parserManager.parse(source, null, filePath);

  const languageId = parserManager.detectLanguage(filePath) || 'javascript';
  
  // Compile queries
  const functionQuery = compileQuery(language, JAVASCRIPT_QUERIES.functions);
  const exportQuery = compileQuery(language, JAVASCRIPT_QUERIES.exports);
  const importQuery = compileQuery(language, JAVASCRIPT_QUERIES.imports);
  const callQuery = compileQuery(language, JAVASCRIPT_QUERIES.calls);

  // Execute queries
  const functionMatches = functionQuery.matches(tree.rootNode);
  const exportMatches = exportQuery.matches(tree.rootNode);
  const importMatches = importQuery.matches(tree.rootNode);
  const callMatches = callQuery.matches(tree.rootNode);

  // Extract functions
  const functions = extractFunctions(functionMatches, source, filePath, languageId);
  
  // Extract exports
  const exports = extractExports(exportMatches, source);
  
  // Extract imports
  const imports = extractImports(importMatches, source);
  
  // Extract call expressions
  const calls = extractCalls(callMatches, source, filePath, languageId);

  // Clean up tree
  tree.delete();

  return {
    functions,
    exports,
    imports,
    calls,
    filePath
  };
}

/**
 * Extract function information from query matches
 * @param {Array} matches - Query matches
 * @param {string} source - Source code
 * @param {string} filePath - File path
 * @param {string} languageId - Language identifier
 * @returns {Array} - Array of function objects
 */
function extractFunctions(matches, source, filePath, languageId) {
  const functions = [];

  for (const match of matches) {
    const funcNode = match.captures.find(c => c.name === 'func');
    const nameNode = match.captures.find(c => c.name === 'name');
    const paramsNode = match.captures.find(c => c.name === 'params');
    const bodyNode = match.captures.find(c => c.name === 'body');

    if (!funcNode || !funcNode.node) continue;

    const func = {
      id: `${filePath}:${funcNode.node.startIndex}:${funcNode.node.endIndex}`,
      name: nameNode ? source.slice(nameNode.node.startIndex, nameNode.node.endIndex) : '<anonymous>',
      filePath,
      start: funcNode.node.startIndex,
      end: funcNode.node.endIndex,
      startLine: funcNode.node.startPosition.row + 1,
      endLine: funcNode.node.endPosition.row + 1,
      startColumn: funcNode.node.startPosition.column,
      endColumn: funcNode.node.endPosition.column,
      params: paramsNode ? source.slice(paramsNode.node.startIndex, paramsNode.node.endIndex) : '',
      body: bodyNode ? source.slice(bodyNode.node.startIndex, bodyNode.node.endIndex) : '',
      source: source.slice(funcNode.node.startIndex, funcNode.node.endIndex),
      lang: languageId,
      fqName: nameNode ? source.slice(nameNode.node.startIndex, nameNode.node.endIndex) : '<anonymous>'
    };

    functions.push(func);
  }

  return functions;
}

/**
 * Extract export information from query matches
 * @param {Array} matches - Query matches
 * @param {string} source - Source code
 * @returns {Array} - Array of export objects
 */
function extractExports(matches, source) {
  const exports = [];

  for (const match of matches) {
    const nameNode = match.captures.find(c => c.name === 'name');
    if (!nameNode) continue;

    const name = source.slice(nameNode.node.startIndex, nameNode.node.endIndex);
    exports.push({
      name,
      isDefault: false, // Could be enhanced to detect default exports
      start: nameNode.node.startIndex,
      end: nameNode.node.endIndex
    });
  }

  return exports;
}

/**
 * Extract import information from query matches
 * @param {Array} matches - Query matches
 * @param {string} source - Source code
 * @returns {Array} - Array of import objects
 */
function extractImports(matches, source) {
  const imports = [];

  for (const match of matches) {
    const sourceNode = match.captures.find(c => c.name === 'source');
    const defaultNode = match.captures.find(c => c.name === 'default_import');
    const nameNode = match.captures.find(c => c.name === 'name');
    const aliasNode = match.captures.find(c => c.name === 'alias');

    if (!sourceNode) continue;

    const from = source.slice(sourceNode.node.startIndex, sourceNode.node.endIndex)
      .replace(/['"]/g, ''); // Remove quotes

    if (defaultNode) {
      const name = source.slice(defaultNode.node.startIndex, defaultNode.node.endIndex);
      imports.push({
        name,
        from,
        isDefault: true,
        alias: null
      });
    } else if (nameNode) {
      const name = source.slice(nameNode.node.startIndex, nameNode.node.endIndex);
      const alias = aliasNode ? source.slice(aliasNode.node.startIndex, aliasNode.node.endIndex) : null;
      imports.push({
        name: alias || name,
        from,
        originalName: name,
        isDefault: false,
        alias
      });
    }
  }

  return imports;
}

/**
 * Extract call expressions from query matches
 * @param {Array} matches - Query matches
 * @param {string} source - Source code
 * @param {string} filePath - File path
 * @param {string} languageId - Language identifier
 * @returns {Array} - Array of call objects
 */
function extractCalls(matches, source, filePath, languageId) {
  const calls = [];

  for (const match of matches) {
    const callNode = match.captures.find(c => c.name === 'call');
    const calleeNode = match.captures.find(c => c.name === 'callee');
    const objectNode = match.captures.find(c => c.name === 'object');
    const methodNode = match.captures.find(c => c.name === 'method');

    if (!callNode || !callNode.node) continue;

    let callee = null;
    let isMemberCall = false;
    let isDynamic = false;

    if (calleeNode) {
      // Direct function call: identifier()
      callee = source.slice(calleeNode.node.startIndex, calleeNode.node.endIndex);
    } else if (objectNode && methodNode) {
      // Member call: object.method()
      const object = source.slice(objectNode.node.startIndex, objectNode.node.endIndex);
      const method = source.slice(methodNode.node.startIndex, methodNode.node.endIndex);
      callee = `${object}.${method}`;
      isMemberCall = true;
      
      // Heuristic: if object is a variable (not a literal), mark as potentially dynamic
      if (!object.match(/^['"]/)) {
        isDynamic = true;
      }
    }

    if (!callee) continue;

    calls.push({
      callee,
      filePath,
      start: callNode.node.startIndex,
      end: callNode.node.endIndex,
      startLine: callNode.node.startPosition.row + 1,
      endLine: callNode.node.endPosition.row + 1,
      isMemberCall,
      isDynamic,
      language: languageId
    });
  }

  return calls;
}

