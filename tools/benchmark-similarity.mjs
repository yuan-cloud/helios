#!/usr/bin/env node

/**
 * CLI utility to benchmark exact vs approximate similarity runs.
 *
 * Usage:
 *   node tools/benchmark-similarity.mjs --input path/to/dataset.json [--iterations 3]
 *
 * Dataset format:
 * {
 *   "dimension": 384,
 *   "functions": [...],
 *   "embeddings": [
 *     { "chunk": { "id": "chunk-1", "functionId": "fn-1" }, "vector": [ ... ] }
 *   ]
 * }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildFunctionEmbeddings } from '../src/embeddings/similarity.js';
import { runApproximateBenchmark } from '../src/embeddings/benchmark.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const datasetPath = path.resolve(args.input);
  const raw = JSON.parse(await fs.readFile(datasetPath, 'utf-8'));
  const dataset = normalizeDataset(raw);

  const functionEmbeddings = buildFunctionEmbeddings(dataset);
  if (!functionEmbeddings.length) {
    throw new Error('Dataset produced no function embeddings.');
  }

  const iterations = args.iterations ? Number.parseInt(args.iterations, 10) : 1;
  const approximateConfigs = parseApproximateConfigs(args.approx ?? []);

  const report = runApproximateBenchmark({
    functionEmbeddings,
    exactOptions: {},
    approximateConfigs,
    iterations: Number.isFinite(iterations) ? Math.max(1, iterations) : 1
  });

  printReport(report);
}

function parseArgs(argv) {
  const parsed = {
    approx: []
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--input' || token === '-i') {
      parsed.input = argv[++i];
    } else if (token === '--iterations') {
      parsed.iterations = argv[++i];
    } else if (token === '--approx') {
      parsed.approx.push(argv[++i]);
    } else if (token === '--help' || token === '-h') {
      parsed.help = true;
    }
  }
  return parsed;
}

function parseApproximateConfigs(values) {
  if (!Array.isArray(values) || !values.length) {
    return [];
  }
  const configs = [];
  values.forEach((value) => {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      configs.push(parsed);
    } catch (err) {
      console.warn(`Skipping invalid --approx value: ${value} (${err.message})`);
    }
  });
  return configs;
}

function normalizeDataset(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Dataset must be an object with dimension, functions, and embeddings.');
  }
  const dimension = Number.parseInt(raw.dimension, 10);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error('Dataset is missing a valid dimension.');
  }
  const functions = Array.isArray(raw.functions) ? raw.functions : [];
  const embeddings = Array.isArray(raw.embeddings) ? raw.embeddings : [];

  return {
    dimension,
    functions,
    embeddings: embeddings.map((entry) => ({
      chunk: entry.chunk,
      vector: Float32Array.from(entry.vector ?? [])
    }))
  };
}

function printReport(report) {
  const baseline = report.baseline;
  console.log('=== Baseline (Exact) ===');
  console.log(`Time: ${baseline.elapsedMs.toFixed(3)} ms`);
  console.log(`Edges: ${baseline.edges.length}`);
  printStats(baseline.stats);
  console.log('');

  console.log('=== Approximate Variants ===');
  if (!report.variants.length) {
    console.log('No approximate configurations evaluated (using runtime defaults).');
    return;
  }
  report.variants.forEach((variant) => {
    console.log(`\nVariant: ${variant.name}`);
    console.log(`Config: ${JSON.stringify(variant.config)}`);
    console.log(`Average time: ${variant.averageElapsedMs.toFixed(3)} ms`);
    console.log(`Speedup vs exact: ${variant.speedup.toFixed(2)}x`);
    console.log(`Edges: ${variant.totalApproximateEdges}`);
    console.log(
      `Precision: ${(variant.precision * 100).toFixed(2)}% | Recall: ${(variant.recall * 100).toFixed(
        2
      )}% | F1: ${(variant.f1Score * 100).toFixed(2)}% | Jaccard: ${(variant.jaccard * 100).toFixed(2)}%`
    );
    printStats(variant.stats);
  });
}

function printStats(stats) {
  if (!stats) return;
  console.log(
    `functions=${stats.functionsWithEmbeddings ?? 'n/a'}, candidatePairs=${stats.candidatePairs ?? 'n/a'}, evaluatedPairs=${stats.evaluatedPairs ?? 'n/a'}, finalEdges=${stats.finalEdges ?? 'n/a'}`
  );
}

function printUsage() {
  const scriptPath = fileURLToPath(import.meta.url);
  console.log(`Usage: node ${path.relative(process.cwd(), scriptPath)} --input path/to/dataset.json [--iterations N] [--approx '{\"name\":\"custom\",\"approximateProjectionCount\":16}']`);
}

main().catch((err) => {
  console.error('[benchmark-similarity] Failed:', err);
  process.exitCode = 1;
});

