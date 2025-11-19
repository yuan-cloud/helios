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

import { validateGraphPayload, printValidationErrors, generatePayloadSchema } from '../src/graph/payload-validator.js';

export function validatePayload(input, options = {}) {
  const hasParserSection = Boolean(input && typeof input === 'object' && input.parser);
  const hasEmbeddingsSection =
    Boolean(input && typeof input === 'object' && input.embeddings);

  const result = validateGraphPayload(input, { 
    ...options, 
    collectStats: options.collectStats !== false 
  });
  const compatibilityErrors = [];

  if (hasParserSection && Array.isArray(input.parser?.functions)) {
    input.parser.functions.forEach((fn, index) => {
      const id = fn?.id ?? '';
      if (typeof id !== 'string' || id.trim() === '') {
        compatibilityErrors.push({
          path: `parser.functions[${index}].id`,
          message: 'must be a non-empty string.',
          suggestion: 'Function id should follow format: <filePath>::<name>'
        });
      }
    });
  }

  const errorMessages = result.errors.map((error) => {
    if (!error) {
      return { path: '<unknown>', message: 'Unspecified validation error.' };
    }
    if (typeof error === 'string') {
      return { path: '<root>', message: error };
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
    return {
      path,
      message: error.message || 'Invalid value.',
      suggestion: error.suggestion
    };
  });
  const combinedErrors = errorMessages.concat(compatibilityErrors);
  return {
    ...result,
    valid: result.valid && compatibilityErrors.length === 0,
    errors: combinedErrors
  };
}

export { printValidationErrors, generatePayloadSchema };

async function main(argv) {
  const args = parseArgs(argv);
  
  if (args.schema) {
    // Export JSON Schema
    const schema = generatePayloadSchema();
    if (args.output) {
      await fs.writeFile(args.output, JSON.stringify(schema, null, 2), 'utf-8');
      console.log(`✅ JSON Schema written to ${args.output}`);
    } else {
      console.log(JSON.stringify(schema, null, 2));
    }
    process.exitCode = 0;
    return;
  }
  
  if (args.help || (!args.input && !args.schema)) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    const payloadPath = path.resolve(args.input);
    const raw = await fs.readFile(payloadPath, 'utf-8');
    const json = JSON.parse(raw);

    const result = validateGraphPayload(json, { 
      strict: args.strict,
      collectStats: true 
    });
    
    if (result.valid) {
      const stats = result.stats || {};
      console.log('✅ Payload valid\n');
      console.log('Statistics:');
      console.log(`  Functions: ${stats.functionCount || result.payload.functions.length}`);
      console.log(`  Call edges: ${stats.callEdgeCount || result.payload.callEdges.length}`);
      console.log(`  Similarity edges: ${stats.similarityEdgeCount || result.payload.similarityEdges.length}`);
      
      if (stats.resolvedCallEdges !== undefined || stats.unresolvedCallEdges !== undefined) {
        console.log(`  Resolved call edges: ${stats.resolvedCallEdges || 0}`);
        console.log(`  Unresolved call edges: ${stats.unresolvedCallEdges || 0}`);
      }
      if (stats.externalTargets !== undefined && stats.externalTargets > 0) {
        console.log(`  External targets: ${stats.externalTargets}`);
      }
      if (stats.duplicateFunctionIds !== undefined && stats.duplicateFunctionIds > 0) {
        console.log(`  ⚠️  Duplicate function IDs: ${stats.duplicateFunctionIds}`);
      }
      
      process.exitCode = 0;
    } else {
      console.error('❌ Payload validation failed\n');
      console.error(printValidationErrors(result.errors));
      
      if (result.stats) {
        console.error('\nStatistics:');
        console.error(`  Functions: ${result.stats.functionCount || 0}`);
        console.error(`  Call edges: ${result.stats.callEdgeCount || 0}`);
        console.error(`  Similarity edges: ${result.stats.similarityEdgeCount || 0}`);
      }
      
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (err.code === 'ENOENT') {
      console.error(`File not found: ${args.input}`);
    } else if (err instanceof SyntaxError) {
      console.error('Invalid JSON. Please check the file format.');
    }
    process.exitCode = 2;
  }
}

function parseArgs(argv) {
  const result = {
    strict: false,
    help: false,
    input: null,
    schema: false,
    output: null
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
      case '--schema':
        result.schema = true;
        break;
      case '--output':
      case '-o':
        result.output = argv[++i];
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
  console.log(`Usage: node ${name} [OPTIONS]`);
  console.log('');
  console.log('Validate a payload:');
  console.log(`  node ${name} --input path/to/payload.json [OPTIONS]`);
  console.log('');
  console.log('Export JSON Schema:');
  console.log(`  node ${name} --schema [--output schema.json]`);
  console.log('');
  console.log('Options:');
  console.log('  -i, --input <file>   Path to JSON payload or envelope');
  console.log('      --strict         Fail when unexpected top-level keys are present');
  console.log('      --schema         Export JSON Schema instead of validating');
  console.log('  -o, --output <file>  Output file (for --schema)');
  console.log('  -h, --help           Show this help message');
  console.log('');
  console.log('Examples:');
  console.log(`  node ${name} docs/payload-sample.json`);
  console.log(`  node ${name} --input payload.json --strict`);
  console.log(`  node ${name} --schema --output payload-schema.json`);
}

const isCliInvocation =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCliInvocation) {
  await main(process.argv.slice(2));
}

