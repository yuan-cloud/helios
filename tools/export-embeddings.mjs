#!/usr/bin/env node

/**
 * CLI utility to export embeddings from HELIOS SQLite storage for benchmarking.
 *
 * Usage:
 *   node tools/export-embeddings.mjs --db path/to/helios.sqlite3 --output dataset.json
 *
 * The database file can be:
 * - Exported from OPFS in the browser (download the database)
 * - Or a local SQLite file path
 *
 * Output format matches the benchmark CLI input:
 * {
 *   "dimension": 384,
 *   "functions": [...],
 *   "embeddings": [{ "chunk": {...}, "vector": [...] }]
 * }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Try to use better-sqlite3 if available, otherwise provide helpful error
let Database;
try {
  const sqlite3 = await import('better-sqlite3');
  Database = sqlite3.default;
} catch (err) {
  console.error('[export-embeddings] Error: better-sqlite3 not installed.');
  console.error('Install it with: npm install --save-dev better-sqlite3');
  console.error('Or use the browser-based export in the UI (coming soon).');
  process.exitCode = 1;
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.output) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const dbPath = path.resolve(args.db);
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`[export-embeddings] Failed to open database: ${err.message}`);
    console.error(`  Path: ${dbPath}`);
    process.exitCode = 1;
    return;
  }

  try {
    const dataset = await exportDataset(db);
    const outputPath = path.resolve(args.output);
    await fs.writeFile(outputPath, JSON.stringify(dataset, null, 2), 'utf-8');
    console.log(`[export-embeddings] Exported ${dataset.functions.length} functions, ${dataset.embeddings.length} embeddings`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Dimension: ${dataset.dimension}`);
  } catch (err) {
    console.error(`[export-embeddings] Export failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function exportDataset(db) {
  // Query functions with their metadata
  const functions = db
    .prepare(
      `SELECT 
        f.fn_id,
        f.name,
        f.fq_name,
        f.start,
        f.end,
        f.loc,
        f.doc,
        files.path as file_path,
        files.lang
      FROM functions f
      JOIN files ON f.file_id = files.file_id
      ORDER BY f.fn_id`
    )
    .all()
    .map((row) => ({
      id: String(row.fn_id),
      name: row.name,
      fqName: row.fq_name || row.name,
      filePath: row.file_path,
      language: row.lang,
      start: row.start,
      end: row.end,
      loc: row.loc,
      doc: row.doc || null
    }));

  // Query chunks with their embeddings
  const chunkEmbeddings = db
    .prepare(
      `SELECT 
        c.chunk_id,
        c.fn_id,
        c.start,
        c.end,
        c.tok_count,
        e.vec,
        e.dim,
        e.quant,
        e.backend,
        e.model
      FROM chunks c
      JOIN embeddings e ON c.chunk_id = e.chunk_id
      ORDER BY c.chunk_id`
    )
    .all();

  // Determine dimension from first embedding (all should be the same)
  const dimension = chunkEmbeddings.length > 0 ? chunkEmbeddings[0].dim : 384;

  // Convert BLOB vectors to arrays
  const embeddings = chunkEmbeddings.map((row) => {
    // SQLite BLOB is returned as Buffer in Node.js
    const vecBuffer = row.vec;
    let vector;
    if (Buffer.isBuffer(vecBuffer)) {
      // Assume Float32Array was stored as binary
      vector = new Float32Array(
        vecBuffer.buffer,
        vecBuffer.byteOffset,
        vecBuffer.length / Float32Array.BYTES_PER_ELEMENT
      );
    } else if (Array.isArray(vecBuffer)) {
      vector = Float32Array.from(vecBuffer);
    } else {
      throw new Error(`Unexpected vector type: ${typeof vecBuffer}`);
    }

    return {
      chunk: {
        id: `chunk-${row.chunk_id}`,
        functionId: String(row.fn_id),
        start: row.start,
        end: row.end,
        tokCount: row.tok_count
      },
      vector: Array.from(vector) // Convert to plain array for JSON
    };
  });

  return {
    dimension,
    functions,
    embeddings
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--db' || token === '-d') {
      parsed.db = argv[++i];
    } else if (token === '--output' || token === '-o') {
      parsed.output = argv[++i];
    } else if (token === '--help' || token === '-h') {
      parsed.help = true;
    }
  }
  return parsed;
}

function printUsage() {
  const scriptPath = fileURLToPath(import.meta.url);
  console.log(`Usage: node ${path.relative(process.cwd(), scriptPath)} --db path/to/helios.sqlite3 --output dataset.json`);
  console.log('');
  console.log('Options:');
  console.log('  --db, -d     Path to HELIOS SQLite database file');
  console.log('  --output, -o Output JSON file path');
  console.log('  --help, -h   Show this help');
  console.log('');
  console.log('Note: The database file can be exported from OPFS in the browser.');
  console.log('      Install better-sqlite3: npm install --save-dev better-sqlite3');
}

main().catch((err) => {
  console.error('[export-embeddings] Fatal error:', err);
  process.exitCode = 1;
});

