/**
 * Graph payload validation helpers.
 *
 * The validator accepts either a merged payload
 * ({ functions, callEdges, similarityEdges }) or the
 * higher-level envelope used by updateGraphData
 * ({ parser, embeddings, overrides }).
 *
 * It returns a normalised payload plus an error list so
 * other agents can quickly diagnose schema mismatches.
 */

import { mergeGraphPayload } from './merge.js';

/**
 * Validate a graph payload or envelope.
 * @param {Object} input
 * @param {Object} [options]
 * @param {boolean} [options.strict=false] - When true, fail on unknown fields.
 * @param {boolean} [options.collectStats=false] - When true, include statistics in result.
 * @returns {{ valid: boolean, errors: Array<{path: string, message: string, suggestion?: string}>, payload: Object, stats?: Object }}
 */
export function validateGraphPayload(input, { strict = false, collectStats = false } = {}) {
  const payload = normalisePayload(input);
  const errors = [];
  const stats = collectStats ? {
    functionCount: 0,
    callEdgeCount: 0,
    similarityEdgeCount: 0,
    resolvedCallEdges: 0,
    unresolvedCallEdges: 0,
    externalTargets: 0,
    duplicateFunctionIds: 0
  } : null;

  if (!payload || typeof payload !== 'object') {
    errors.push({
      path: '',
      message: 'Payload must be an object with { functions, callEdges, similarityEdges }.',
      suggestion: 'Ensure your payload has the correct structure. See docs/payloads.md for the schema.'
    });
    return { valid: false, errors, payload: null, stats };
  }

  validateFunctions(payload.functions, errors, stats);
  const functionIds = new Set(payload.functions.map(fn => fn.id));
  
  // Check for duplicate function IDs
  if (stats) {
    const seenIds = new Set();
    payload.functions.forEach(fn => {
      if (seenIds.has(fn.id)) {
        stats.duplicateFunctionIds++;
      } else {
        seenIds.add(fn.id);
      }
    });
  }

  validateCallEdges(payload.callEdges, errors, functionIds, stats);
  validateSimilarityEdges(payload.similarityEdges, errors, functionIds, stats);

  if (strict) {
    validateStrictKeys(payload, errors);
  }

  if (stats) {
    stats.functionCount = payload.functions.length;
    stats.callEdgeCount = payload.callEdges.length;
    stats.similarityEdgeCount = payload.similarityEdges.length;
  }

  return {
    valid: errors.length === 0,
    errors,
    payload,
    stats
  };
}

/**
 * Produce a merged payload regardless of the input shape.
 */
function normalisePayload(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  // Already in merged shape
  if (Array.isArray(input.functions)) {
    return {
      functions: cloneArray(input.functions),
      callEdges: cloneArray(input.callEdges),
      similarityEdges: cloneArray(input.similarityEdges)
    };
  }

  return mergeGraphPayload(input);
}

function cloneArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(item => (item && typeof item === 'object' ? { ...item } : item));
}

function validateFunctions(functions, errors, stats) {
  if (!Array.isArray(functions)) {
    errors.push({
      path: 'functions',
      message: 'Expected an array of function records.',
      suggestion: 'Ensure functions is an array. If using an envelope, check parser.functions or overrides.functions.'
    });
    return;
  }

  const validLangs = new Set(['javascript', 'typescript', 'python', 'java', 'go', 'rust']);
  
  functions.forEach((fn, index) => {
    const path = `functions[${index}]`;
    if (!fn || typeof fn !== 'object') {
      errors.push({ 
        path, 
        message: 'Function entry must be an object.',
        suggestion: 'Each function must be a JSON object with required fields: id, name, filePath, lang, startLine, endLine.'
      });
      return;
    }
    
    validateString(fn.id, `${path}.id`, errors, { 
      required: true,
      suggestion: 'Function id should follow format: <filePath>::<name> (e.g., "src/utils/math.ts::add")'
    });
    
    validateString(fn.name, `${path}.name`, errors, { 
      required: true,
      suggestion: 'Function name can be empty for anonymous functions, but the field must be present.'
    });
    
    validateString(fn.filePath, `${path}.filePath`, errors, { 
      required: true,
      suggestion: 'File path should be normalized POSIX path relative to project root (use forward slashes).'
    });
    
    validateString(fn.lang, `${path}.lang`, errors, { 
      required: true,
      suggestion: `Language must be lowercase (e.g., "typescript", "javascript", "python"). Valid values: ${Array.from(validLangs).join(', ')}.`
    });
    
    if (fn.lang && !validLangs.has(fn.lang)) {
      errors.push({
        path: `${path}.lang`,
        message: `Unknown language "${fn.lang}".`,
        suggestion: `Use one of: ${Array.from(validLangs).join(', ')}. Language must be lowercase.`
      });
    }
    
    validateNumber(fn.startLine, `${path}.startLine`, errors, { 
      required: true, 
      integer: true,
      min: 1,
      suggestion: 'startLine must be a 1-based line number (inclusive).'
    });
    
    validateNumber(fn.endLine, `${path}.endLine`, errors, { 
      required: true, 
      integer: true,
      min: 1,
      suggestion: 'endLine must be a 1-based line number (inclusive), and should be >= startLine.'
    });
    
    if (fn.startLine && fn.endLine && fn.endLine < fn.startLine) {
      errors.push({
        path: `${path}.endLine`,
        message: `endLine (${fn.endLine}) must be >= startLine (${fn.startLine}).`,
        suggestion: 'Check that line numbers are correct. endLine should be the last line of the function.'
      });
    }

    if (fn.metrics && typeof fn.metrics !== 'object') {
      errors.push({ 
        path: `${path}.metrics`, 
        message: 'metrics must be an object when provided.',
        suggestion: 'metrics should be a JSON object with static analysis results (e.g., { cyclomatic: 3 }).'
      });
    }
    if (fn.analysis && typeof fn.analysis !== 'object') {
      errors.push({ 
        path: `${path}.analysis`, 
        message: 'analysis must be an object when provided.',
        suggestion: 'analysis should be a JSON object with graph metrics (e.g., { community: 4, pageRank: 0.0123 }).'
      });
    }
  });
}

function validateCallEdges(edges, errors, functionIds, stats) {
  if (!Array.isArray(edges)) {
    errors.push({
      path: 'callEdges',
      message: 'Expected callEdges to be an array.',
      suggestion: 'Ensure callEdges is an array. If using an envelope, check parser.callEdges or overrides.callEdges.'
    });
    return;
  }

  edges.forEach((edge, index) => {
    const path = `callEdges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ 
        path, 
        message: 'Call edge must be an object.',
        suggestion: 'Each call edge must be a JSON object with required fields: source, target, weight.'
      });
      return;
    }
    
    validateString(edge.source, `${path}.source`, errors, { 
      required: true,
      suggestion: 'source must be a function id from the functions array.'
    });
    
    validateString(edge.target, `${path}.target`, errors, { 
      required: true,
      suggestion: 'target must be a function id. For unresolved edges, use "external::<name>" format or set resolution.status to "unresolved".'
    });
    
    validateNumber(edge.weight, `${path}.weight`, errors, { 
      required: true, 
      min: 1,
      suggestion: 'weight must be >= 1 (number of call sites).'
    });

    if (functionIds && edge.source && !functionIds.has(edge.source)) {
      errors.push({ 
        path: `${path}.source`, 
        message: `Unknown function id "${edge.source}".`,
        suggestion: `Ensure the source function exists in the functions array. Check for typos or missing functions.`
      });
    }
    
    // Track external targets and resolution status
    if (stats) {
      if (edge.target && edge.target.startsWith('external::')) {
        stats.externalTargets++;
        stats.unresolvedCallEdges++;
      } else if (edge.resolution) {
        if (edge.resolution.status === 'resolved') {
          stats.resolvedCallEdges++;
        } else {
          stats.unresolvedCallEdges++;
        }
      } else if (functionIds && edge.target && !functionIds.has(edge.target)) {
        // Target not in functions but not marked as external
        stats.unresolvedCallEdges++;
      } else if (functionIds && edge.target && functionIds.has(edge.target)) {
        stats.resolvedCallEdges++;
      }
    }
    
    // Validate resolution structure if present
    if (edge.resolution) {
      if (typeof edge.resolution !== 'object') {
        errors.push({
          path: `${path}.resolution`,
          message: 'resolution must be an object when provided.',
          suggestion: 'resolution should have structure: { status: "resolved"|"ambiguous"|"unresolved", reason?: string, candidates?: [...] }'
        });
      } else {
        const validStatuses = ['resolved', 'ambiguous', 'unresolved'];
        if (edge.resolution.status && !validStatuses.includes(edge.resolution.status)) {
          errors.push({
            path: `${path}.resolution.status`,
            message: `Invalid resolution status "${edge.resolution.status}".`,
            suggestion: `Status must be one of: ${validStatuses.join(', ')}.`
          });
        }
        
        // Validate candidates array if present
        if (edge.resolution.candidates !== undefined) {
          if (!Array.isArray(edge.resolution.candidates)) {
            errors.push({
              path: `${path}.resolution.candidates`,
              message: 'resolution.candidates must be an array when provided.',
              suggestion: 'candidates should be an array of objects: [{ id: string, confidence: number }]'
            });
          } else {
            edge.resolution.candidates.forEach((candidate, idx) => {
              const candidatePath = `${path}.resolution.candidates[${idx}]`;
              if (typeof candidate !== 'object' || candidate === null) {
                errors.push({
                  path: candidatePath,
                  message: 'Each candidate must be an object.',
                  suggestion: 'Candidate should have structure: { id: string, confidence: number }'
                });
              } else {
                validateString(candidate.id, `${candidatePath}.id`, errors, {
                  required: true,
                  suggestion: 'candidate.id must be a function id string.'
                });
                validateNumber(candidate.confidence, `${candidatePath}.confidence`, errors, {
                  required: true,
                  min: 0,
                  max: 1,
                  suggestion: 'candidate.confidence must be a number between 0 and 1.'
                });
              }
            });
          }
        }
      }
    }
    
    // target may be a best-guess candidate for unresolved edges; do not fail validation.
    // But warn if target doesn't exist and isn't marked as external
    if (functionIds && edge.target && !edge.target.startsWith('external::') && !functionIds.has(edge.target)) {
      // This is a warning, not an error - the validator tolerates optimistic targets
      // But we can add it as a warning in stats if needed
    }
  });
}

function validateSimilarityEdges(edges, errors, functionIds, stats) {
  if (!Array.isArray(edges)) {
    errors.push({
      path: 'similarityEdges',
      message: 'Expected similarityEdges to be an array.',
      suggestion: 'Ensure similarityEdges is an array. If using an envelope, check embeddings.similarityEdges or overrides.similarityEdges.'
    });
    return;
  }

  edges.forEach((edge, index) => {
    const path = `similarityEdges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ 
        path, 
        message: 'Similarity edge must be an object.',
        suggestion: 'Each similarity edge must be a JSON object with required fields: source, target, similarity.'
      });
      return;
    }
    
    validateString(edge.source, `${path}.source`, errors, { 
      required: true,
      suggestion: 'source must be a function id from the functions array.'
    });
    
    validateString(edge.target, `${path}.target`, errors, { 
      required: true,
      suggestion: 'target must be a function id from the functions array.'
    });
    
    validateNumber(edge.similarity, `${path}.similarity`, errors, {
      required: true,
      min: 0,
      max: 1,
      suggestion: 'similarity must be a number between 0 and 1 (cosine similarity).'
    });

    if (functionIds && edge.source && !functionIds.has(edge.source)) {
      errors.push({ 
        path: `${path}.source`, 
        message: `Unknown function id "${edge.source}".`,
        suggestion: `Ensure the source function exists in the functions array. Check for typos or missing functions.`
      });
    }
    if (functionIds && edge.target && !functionIds.has(edge.target)) {
      errors.push({ 
        path: `${path}.target`, 
        message: `Unknown function id "${edge.target}".`,
        suggestion: `Ensure the target function exists in the functions array. Check for typos or missing functions.`
      });
    }
    
    // Check for self-loops (usually not useful for similarity)
    if (edge.source === edge.target) {
      errors.push({
        path: `${path}`,
        message: 'Similarity edge has source === target (self-loop).',
        suggestion: 'Self-loops are typically not useful for similarity edges. Consider filtering them out.'
      });
    }
  });
}

function validateStrictKeys(payload, errors) {
  const allowedKeys = new Set(['functions', 'callEdges', 'similarityEdges', 'extras']);
  Object.keys(payload).forEach((key) => {
    if (!allowedKeys.has(key)) {
      errors.push({
        path: key,
        message: `Unexpected top-level key "${key}" in strict mode.`
      });
    }
  });
}

function validateString(value, path, errors, { required = false, suggestion } = {}) {
  if (required && (value === null || value === undefined || value === '')) {
    errors.push({ 
      path, 
      message: 'Required string field is missing.',
      suggestion: suggestion || 'This field is required and cannot be empty.'
    });
    return;
  }
  if (value !== undefined && value !== null && typeof value !== 'string') {
    errors.push({ 
      path, 
      message: 'Expected a string.',
      suggestion: suggestion || 'Ensure the value is a string type.'
    });
  }
}

function validateNumber(value, path, errors, { required = false, integer = false, min, max, suggestion } = {}) {
  if (required && (value === null || value === undefined)) {
    errors.push({ 
      path, 
      message: 'Required numeric field is missing.',
      suggestion: suggestion || 'This field is required and must be a number.'
    });
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ 
      path, 
      message: 'Expected a finite number.',
      suggestion: suggestion || 'Ensure the value is a number (not NaN or Infinity).'
    });
    return;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push({ 
      path, 
      message: 'Expected an integer.',
      suggestion: suggestion || 'This field must be a whole number (integer).'
    });
  }
  if (min !== undefined && value < min) {
    errors.push({ 
      path, 
      message: `Value must be >= ${min}.`,
      suggestion: suggestion || `The value ${value} is below the minimum of ${min}.`
    });
  }
  if (max !== undefined && value > max) {
    errors.push({ 
      path, 
      message: `Value must be <= ${max}.`,
      suggestion: suggestion || `The value ${value} is above the maximum of ${max}.`
    });
  }
}

export function printValidationErrors(errors = []) {
  if (!errors.length) {
    return 'No validation errors.';
  }
  return errors.map(error => {
    let msg = `${error.path || '<root>'}: ${error.message}`;
    if (error.suggestion) {
      msg += `\n  💡 ${error.suggestion}`;
    }
    return msg;
  }).join('\n');
}

/**
 * Generate a JSON Schema for the payload contract.
 * This can be used by other tools for validation and IDE support.
 * @returns {Object} JSON Schema object
 */
export function generatePayloadSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'HELIOS Graph Payload Schema',
    description: 'Schema for parser/graph/viz payload exchange',
    type: 'object',
    required: ['functions', 'callEdges', 'similarityEdges'],
    properties: {
      functions: {
        type: 'array',
        description: 'Array of function metadata records',
        items: {
          type: 'object',
          required: ['id', 'name', 'filePath', 'lang', 'startLine', 'endLine'],
          properties: {
            id: {
              type: 'string',
              description: 'Stable identifier (format: <filePath>::<name>)',
              pattern: '^.+::.+$'
            },
            name: {
              type: 'string',
              description: 'Local function name (may be empty for anonymous)'
            },
            fqName: {
              type: 'string',
              description: 'Fully qualified name (dotted namespace)'
            },
            filePath: {
              type: 'string',
              description: 'Normalized POSIX path relative to project root'
            },
            moduleId: {
              type: 'string',
              description: 'Parser module graph identifier'
            },
            lang: {
              type: 'string',
              enum: ['javascript', 'typescript', 'python', 'java', 'go', 'rust'],
              description: 'Programming language (lowercase)'
            },
            startLine: {
              type: 'integer',
              minimum: 1,
              description: '1-based start line (inclusive)'
            },
            endLine: {
              type: 'integer',
              minimum: 1,
              description: '1-based end line (inclusive)'
            },
            startColumn: {
              type: 'integer',
              minimum: 0,
              description: '0-based start column'
            },
            endColumn: {
              type: 'integer',
              minimum: 0,
              description: '0-based end column'
            },
            loc: {
              type: 'integer',
              description: 'Lines of code'
            },
            doc: {
              type: 'string',
              description: 'Trimmed docstring or first comment'
            },
            source: {
              type: 'string',
              description: 'Function source snippet (trimmed per limits)'
            },
            isVirtual: {
              type: 'boolean',
              description: 'True when synthesized (e.g., module initializers)'
            },
            metrics: {
              type: 'object',
              description: 'Static analysis metrics',
              additionalProperties: true
            },
            analysis: {
              type: 'object',
              description: 'Graph analysis outputs (centrality, community, etc.)',
              additionalProperties: true
            }
          }
        }
      },
      callEdges: {
        type: 'array',
        description: 'Directed call relationships',
        items: {
          type: 'object',
          required: ['source', 'target', 'weight'],
          properties: {
            id: {
              type: 'string',
              description: 'Optional unique edge identifier'
            },
            source: {
              type: 'string',
              description: 'Caller function id'
            },
            target: {
              type: 'string',
              description: 'Callee function id (or external::<name> for unresolved)'
            },
            weight: {
              type: 'number',
              minimum: 1,
              description: 'Number of call sites'
            },
            isDynamic: {
              type: 'boolean',
              description: 'True when reflection/dynamic dispatch involved'
            },
            language: {
              type: 'string',
              description: 'Copy of parser language'
            },
            callSites: {
              type: 'array',
              description: 'Per-site call details',
              items: {
                type: 'object',
                properties: {
                  filePath: { type: 'string' },
                  line: { type: 'integer' },
                  column: { type: 'integer' },
                  context: { type: 'string' }
                }
              }
            },
            resolution: {
              type: 'object',
              description: 'Resolution outcome',
              properties: {
                status: {
                  type: 'string',
                  enum: ['resolved', 'ambiguous', 'unresolved']
                },
                reason: { type: 'string' },
                candidates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      confidence: { type: 'number', minimum: 0, maximum: 1 }
                    }
                  }
                },
                importInfo: {
                  type: 'object',
                  properties: {
                    module: { type: 'string' },
                    resolvedModule: { type: 'string' },
                    specifiers: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      },
      similarityEdges: {
        type: 'array',
        description: 'Undirected semantic relationships',
        items: {
          type: 'object',
          required: ['source', 'target', 'similarity'],
          properties: {
            id: {
              type: 'string',
              description: 'Optional deterministic identifier'
            },
            source: {
              type: 'string',
              description: 'Function id'
            },
            target: {
              type: 'string',
              description: 'Function id'
            },
            similarity: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Cosine similarity (0-1)'
            },
            method: {
              type: 'string',
              description: 'Similarity method (e.g., "topk-avg")'
            },
            representativeSimilarity: {
              type: 'number',
              minimum: 0,
              maximum: 1
            },
            topPairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sourceChunk: { type: 'string' },
                  targetChunk: { type: 'string' },
                  score: { type: 'number', minimum: 0, maximum: 1 }
                }
              }
            },
            undirected: {
              type: 'boolean',
              default: true
            },
            metadata: {
              type: 'object',
              additionalProperties: true
            }
          }
        }
      },
      extras: {
        type: 'object',
        description: 'Ancillary metadata',
        additionalProperties: true
      }
    }
  };
}


