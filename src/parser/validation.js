/**
 * Parser payload validation utilities.
 *
 * Ensures parser output matches the contract in docs/payloads.md before it
 * flows to downstream graph and visualization stages.
 */

const REQUIRED_FUNCTION_FIELDS = [
  ['id', 'string'],
  ['name', 'string'],
  ['filePath', 'string'],
  ['lang', 'string'],
  ['startLine', 'number'],
  ['endLine', 'number']
];

const OPTIONAL_FUNCTION_FIELDS = new Map([
  ['moduleId', 'string'],
  ['fqName', 'string'],
  ['doc', 'string'],
  ['source', 'string']
]);

const REQUIRED_CALL_EDGE_FIELDS = [
  ['source', 'string'],
  ['target', 'string'],
  ['weight', 'number']
];

const OPTIONAL_CALL_EDGE_FIELDS = new Map([
  ['id', 'string'],
  ['language', 'string'],
  ['isDynamic', 'boolean']
]);

/**
 * Validate parser payload shape.
 * @param {object} payload
 * @param {object} [options]
 * @param {boolean} [options.strict=false] Reject unknown top-level keys.
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }>, normalized: { functions: object[], callEdges: object[], symbolTables?: object } }}
 */
export function validateParserPayload(payload, { strict = false } = {}) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push({
      path: '',
      message: 'Payload must be an object with { functions, callEdges }.'
    });
    return { valid: false, errors, normalized: null };
  }

  const functions = Array.isArray(payload.functions) ? payload.functions : [];
  const callEdges = Array.isArray(payload.callEdges) ? payload.callEdges : [];
  const symbolTables =
    payload.symbolTables && typeof payload.symbolTables === 'object'
      ? payload.symbolTables
      : undefined;

  if (!Array.isArray(payload.functions)) {
    errors.push({
      path: 'functions',
      message: 'Expected functions to be an array.'
    });
  }

  if (!Array.isArray(payload.callEdges)) {
    errors.push({
      path: 'callEdges',
      message: 'Expected callEdges to be an array.'
    });
  }

  const functionIds = validateFunctions(functions, errors);
  validateCallEdges(callEdges, errors, functionIds);
  validateSymbolTables(symbolTables, errors);

  if (strict) {
    const allowed = new Set(['functions', 'callEdges', 'symbolTables', 'stats']);
    Object.keys(payload).forEach(key => {
      if (!allowed.has(key)) {
        errors.push({
          path: key,
          message: `Unexpected top-level key "${key}" in strict mode.`
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      functions,
      callEdges,
      symbolTables
    }
  };
}

function validateFunctions(functions, errors) {
  const ids = new Set();

  functions.forEach((fn, index) => {
    const path = `functions[${index}]`;
    if (!fn || typeof fn !== 'object') {
      errors.push({ path, message: 'Function entry must be an object.' });
      return;
    }

    REQUIRED_FUNCTION_FIELDS.forEach(([field, type]) => {
      validateField(fn[field], { path: `${path}.${field}`, type, required: true, errors });
    });

    OPTIONAL_FUNCTION_FIELDS.forEach((type, field) => {
      validateField(fn[field], { path: `${path}.${field}`, type, required: false, errors });
    });

    if (typeof fn.startLine === 'number' && typeof fn.endLine === 'number') {
      if (fn.endLine < fn.startLine) {
        errors.push({
          path: `${path}.endLine`,
          message: 'endLine must be >= startLine.'
        });
      }
    }

    if (typeof fn.id === 'string') {
      if (ids.has(fn.id)) {
        errors.push({
          path: `${path}.id`,
          message: `Duplicate function id "${fn.id}".`
        });
      } else {
        ids.add(fn.id);
      }
    }
  });

  return ids;
}

function validateCallEdges(edges, errors, functionIds) {
  const seen = new Set();

  edges.forEach((edge, index) => {
    const path = `callEdges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ path, message: 'Call edge must be an object.' });
      return;
    }

    REQUIRED_CALL_EDGE_FIELDS.forEach(([field, type]) => {
      validateField(edge[field], { path: `${path}.${field}`, type, required: true, errors });
    });

    OPTIONAL_CALL_EDGE_FIELDS.forEach((type, field) => {
      validateField(edge[field], { path: `${path}.${field}`, type, required: false, errors });
    });

    // Allow unresolved targets to point at placeholder nodes.
    const resolutionStatus = edge?.resolution?.status;
    const isUnresolved = typeof resolutionStatus === 'string' && resolutionStatus !== 'resolved';

    if (typeof edge.source === 'string' && !functionIds.has(edge.source)) {
      errors.push({
        path: `${path}.source`,
        message: `Unknown function id "${edge.source}".`
      });
    }

    if (
      typeof edge.target === 'string' &&
      !edge.target.startsWith('external::') &&
      !edge.target.startsWith('virtual::') &&
      !isUnresolved &&
      !functionIds.has(edge.target)
    ) {
      errors.push({
        path: `${path}.target`,
        message: `Unknown function id "${edge.target}".`
      });
    }

    if (typeof edge.weight === 'number' && edge.weight <= 0) {
      errors.push({
        path: `${path}.weight`,
        message: 'weight must be a positive number.'
      });
    }

    if (typeof edge.source === 'string' && typeof edge.target === 'string') {
      const key = `${edge.source}→${edge.target}`;
      if (seen.has(key)) {
        errors.push({
          path,
          message: `Duplicate call edge between "${edge.source}" and "${edge.target}".`
        });
      } else {
        seen.add(key);
      }
    }
  });
}

function validateSymbolTables(symbolTables, errors) {
  if (!symbolTables) {
    return;
  }

  if (typeof symbolTables !== 'object') {
    errors.push({
      path: 'symbolTables',
      message: 'symbolTables must be an object keyed by file path.'
    });
    return;
  }

  Object.entries(symbolTables).forEach(([filePath, table]) => {
    const basePath = `symbolTables["${filePath}"]`;
    if (!table || typeof table !== 'object') {
      errors.push({
        path: basePath,
        message: 'Symbol table entry must be an object.'
      });
      return;
    }

    if (table.moduleId !== undefined && typeof table.moduleId !== 'string') {
      errors.push({
        path: `${basePath}.moduleId`,
        message: 'moduleId must be a string when provided.'
      });
    }

    ['exports', 'imports', 'functions'].forEach(key => {
      if (table[key] !== undefined && !Array.isArray(table[key])) {
        errors.push({
          path: `${basePath}.${key}`,
          message: `${key} must be an array when provided.`
        });
      }
    });
  });
}

function validateField(value, { path, type, required, errors }) {
  if (value === undefined || value === null) {
    if (required) {
      errors.push({ path, message: 'Required field is missing.' });
    }
    return;
  }

  switch (type) {
    case 'string':
      if (typeof value !== 'string' || !value.trim()) {
        errors.push({ path, message: 'Expected a non-empty string.' });
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, message: 'Expected a finite number.' });
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, message: 'Expected a boolean.' });
      }
      break;
    default:
      break;
  }
}


