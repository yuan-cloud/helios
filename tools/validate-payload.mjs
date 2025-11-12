#!/usr/bin/env node

/**
 * CLI utility to validate parser/graph/viz payloads against the shared schema.
 *
 * Usage:
 *   node tools/validate-payload.mjs --input path/to/payload.json [--strict]
 *
 * The payload can be either:
 *   - A merged graph payload: { functions, callEdges, similarityEdges }
 *   - The higher-level envelope used by updateGraphData:
 *       { parser: {...}, embeddings: {...}, overrides: {...} }
 *
 * Exit codes:
 *   0  - Payload is valid
 *   1  - Validation errors encountered
 *   2  - CLI usage error
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateGraphPayload, printValidationErrors } from '../src/graph/payload-validator.js';

export function validatePayload(input, options = {}) {
  const hasParserSection = Boolean(input && typeof input === 'object' && input.parser);
  const hasEmbeddingsSection =
    Boolean(input && typeof input === 'object' && input.embeddings);

  const result = validateGraphPayload(input, options);
  const compatibilityErrors = [];

  if (hasParserSection && Array.isArray(input.parser?.functions)) {
    input.parser.functions.forEach((fn, index) => {
      const id = fn?.id ?? '';
      if (typeof id !== 'string' || id.trim() === '') {
        compatibilityErrors.push(
          `parser.functions[${index}].id must be a non-empty string.`
        );
      }
    });
  }

  const errorMessages = result.errors.map((error) => {
    if (!error) {
      return '<unknown>: Unspecified validation error.';
    }
    if (typeof error === 'string') {
      return error;
    }
    let path = error.path || '<root>';
    if (hasParserSection) {
      if (path.startsWith('functions') || path.startsWith('callEdges')) {
        path = `parser.${path}`;
      }
    }
    if (hasEmbeddingsSection && path.startsWith('similarityEdges')) {
      path = `embeddings.${path}`;
    }
    const message = error.message || 'Invalid value.';
    return `${path}: ${message}`;
  });
  const combinedErrors = errorMessages.concat(compatibilityErrors);
  return {
    ...result,
    valid: result.valid && compatibilityErrors.length === 0,
    errors: combinedErrors
  };
}

export { printValidationErrors };

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.input) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    const payloadPath = path.resolve(args.input);
    const raw = await fs.readFile(payloadPath, 'utf-8');
    const json = JSON.parse(raw);

    const result = validateGraphPayload(json, { strict: args.strict });
    if (result.valid) {
      console.log(
        `✅ Payload valid (${result.payload.functions.length} functions, ${result.payload.callEdges.length} call edges, ${result.payload.similarityEdges.length} similarity edges).`
      );
      process.exitCode = 0;
    } else {
      console.error('❌ Payload validation failed:\n');
      console.error(printValidationErrors(result.errors));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 2;
  }
}

function parseArgs(argv) {
  const result = {
    strict: false,
    help: false,
    input: null
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    switch (token) {
      case '--input':
      case '-i':
        result.input = argv[++i];
        break;
      case '--strict':
        result.strict = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (!result.input && !token.startsWith('-')) {
          result.input = token;
        }
    }
  }

  return result;
}

function printUsage() {
  const scriptPath = fileURLToPath(import.meta.url);
  const name = path.relative(process.cwd(), scriptPath);
  console.log(`Usage: node ${name} --input path/to/payload.json [--strict]`);
  console.log('');
  console.log('Options:');
  console.log('  -i, --input   Path to JSON payload or envelope');
  console.log('      --strict  Fail when unexpected top-level keys are present');
  console.log('  -h, --help    Show this help message');
}

const isCliInvocation =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliInvocation) {
  await main(process.argv.slice(2));
}

