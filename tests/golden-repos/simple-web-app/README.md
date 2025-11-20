# Golden Repo: Simple Web App

## Source

**Synthetic baseline** - Representative of a small web application with JavaScript/TypeScript.

## Characteristics

- **Functions**: 120
- **Call edges**: 96
- **Languages**: JavaScript, TypeScript, Python
- **Size**: Small (~100-200 functions)
- **Complexity**: Low to medium

## Purpose

This golden repo baseline represents a typical small web application:
- Mixed JavaScript/TypeScript codebase
- Simple call graph structure
- Representative of MVP or early-stage projects
- Good for testing parser accuracy on common patterns

## Key Features

- **Module structure**: utils, api, components, lib, services, models, helpers
- **Resolution rates**: Mix of resolved, ambiguous, and unresolved edges
- **Call patterns**: Within-module and cross-module calls
- **Top central nodes**: 10 nodes by PageRank for regression testing

## Usage

```bash
# Run regression test
node tools/regression-test.mjs tests/golden-repos/simple-web-app/baseline.json
```

## Baseline Generation

Generated using `tools/generate-golden-repo-baseline.mjs`:
- Parser payload format matches `docs/payloads.md` schema
- Metadata includes expected counts and top central nodes
- Stats include resolution rates (resolved/ambiguous/unresolved)

## Regression Metrics

The regression test validates:
1. Function count: 120
2. Call edge count: 96
3. Top central nodes: 10 nodes by PageRank
4. Resolution statistics: resolved/ambiguous/unresolved edge counts
5. Language distribution: JavaScript, TypeScript, Python

