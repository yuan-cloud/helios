import assert from 'node:assert/strict';
import { validateGraphPayload, printValidationErrors } from '../../src/graph/payload-validator.js';

function buildEnvelope() {
  return {
    parser: {
      functions: [
        {
          id: 'src/foo.ts::foo',
          name: 'foo',
          filePath: 'src/foo.ts',
          lang: 'typescript',
          startLine: 5,
          endLine: 15
        },
        {
          id: 'src/bar.ts::bar',
          name: 'bar',
          filePath: 'src/bar.ts',
          lang: 'typescript',
          startLine: 1,
          endLine: 20
        }
      ],
      callEdges: [
        {
          source: 'src/foo.ts::foo',
          target: 'src/bar.ts::bar',
          weight: 2,
          resolution: { status: 'resolved' }
        }
      ],
      stats: { totalEdges: 1 }
    },
    embeddings: {
      similarityEdges: [
        {
          source: 'src/foo.ts::foo',
          target: 'src/bar.ts::bar',
          similarity: 0.82,
          method: 'topk-avg'
        }
      ],
      metadata: { model: 'test-model', dimension: 384 }
    }
  };
}

function runValidScenario() {
  const envelope = buildEnvelope();
  const result = validateGraphPayload(envelope);

  assert.equal(result.valid, true, printValidationErrors(result.errors));
  assert.equal(result.payload.functions.length, 2);
  assert.equal(result.payload.callEdges.length, 1);
  assert.equal(result.payload.similarityEdges.length, 1);
}

function runInvalidFunctionScenario() {
  const envelope = buildEnvelope();
  envelope.parser.functions[0].id = '';

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.path.includes('callEdges[0].source') && err.message.includes('Unknown function id')),
    `Expected unknown source error but got:\n${printValidationErrors(result.errors)}`
  );
}

function runUnknownEdgeScenario() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges.push({
    source: 'src/missing.ts::missing',
    target: 'src/bar.ts::bar',
    weight: 1
  });

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.message.includes('Unknown function id "src/missing.ts::missing"')),
    `Expected unknown function id error but got:\n${printValidationErrors(result.errors)}`
  );
}

runValidScenario();
runInvalidFunctionScenario();
runUnknownEdgeScenario();

console.log('payload-validator.test.mjs passed');

