# Golden Repo: Mixed Language API

## Source

**Synthetic baseline** - Representative of a medium-sized API with mixed JavaScript/TypeScript/Python.

## Characteristics

- **Functions**: 200
- **Call edges**: 160
- **Languages**: JavaScript, TypeScript, Python
- **Size**: Medium (~200-300 functions)
- **Complexity**: Medium

## Purpose

This golden repo baseline represents a typical API project with multiple languages:
- JavaScript/TypeScript frontend/API layer
- Python backend/services
- Cross-language call patterns
- More complex call graph than simple web app

## Key Features

- **Module structure**: utils, api, components, lib, services, models, helpers
- **Multi-language**: JavaScript, TypeScript, Python mixing
- **Resolution rates**: Mix of resolved, ambiguous, and unresolved edges
- **Call patterns**: Within-module, cross-module, and cross-language calls
- **Top central nodes**: 10 nodes by PageRank for regression testing

## Usage

```bash
# Run regression test
node tools/regression-test.mjs tests/golden-repos/mixed-language-api/baseline.json
```

## Baseline Generation

Generated using `tools/generate-golden-repo-baseline.mjs`:
- Parser payload format matches `docs/payloads.md` schema
- Metadata includes expected counts and top central nodes
- Stats include resolution rates (resolved/ambiguous/unresolved)

## Regression Metrics

The regression test validates:
1. Function count: 200
2. Call edge count: 160
3. Top central nodes: 10 nodes by PageRank
4. Resolution statistics: resolved/ambiguous/unresolved edge counts
5. Language distribution: JavaScript, TypeScript, Python

