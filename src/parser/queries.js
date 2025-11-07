/**
 * Tree-sitter query patterns for extracting code structures
 * Following PLAN.md section 3.2 and 10.1 specifications
 */

/**
 * JavaScript/TypeScript query patterns
 * Extracts: functions, exports/imports, call expressions
 */
export const JAVASCRIPT_QUERIES = {
  // Function declarations: function_declaration, method_definition, arrow_function
  functions: `
    (function_declaration
      name: (identifier) @name
      parameters: (formal_parameters) @params
      body: (statement_block) @body) @func
    
    (method_definition
      name: (property_identifier) @name
      parameters: (formal_parameters) @params
      body: (statement_block) @body) @func
    
    (arrow_function
      parameter: (identifier) @name
      body: (_) @body) @func
    
    (arrow_function
      parameters: (formal_parameters) @params
      body: (_) @body) @func
  `,

  // Module exports: export_statement, export_declaration
  exports: `
    (export_statement
      (identifier) @name)
    
    (export_declaration
      (function_declaration
        name: (identifier) @name))
    
    (export_declaration
      (variable_declaration
        (variable_declarator
          name: (identifier) @name)))
  `,

  // Module imports: import_statement
  imports: `
    (import_statement
      source: (string) @source
      import_clause: (import_clause
        (identifier) @default_import))
    
    (import_statement
      source: (string) @source
      import_clause: (named_imports
        (import_specifier
          name: (identifier) @name
          alias: (identifier) @alias)))
  `,

  // Call expressions: identifier calls and member expression calls
  calls: `
    (call_expression
      function: (identifier) @callee) @call
    
    (call_expression
      function: (member_expression
        object: (_) @object
        property: (property_identifier) @method)) @call
    
    (new_expression
      constructor: (identifier) @callee) @call
  `
};

/**
 * Python query patterns (for future implementation)
 */
export const PYTHON_QUERIES = {
  functions: `
    (function_definition
      name: (identifier) @name
      parameters: (parameters) @params
      body: (block) @body) @func

    (decorated_definition
      definition: (function_definition
        name: (identifier) @name
        parameters: (parameters) @params
        body: (block) @body) @func)
  `,

  imports: `
    (import_statement
      name: (dotted_as_names
        (dotted_as_name
          name: (dotted_name) @module
          alias: (identifier)? @alias))) @import

    (import_statement
      name: (dotted_as_names
        (dotted_as_name
          name: (identifier) @module
          alias: (identifier)? @alias))) @import

    (import_from_statement
      module_name: (dotted_name)? @module
      name: (import_as_names
        (import_as_name
          name: (identifier) @name
          alias: (identifier)? @alias))) @import

    (import_from_statement
      module_name: (dotted_name)? @module
      name: (wildcard) @wildcard) @import
  `,

  calls: `
    (call
      function: (identifier) @callee) @call

    (call
      function: (attribute
        object: (_) @object
        attribute: (identifier) @method)) @call
  `
};

/**
 * Compile a query for a language
 * @param {Language} language - Tree-sitter Language object
 * @param {string} queryString - Query string in Tree-sitter query DSL
 * @returns {Query} - Compiled query object
 */
export function compileQuery(language, queryString) {
  try {
    return language.query(queryString);
  } catch (err) {
    console.error('[Queries] Failed to compile query:', err);
    throw new Error(`Query compilation failed: ${err.message}`);
  }
}

