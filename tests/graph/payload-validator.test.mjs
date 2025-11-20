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

function runInvalidCandidatesNotArray() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges[0].resolution.candidates = 'not an array';

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.path.includes('resolution.candidates') && err.message.includes('must be an array')),
    `Expected candidates array error but got:\n${printValidationErrors(result.errors)}`
  );
}

function runInvalidCandidateMissingId() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges[0].resolution.candidates = [{ confidence: 0.9 }];

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.path.includes('candidates[0].id')),
    `Expected missing id error but got:\n${printValidationErrors(result.errors)}`
  );
}

function runInvalidCandidateInvalidConfidence() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges[0].resolution.candidates = [
    { id: 'src/bar.ts::bar', confidence: 'high' }
  ];

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.path.includes('candidates[0].confidence')),
    `Expected invalid confidence error but got:\n${printValidationErrors(result.errors)}`
  );
}

function runInvalidCandidateConfidenceOutOfRange() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges[0].resolution.candidates = [
    { id: 'src/bar.ts::bar', confidence: 1.5 }
  ];

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(err => err.path.includes('candidates[0].confidence')),
    `Expected confidence out of range error but got:\n${printValidationErrors(result.errors)}`
  );
}

function runValidCandidates() {
  const envelope = buildEnvelope();
  envelope.parser.callEdges[0].resolution.candidates = [
    { id: 'src/bar.ts::bar', confidence: 0.92 },
    { id: 'src/baz.ts::baz', confidence: 0.75 }
  ];

  const result = validateGraphPayload(envelope);
  assert.equal(result.valid, true, printValidationErrors(result.errors));
}

runValidScenario();
runInvalidFunctionScenario();
runUnknownEdgeScenario();
runInvalidCandidatesNotArray();
runInvalidCandidateMissingId();
runInvalidCandidateInvalidConfidence();
runInvalidCandidateConfidenceOutOfRange();
runValidCandidates();

console.log('payload-validator.test.mjs passed');

