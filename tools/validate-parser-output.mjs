#!/usr/bin/env node

/**
 * Validate raw parser output before passing it downstream.
 *
 * Usage:
 *   node tools/validate-parser-output.mjs --input docs/examples/parser-output-sample.json
 *   cat payload.json | node tools/validate-parser-output.mjs
 */

import fs from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';

import { validateParserPayload } from '../src/parser/validation.js';

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    printUsage();
    return 1;
  }
  if (args.help) {
    printUsage();
    return 0;
  }

  const sources = args.inputs.length ? args.inputs : [null];
  let exitCode = 0;

  for (const input of sources) {
    try {
      const data = await readPayload(input);
      const { valid, errors } = validateParserPayload(data, { strict: args.strict });

      const label = input ? path.relative(process.cwd(), input) : '<stdin>';
      if (valid) {
        console.log(`✅ ${label} passed parser validation (${data.functions.length} functions, ${data.callEdges.length} call edges).`);
      } else {
        exitCode = 1;
        console.error(`❌ ${label} failed parser validation:`);
        errors.forEach(error => {
          console.error(`  - ${formatError(error)}`);
        });
      }
    } catch (err) {
      exitCode = 1;
      console.error(`❌ Failed to validate ${input ?? '<stdin>'}: ${err.message}`);
    }
  }

  return exitCode;
}

function parseArgs(argv) {
  const inputs = [];
  let strict = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--input':
      case '-i':
        if (i + 1 >= argv.length) {
          throw new Error('--input requires a value');
        }
        inputs.push(argv[++i]);
        break;
      case '--strict':
        strict = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        if (!token.startsWith('-')) {
          inputs.push(token);
        } else {
          throw new Error(`Unknown option "${token}"`);
        }
        break;
    }
  }

  return { inputs, strict, help };
}

async function readPayload(input) {
  if (!input || input === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
    return JSON.parse(raw || '{}');
  }

  const raw = await fs.readFile(path.resolve(process.cwd(), input), 'utf8');
  return JSON.parse(raw);
}

function printUsage() {
  console.log('Usage: node tools/validate-parser-output.mjs [--strict] [--input fileA.json ...]');
  console.log('');
  console.log('  --input, -i   Path to a parser payload JSON file (may be repeated).');
  console.log('  --strict      Fail when unexpected top-level keys appear.');
  console.log('  --help, -h    Show this help message.');
  console.log('');
  console.log('If no --input is provided the script reads from stdin.');
}

function formatError(error) {
  if (!error) {
    return 'Unknown validation error.';
  }
  if (typeof error === 'string') {
    return error;
  }
  const path = error.path ? `${error.path}: ` : '';
  return `${path}${error.message}`;
}

const [, , ...argv] = process.argv;

main(argv)
  .then(code => {
    if (typeof code === 'number') {
      process.exitCode = code;
    }
  })
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });


