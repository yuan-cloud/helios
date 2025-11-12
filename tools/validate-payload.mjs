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
      console.log(`✅ Payload valid (${result.payload.functions.length} functions, ${result.payload.callEdges.length} call edges, ${result.payload.similarityEdges.length} similarity edges).`);
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

await main(process.argv.slice(2));

#!/usr/bin/env node

/**
 * HELIOS payload validator.
 *
 * Ensures payloads consumed by parser → graph → viz pipeline satisfy the
 * contract described in docs/payloads.md.
 *
 * Usage:
 *   node tools/validate-payload.mjs docs/payload-sample.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validatePayload(payload, options = {}) {
  const { throwOnError = true } = options;
  const errors = [];

  const addError = (message) => {
    errors.push(message);
  };

  if (!payload || typeof payload !== "object") {
    addError("Payload must be a non-null object.");
  }

  const parser = payload?.parser ?? {};
  const embeddings = payload?.embeddings ?? {};

  const functions = Array.isArray(parser.functions) ? parser.functions : [];
  const callEdges = Array.isArray(parser.callEdges) ? parser.callEdges : [];
  const similarityEdges = Array.isArray(embeddings.similarityEdges)
    ? embeddings.similarityEdges
    : [];

  if (!Array.isArray(parser.functions)) {
    addError("parser.functions must be an array.");
  }
  if (!Array.isArray(parser.callEdges)) {
    addError("parser.callEdges must be an array.");
  }
  if (!Array.isArray(embeddings.similarityEdges)) {
    addError("embeddings.similarityEdges must be an array.");
  }

  const functionIds = new Set();
  functions.forEach((fn, index) => {
    if (!fn || typeof fn !== "object") {
      addError(`parser.functions[${index}] must be an object.`);
      return;
    }
    const fnId = fn.id;
    if (typeof fnId !== "string" || fnId.trim().length === 0) {
      addError(`parser.functions[${index}].id must be a non-empty string.`);
    } else {
      functionIds.add(fnId);
    }
    ["filePath", "lang"].forEach((field) => {
      if (typeof fn[field] !== "string" || fn[field].trim().length === 0) {
        addError(`parser.functions[${index}].${field} must be a non-empty string.`);
      }
    });
    ["startLine", "endLine"].forEach((field) => {
      if (!Number.isFinite(fn[field])) {
        addError(`parser.functions[${index}].${field} must be a finite number.`);
      }
    });
  });

  const edgeKey = (source, target) => `${source}→${target}`;
  const edgeIds = new Set();

  callEdges.forEach((edge, index) => {
    if (!edge || typeof edge !== "object") {
      addError(`parser.callEdges[${index}] must be an object.`);
      return;
    }
    const { source, target, weight } = edge;
    if (typeof source !== "string" || source.trim().length === 0) {
      addError(`parser.callEdges[${index}].source must be a non-empty string.`);
    }
    if (typeof target !== "string" || target.trim().length === 0) {
      addError(`parser.callEdges[${index}].target must be a non-empty string.`);
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      addError(`parser.callEdges[${index}].weight must be a positive number.`);
    }
    if (source && !functionIds.has(source)) {
      addError(
        `parser.callEdges[${index}].source references missing function "${source}".`
      );
    }
    const resolutionStatus =
      typeof edge.resolution?.status === "string"
        ? edge.resolution.status.toLowerCase()
        : "resolved";
    const optimisticTarget =
      typeof target === "string" && target.startsWith("external::");
    if (
      target &&
      !functionIds.has(target) &&
      !optimisticTarget &&
      resolutionStatus === "resolved"
    ) {
      addError(
        `parser.callEdges[${index}].target references missing function "${target}".`
      );
    }
    const key = edgeKey(source, target);
    if (edgeIds.has(key)) {
      addError(
        `Duplicate call edge detected for source "${source}" and target "${target}".`
      );
    } else {
      edgeIds.add(key);
    }
  });

  similarityEdges.forEach((edge, index) => {
    if (!edge || typeof edge !== "object") {
      addError(`embeddings.similarityEdges[${index}] must be an object.`);
      return;
    }
    const { source, target, similarity } = edge;
    if (typeof source !== "string" || source.trim().length === 0) {
      addError(`embeddings.similarityEdges[${index}].source must be a non-empty string.`);
    }
    if (typeof target !== "string" || target.trim().length === 0) {
      addError(`embeddings.similarityEdges[${index}].target must be a non-empty string.`);
    }
    if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
      addError(
        `embeddings.similarityEdges[${index}].similarity must be a number between 0 and 1.`
      );
    }
    if (source && !functionIds.has(source)) {
      addError(
        `embeddings.similarityEdges[${index}].source references missing function "${source}".`
      );
    }
    if (target && !functionIds.has(target)) {
      addError(
        `embeddings.similarityEdges[${index}].target references missing function "${target}".`
      );
    }
  });

  // Function embeddings should refer to known functions if present.
  if (Array.isArray(embeddings.functionEmbeddings)) {
    embeddings.functionEmbeddings.forEach((entry, index) => {
      if (entry && typeof entry === "object") {
        const fnId = entry.id;
        if (typeof fnId === "string" && !functionIds.has(fnId)) {
          addError(
            `embeddings.functionEmbeddings[${index}].id references missing function "${fnId}".`
          );
        }
      }
    });
  }

  const isValid = errors.length === 0;
  if (!isValid && throwOnError) {
    const error = new Error("Payload validation failed.");
    error.details = errors;
    throw error;
  }

  return { valid: isValid, errors };
}

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, "utf-8");
  return JSON.parse(contents);
}

async function validateFile(filePath) {
  const payload = await readJson(filePath);
  const result = validatePayload(payload, { throwOnError: false });
  if (!result.valid) {
    const relative = path.relative(process.cwd(), filePath);
    console.error(`❌ ${relative} failed validation:`);
    result.errors.forEach((error) => console.error(`  - ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`✅ ${filePath} is valid.`);
  }
}

async function main(args) {
  if (!args.length) {
    console.error("Usage: node tools/validate-payload.mjs <payload.json> [more.json...]");
    process.exitCode = 1;
    return;
  }
  for (const input of args) {
    const absolute = path.isAbsolute(input)
      ? input
      : path.resolve(process.cwd(), input);
    await validateFile(absolute);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ...cliArgs] = process.argv;
  main(cliArgs).catch((error) => {
    if (error?.details) {
      error.details.forEach((detail) => console.error(`  - ${detail}`));
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}

