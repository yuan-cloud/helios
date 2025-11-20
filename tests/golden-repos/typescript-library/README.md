# Golden Repo: TypeScript Library

## Source

**Synthetic baseline** - Representative of a larger TypeScript library or framework.

## Characteristics

- **Functions**: 280
- **Call edges**: 224
- **Languages**: JavaScript, TypeScript, Python
- **Size**: Large (~250-350 functions)
- **Complexity**: Medium to high

## Purpose

This golden repo baseline represents a larger TypeScript project:
- TypeScript-heavy codebase
- Library or framework-like structure
- More complex call graph patterns
- Good for testing parser performance and accuracy on larger codebases

## Key Features

- **Module structure**: utils, api, components, lib, services, models, helpers
- **TypeScript focus**: More TypeScript functions
- **Resolution rates**: Mix of resolved, ambiguous, and unresolved edges
- **Call patterns**: Complex within-module and cross-module dependencies
- **Top central nodes**: 10 nodes by PageRank for regression testing

## Usage

```bash
# Run regression test
node tools/regression-test.mjs tests/golden-repos/typescript-library/baseline.json
```

## Baseline Generation

Generated using `tools/generate-golden-repo-baseline.mjs`:
- Parser payload format matches `docs/payloads.md` schema
- Metadata includes expected counts and top central nodes
- Stats include resolution rates (resolved/ambiguous/unresolved)

## Regression Metrics

The regression test validates:
1. Function count: 280
2. Call edge count: 224
3. Top central nodes: 10 nodes by PageRank
4. Resolution statistics: resolved/ambiguous/unresolved edge counts
5. Language distribution: JavaScript, TypeScript, Python

