import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePayload } from "../../tools/validate-payload.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSamplePayload() {
  const samplePath = path.resolve(__dirname, "../../docs/payload-sample.json");
  const contents = await fs.readFile(samplePath, "utf-8");
  return JSON.parse(contents);
}

test("payload sample passes validation", async () => {
  const payload = await loadSamplePayload();
  const result = validatePayload(payload, { throwOnError: false });
  assert.equal(
    result.valid,
    true,
    `Expected payload-sample.json to be valid:\n${result.errors.join("\n")}`
  );
});

test("validator detects missing function id", async () => {
  const payload = await loadSamplePayload();
  payload.parser.functions[0].id = "";
  const result = validatePayload(payload, { throwOnError: false });
  assert.equal(result.valid, false, "Expected validation to fail when id missing");
  assert.ok(
    result.errors.some((message) => message.includes("parser.functions[0].id")),
    "Expected missing id error to be reported"
  );
});

