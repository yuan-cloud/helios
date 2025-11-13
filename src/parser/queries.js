import * as TreeSitter from 'web-tree-sitter';

/**
 * Tree-sitter query patterns - MINIMAL WORKING VERSION
 */
export const JAVASCRIPT_QUERIES = {
  functions: `
    (function_declaration
      name: (identifier) @name) @func
    
    (method_definition
      name: (property_identifier) @name) @func
    
    (variable_declarator
      name: (identifier) @name
      value: (arrow_function) @func)
  `,

  exports: `
    (export_statement) @export
  `,

  imports: `
    (import_statement) @import
  `,

  calls: `
    (call_expression
      function: (identifier) @callee) @call
    
    (call_expression
      function: (member_expression) @call) @call
  `
};

export const PYTHON_QUERIES = {
  functions: `
    (function_definition
      name: (identifier) @name) @func
  `,

  imports: `
    (import_statement) @import
  `,

  calls: `
    (call
      function: (identifier) @callee) @call
  `
};

export function compileQuery(language, queryString) {
  try {
    if (!language) {
      throw new Error('Language instance is required');
    }

    const QueryCtor =
      typeof TreeSitter.Query === 'function'
        ? TreeSitter.Query
        : typeof TreeSitter.default?.Query === 'function'
          ? TreeSitter.default.Query
          : typeof TreeSitter.Parser?.Query === 'function'
            ? TreeSitter.Parser.Query
            : typeof TreeSitter.default?.Parser?.Query === 'function'
              ? TreeSitter.default.Parser.Query
              : null;

    if (QueryCtor) {
      return new QueryCtor(language, queryString);
    }

    if (typeof language.query === 'function') {
      return language.query(queryString);
    }

    throw new Error('Neither Query constructor nor language.query() is available');
  } catch (err) {
    console.error('[Queries] Failed to compile query:', err);
    throw new Error(`Query compilation failed: ${err.message}`);
  }
}