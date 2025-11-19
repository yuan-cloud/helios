import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePayload, generatePayloadSchema } from "../../tools/validate-payload.mjs";
import { validateGraphPayload } from "../../src/graph/payload-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSamplePayload() {
  const samplePath = path.resolve(__dirname, "../../docs/payload-sample.json");
  const contents = await fs.readFile(samplePath, "utf-8");
  return JSON.parse(contents);
}

function errorToString(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    return `${error.path || '<root>'}: ${error.message}`;
  }
  return String(error);
}

test("payload sample passes validation", async () => {
  const payload = await loadSamplePayload();
  const result = validatePayload(payload, { throwOnError: false });
  assert.equal(
    result.valid,
    true,
    `Expected payload-sample.json to be valid:\n${result.errors.map(errorToString).join("\n")}`
  );
  assert.ok(result.stats, "Expected stats to be collected");
  assert.equal(result.stats.functionCount, 3, "Expected 3 functions");
});

test("validator detects missing function id", async () => {
  const payload = await loadSamplePayload();
  payload.parser.functions[0].id = "";
  const result = validatePayload(payload, { throwOnError: false });
  assert.equal(result.valid, false, "Expected validation to fail when id missing");
  const errorMessages = result.errors.map(errorToString);
  assert.ok(
    errorMessages.some((msg) => msg.includes("parser.functions[0].id")),
    "Expected missing id error to be reported"
  );
});

test("validator detects invalid similarity range", async () => {
  const payload = await loadSamplePayload();
  if (payload.embeddings?.similarityEdges?.[0]) {
    payload.embeddings.similarityEdges[0].similarity = 1.5; // Invalid: > 1
    const result = validatePayload(payload, { throwOnError: false });
    assert.equal(result.valid, false, "Expected validation to fail when similarity > 1");
    const errorMessages = result.errors.map(errorToString);
    assert.ok(
      errorMessages.some((msg) => msg.includes("similarity") && msg.includes("must be <=")),
      "Expected similarity range error"
    );
  }
});

test("validator detects invalid language", async () => {
  const payload = await loadSamplePayload();
  payload.parser.functions[0].lang = "TypeScript"; // Invalid: should be lowercase
  const result = validatePayload(payload, { throwOnError: false });
  assert.equal(result.valid, false, "Expected validation to fail for invalid language");
  const errorMessages = result.errors.map(errorToString);
  assert.ok(
    errorMessages.some((msg) => msg.includes("lang")),
    "Expected language validation error"
  );
});

test("validator tolerates external:: targets in call edges", async () => {
  const payload = await loadSamplePayload();
  // Add an edge with external target
  if (payload.parser?.callEdges) {
    payload.parser.callEdges.push({
      id: "call::test::func→external::formatCurrency",
      source: payload.parser.functions[0].id,
      target: "external::formatCurrency",
      weight: 1,
      language: "typescript"
    });
    const result = validatePayload(payload, { throwOnError: false });
    // Should not fail validation for external targets
    assert.equal(result.valid, true, "Expected validation to pass with external:: target");
    assert.ok(
      result.stats.externalTargets >= 1,
      "Expected external targets to be counted in stats"
    );
  }
});

test("validator collects statistics", async () => {
  const payload = await loadSamplePayload();
  const result = validateGraphPayload(payload, { collectStats: true });
  assert.ok(result.stats, "Expected stats object");
  assert.equal(typeof result.stats.functionCount, 'number', "Expected functionCount");
  assert.equal(typeof result.stats.callEdgeCount, 'number', "Expected callEdgeCount");
  assert.equal(typeof result.stats.similarityEdgeCount, 'number', "Expected similarityEdgeCount");
});

test("JSON Schema generation", () => {
  const schema = generatePayloadSchema();
  assert.equal(schema.type, 'object', "Schema should be an object type");
  assert.ok(schema.properties.functions, "Schema should have functions property");
  assert.ok(schema.properties.callEdges, "Schema should have callEdges property");
  assert.ok(schema.properties.similarityEdges, "Schema should have similarityEdges property");
  assert.equal(schema.properties.functions.type, 'array', "functions should be array");
  assert.equal(schema.properties.functions.items.type, 'object', "function items should be objects");
});

