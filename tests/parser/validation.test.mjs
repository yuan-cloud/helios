import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateParserPayload } from '../../src/parser/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSample() {
  const samplePath = path.resolve(__dirname, '../../docs/examples/parser-output-sample.json');
  const contents = await readFile(samplePath, 'utf8');
  return JSON.parse(contents);
}

test('accepts the canonical parser output sample', async () => {
  const payload = await loadSample();
  const { valid, errors } = validateParserPayload(payload);
  assert.equal(valid, true, `expected sample payload to be valid but got ${JSON.stringify(errors)}`);
});

test('flags missing required arrays', () => {
  const { valid, errors } = validateParserPayload({});
  assert.equal(valid, false);
  assert.deepEqual(
    errors.map(error => error.path).sort(),
    ['callEdges', 'functions']
  );
});

test('detects duplicate function ids', () => {
  const payload = {
    functions: [
      {
        id: 'dup',
        name: 'first',
        filePath: 'a.js',
        lang: 'javascript',
        startLine: 1,
        endLine: 10
      },
      {
        id: 'dup',
        name: 'second',
        filePath: 'b.js',
        lang: 'javascript',
        startLine: 1,
        endLine: 5
      }
    ],
    callEdges: []
  };
  const { valid, errors } = validateParserPayload(payload);
  assert.equal(valid, false);
  assert(errors.some(error => error.message.includes('Duplicate function id')));
});

test('allows unresolved targets that are not in function ids', () => {
  const payload = {
    functions: [
      {
        id: 'src/foo.js::a',
        name: 'a',
        filePath: 'src/foo.js',
        lang: 'javascript',
        startLine: 1,
        endLine: 5
      }
    ],
    callEdges: [
      {
        source: 'src/foo.js::a',
        target: 'virtual::unknown',
        weight: 1,
        resolution: {
          status: 'unresolved'
        }
      }
    ]
  };
  const { valid, errors } = validateParserPayload(payload);
  assert.equal(valid, true, `expected unresolved edge to be valid but got ${JSON.stringify(errors)}`);
});


