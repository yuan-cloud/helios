# Graph Payload Validation Helper

Plan references: PLAN.md §§3.6, 3.7, 10.4  
Tooling: `src/graph/payload-validator.js`, `tools/validate-payload.mjs`

## Overview

To keep the parser → graph → viz contract tight, we ship a reusable validator that
checks payload envelopes before wiring them into workers or UI.

It normalises any envelope via `mergeGraphPayload`, enforces the requirements documented in `docs/payloads.md`, and reports structured errors so each agent can fix schema mismatches quickly.

## CLI Usage

```
node tools/validate-payload.mjs --input path/to/payload.json [--strict]
```

- Accepts either the high-level envelope (`{ parser, embeddings, overrides }`) or a merged payload (`{ functions, callEdges, similarityEdges }`).
- Returns exit code `0` when valid, `1` on schema errors, `2` for usage issues.
- `--strict` warns when unexpected top-level keys are present in the merged payload.

### Example

```
node tools/validate-payload.mjs --input fixtures/sample-envelope.json
```

Output:

```
✅ Payload valid (134 functions, 280 call edges, 420 similarity edges).
```

When errors are found:

```
❌ Payload validation failed:

functions[12].id: Required string field is missing.
callEdges[3].source: Unknown function id "src/utils/missing.ts::helper".
```

## Programmatic API

```js
import { validateGraphPayload } from '../src/graph/payload-validator.js';

const { valid, errors, payload } = validateGraphPayload(envelope);

if (!valid) {
  errors.forEach(err => console.error(err));
}
```

The returned `payload` is always a cloned/normalised structure that matches the merged shape.  
Use `printValidationErrors(errors)` for a human-readable string.

## Integration Tips

- Parser agent: run the validator before emitting payloads from workers; the error list points directly at missing ids / metadata.
- Graph agent: use the CLI on recorded payload dumps (`window.heliosGraphPayload`, resume snapshots, etc.) before wiring worker plumbing.
- Viz agent: quickly confirm loader inputs by validating the combined envelope the loader receives.

The CLI and API are lightweight (pure JS, no extra deps) and can be embedded in unit tests or CI scripts as needed.


