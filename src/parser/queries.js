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

let QueryConstructor = null;

export function registerQueryConstructor(constructor) {
  if (typeof constructor === 'function') {
    QueryConstructor = constructor;
  }
}

export function compileQuery(language, queryString) {
  try {
    if (!language) {
      throw new Error('Language instance is required');
    }

    if (QueryConstructor) {
      return new QueryConstructor(language, queryString);
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