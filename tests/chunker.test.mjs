import assert from 'node:assert/strict';
import { chunkFunction, chunkFunctions } from '../src/embeddings/chunker.js';

function createFunctionFixture(source) {
  return {
    id: 'file.js:0:0',
    name: 'fixture',
    filePath: 'src/file.js',
    lang: 'javascript',
    start: 0,
    end: source.length,
    startLine: 1,
    endLine: source.split('\n').length,
    startColumn: 0,
    endColumn: 0,
    source
  };
}

const source = `
function example(value) {
  if (!value) {
    return null;
  }

${Array.from({ length: 30 }, (_, index) => `  const field${index} = value.map(entry => entry.field${index}).filter(Boolean);\n`).join('')}

  for (const entry of value) {
    console.log(entry);
  }

  return value.join(',');
}
`.trimStart();

const func = createFunctionFixture(source);
const chunks = chunkFunction(func, { maxTokens: 40, minTokens: 10 });

assert.ok(chunks.length >= 2, 'Expected chunking to split function into multiple chunks');
assert.equal(chunks[0].start, func.start, 'First chunk should align with function start');
assert.equal(chunks[chunks.length - 1].end, func.start + func.source.length, 'Last chunk should reach function end');

chunks.forEach(chunk => {
  assert.ok(chunk.text.length > 0, 'Chunk text should not be empty');
  assert.ok(chunk.tokenCount > 0, 'Chunk should contain tokens');
  assert.ok(
    chunk.start >= func.start && chunk.end <= func.start + func.source.length,
    'Chunk spans must stay within function bounds'
  );
});

const { stats } = chunkFunctions([func], { maxTokens: 40, minTokens: 10 });
assert.equal(stats.processedFunctions, 1, 'Expected stats to count processed functions');
assert.equal(stats.chunkCount, chunks.length, 'Chunk stats should match chunk count');

console.log('chunker.test.mjs passed');

