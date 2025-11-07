/**
 * Python function and call expression extractor
 * Implements PLAN.md sections 3.2 and 10.1 for Python sources
 */

import { parserManager } from '../parser/parser.js';
import { PYTHON_QUERIES, compileQuery } from '../parser/queries.js';

const LANGUAGE_ID = 'python';

/**
 * Extract functions, imports, and calls from Python source text
 * @param {string} source - File contents
 * @param {string} filePath - Path to the file (used for ids and resolution)
 * @param {Language} language - Tree-sitter language instance for Python
 * @returns {{functions: Array, exports: Array, imports: Array, calls: Array, filePath: string}}
 */
export async function extractPython(source, filePath, language) {
  const tree = await parserManager.parse(source, LANGUAGE_ID, filePath);

  const functionQuery = compileQuery(language, PYTHON_QUERIES.functions);
  const importQuery = compileQuery(language, PYTHON_QUERIES.imports);
  const callQuery = compileQuery(language, PYTHON_QUERIES.calls);

  const functionMatches = functionQuery.matches(tree.rootNode);
  const importMatches = importQuery.matches(tree.rootNode);
  const callMatches = callQuery.matches(tree.rootNode);

  const functions = extractFunctions(functionMatches, source, filePath);
  const imports = extractImports(importMatches, source, filePath);
  const calls = extractCalls(callMatches, source, filePath);

  tree.delete();

  return {
    functions,
    exports: [],
    imports,
    calls,
    filePath
  };
}

function extractFunctions(matches, source, filePath) {
  const functions = [];

  for (const match of matches) {
    const funcNode = match.captures.find(c => c.name === 'func')?.node;
    const nameNode = match.captures.find(c => c.name === 'name')?.node;
    const paramsNode = match.captures.find(c => c.name === 'params')?.node;
    const bodyNode = match.captures.find(c => c.name === 'body')?.node;

    if (!funcNode) continue;

    const name = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';
    const loc = {
      startLine: funcNode.startPosition.row + 1,
      endLine: funcNode.endPosition.row + 1,
      startColumn: funcNode.startPosition.column,
      endColumn: funcNode.endPosition.column
    };

    const func = {
      id: `${filePath}:${funcNode.startIndex}:${funcNode.endIndex}`,
      name,
      fqName: name,
      filePath,
      start: funcNode.startIndex,
      end: funcNode.endIndex,
      ...loc,
      params: paramsNode ? source.slice(paramsNode.startIndex, paramsNode.endIndex) : '',
      body: bodyNode ? source.slice(bodyNode.startIndex, bodyNode.endIndex) : '',
      source: source.slice(funcNode.startIndex, funcNode.endIndex),
      lang: LANGUAGE_ID,
      doc: extractDocstring(bodyNode, source)
    };

    functions.push(func);
  }

  return functions;
}

function extractDocstring(bodyNode, source) {
  if (!bodyNode) return '';
  const blockNode = bodyNode;
  if (!blockNode || !blockNode.namedChildren) return '';

  const firstStatement = blockNode.namedChildren.find(child => child.type === 'expression_statement');
  if (!firstStatement || !firstStatement.namedChildren) return '';

  const stringNode = firstStatement.namedChildren.find(child => child.type === 'string');
  if (!stringNode) return '';

  return source.slice(stringNode.startIndex, stringNode.endIndex).replace(/^[ruURfF]*['"]{1,3}|['"]{1,3}$/g, '');
}

function extractImports(matches, source, filePath) {
  const imports = [];

  for (const match of matches) {
    const moduleNode = match.captures.find(c => c.name === 'module')?.node;
    const nameNode = match.captures.find(c => c.name === 'name')?.node;
    const aliasNode = match.captures.find(c => c.name === 'alias')?.node;
    const wildcardNode = match.captures.find(c => c.name === 'wildcard')?.node;

    const moduleName = moduleNode ? source.slice(moduleNode.startIndex, moduleNode.endIndex).trim() : null;
    const aliasName = aliasNode ? source.slice(aliasNode.startIndex, aliasNode.endIndex).trim() : null;

    if (nameNode) {
      const originalName = source.slice(nameNode.startIndex, nameNode.endIndex).trim();
      imports.push({
        name: aliasName || originalName,
        originalName,
        from: moduleName,
        alias: aliasName,
        isDefault: false,
        filePath
      });
    } else if (moduleName && !wildcardNode) {
      const baseName = moduleName.split('.').pop();
      imports.push({
        name: aliasName || baseName,
        originalName: baseName,
        from: moduleName,
        alias: aliasName,
        isDefault: true,
        filePath
      });
    }
  }

  return imports;
}

function extractCalls(matches, source, filePath) {
  const calls = [];

  for (const match of matches) {
    const callNode = match.captures.find(c => c.name === 'call')?.node;
    if (!callNode) continue;

    const calleeNode = match.captures.find(c => c.name === 'callee')?.node;
    const objectNode = match.captures.find(c => c.name === 'object')?.node;
    const methodNode = match.captures.find(c => c.name === 'method')?.node;

    let callee = null;
    let isMemberCall = false;
    let isDynamic = false;

    if (calleeNode) {
      callee = source.slice(calleeNode.startIndex, calleeNode.endIndex);
    } else if (objectNode && methodNode) {
      const objectName = source.slice(objectNode.startIndex, objectNode.endIndex);
      const methodName = source.slice(methodNode.startIndex, methodNode.endIndex);
      callee = `${objectName}.${methodName}`;
      isMemberCall = true;
      isDynamic = true;
    }

    if (!callee) continue;

    calls.push({
      callee,
      filePath,
      start: callNode.startIndex,
      end: callNode.endIndex,
      startLine: callNode.startPosition.row + 1,
      endLine: callNode.endPosition.row + 1,
      isMemberCall,
      isDynamic,
      language: LANGUAGE_ID
    });
  }

  return calls;
}

