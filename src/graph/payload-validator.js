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
 * @returns {{ valid: boolean, errors: Array<{path: string, message: string}>, payload: Object }}
 */
export function validateGraphPayload(input, { strict = false } = {}) {
  const payload = normalisePayload(input);
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push({
      path: '',
      message: 'Payload must be an object with { functions, callEdges, similarityEdges }.'
    });
    return { valid: false, errors, payload: null };
  }

  validateFunctions(payload.functions, errors);
  const functionIds = new Set(payload.functions.map(fn => fn.id));

  validateCallEdges(payload.callEdges, errors, functionIds);
  validateSimilarityEdges(payload.similarityEdges, errors, functionIds);

  if (strict) {
    validateStrictKeys(payload, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    payload
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

function validateFunctions(functions, errors) {
  if (!Array.isArray(functions)) {
    errors.push({
      path: 'functions',
      message: 'Expected an array of function records.'
    });
    return;
  }

  functions.forEach((fn, index) => {
    const path = `functions[${index}]`;
    if (!fn || typeof fn !== 'object') {
      errors.push({ path, message: 'Function entry must be an object.' });
      return;
    }
    validateString(fn.id, `${path}.id`, errors, { required: true });
    validateString(fn.name, `${path}.name`, errors, { required: true });
    validateString(fn.filePath, `${path}.filePath`, errors, { required: true });
    validateString(fn.lang, `${path}.lang`, errors, { required: true });
    validateNumber(fn.startLine, `${path}.startLine`, errors, { required: true, integer: true });
    validateNumber(fn.endLine, `${path}.endLine`, errors, { required: true, integer: true });

    if (fn.metrics && typeof fn.metrics !== 'object') {
      errors.push({ path: `${path}.metrics`, message: 'metrics must be an object when provided.' });
    }
    if (fn.analysis && typeof fn.analysis !== 'object') {
      errors.push({ path: `${path}.analysis`, message: 'analysis must be an object when provided.' });
    }
  });
}

function validateCallEdges(edges, errors, functionIds) {
  if (!Array.isArray(edges)) {
    errors.push({
      path: 'callEdges',
      message: 'Expected callEdges to be an array.'
    });
    return;
  }

  edges.forEach((edge, index) => {
    const path = `callEdges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ path, message: 'Call edge must be an object.' });
      return;
    }
    validateString(edge.source, `${path}.source`, errors, { required: true });
    validateString(edge.target, `${path}.target`, errors, { required: true });
    validateNumber(edge.weight, `${path}.weight`, errors, { required: true, min: 0 });

    if (functionIds && edge.source && !functionIds.has(edge.source)) {
      errors.push({ path: `${path}.source`, message: `Unknown function id "${edge.source}".` });
    }
    // target may be a best-guess candidate for unresolved edges; do not fail validation.
  });
}

function validateSimilarityEdges(edges, errors, functionIds) {
  if (!Array.isArray(edges)) {
    errors.push({
      path: 'similarityEdges',
      message: 'Expected similarityEdges to be an array.'
    });
    return;
  }

  edges.forEach((edge, index) => {
    const path = `similarityEdges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ path, message: 'Similarity edge must be an object.' });
      return;
    }
    validateString(edge.source, `${path}.source`, errors, { required: true });
    validateString(edge.target, `${path}.target`, errors, { required: true });
    validateNumber(edge.similarity, `${path}.similarity`, errors, {
      required: true,
      min: 0,
      max: 1
    });

    if (functionIds && edge.source && !functionIds.has(edge.source)) {
      errors.push({ path: `${path}.source`, message: `Unknown function id "${edge.source}".` });
    }
    if (functionIds && edge.target && !functionIds.has(edge.target)) {
      errors.push({ path: `${path}.target`, message: `Unknown function id "${edge.target}".` });
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

function validateString(value, path, errors, { required = false } = {}) {
  if (required && (value === null || value === undefined || value === '')) {
    errors.push({ path, message: 'Required string field is missing.' });
    return;
  }
  if (value !== undefined && value !== null && typeof value !== 'string') {
    errors.push({ path, message: 'Expected a string.' });
  }
}

function validateNumber(value, path, errors, { required = false, integer = false, min, max } = {}) {
  if (required && (value === null || value === undefined)) {
    errors.push({ path, message: 'Required numeric field is missing.' });
    return;
  }
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: 'Expected a finite number.' });
    return;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push({ path, message: 'Expected an integer.' });
  }
  if (min !== undefined && value < min) {
    errors.push({ path, message: `Value must be >= ${min}.` });
  }
  if (max !== undefined && value > max) {
    errors.push({ path, message: `Value must be <= ${max}.` });
  }
}

export function printValidationErrors(errors = []) {
  if (!errors.length) {
    return 'No validation errors.';
  }
  return errors.map(error => `${error.path || '<root>'}: ${error.message}`).join('\n');
}


