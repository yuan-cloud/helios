import assert from 'node:assert/strict';
import { computeFunctionFingerprint } from '../../src/embeddings/persistence.js';

const baseFunctions = [
  {
    id: 'src/app.js:0:120',
    filePath: 'src/app.js',
    name: 'alpha',
    fqName: 'alpha',
    start: 0,
    end: 120,
    source: 'function alpha() { return 1; }',
    lang: 'javascript'
  },
  {
    id: 'src/util.js:50:180',
    filePath: 'src/util.js',
    name: 'beta',
    fqName: 'beta',
    start: 50,
    end: 180,
    source: 'export function beta(x) { return x * 2; }',
    lang: 'javascript'
  }
];

const shuffledFunctions = [...baseFunctions].reverse();

const modifiedFunctions = baseFunctions.map((fn) => ({
  ...fn,
  source: fn.source + '\nconsole.log("debug");'
}));

const emptyFingerprint = await computeFunctionFingerprint([]);
assert.equal(emptyFingerprint, 'fn:0', 'Expected deterministic fingerprint for empty function list');

const fingerprintA = await computeFunctionFingerprint(baseFunctions);
const fingerprintB = await computeFunctionFingerprint(shuffledFunctions);
assert.equal(fingerprintA, fingerprintB, 'Fingerprint should be order independent');

const fingerprintWithChanges = await computeFunctionFingerprint(modifiedFunctions);
assert.notEqual(
  fingerprintA,
  fingerprintWithChanges,
  'Fingerprint should change when function sources change'
);

console.log('persistence.test.mjs passed');

