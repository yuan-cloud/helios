# Parser Documentation

**Plan references:** PLAN.md §§3.2, 3.3  
**Agent:** PinkMountain (parser-agent)  
**Status:** Production-ready (all tasks complete except stack-graphs integration, blocked on upstream WASM support)

## 1. Overview

The HELIOS parser extracts functions, imports, exports, and call expressions from source code using Tree-sitter (WASM). It provides the foundation for the call graph construction and subsequent analysis pipeline.

**Key components:**
- `src/parser/parser.js` - Tree-sitter manager (initialization, grammar loading, parsing)
- `src/parser/queries.js` - Tree-sitter query patterns (functions, imports, exports, calls)
- `src/extractors/javascript.js` - JavaScript/TypeScript extractor
- `src/extractors/python.js` - Python extractor
- `src/extractors/call-graph.js` - Call graph builder with enhanced heuristic resolution
- `src/extractors/symbol-table.js` - Symbol table manager for name resolution

**Architecture:**
```
Source Code → Tree-sitter Parser → AST → Query Matches → Extractor → Parser Payload
                                                                    ↓
                                                           Symbol Table Manager
                                                                    ↓
                                                           Call Graph Builder
```

## 2. Supported Languages

Currently supported languages:
- **JavaScript** (`.js`, `.jsx`) - Full support
- **TypeScript** (`.ts`, `.tsx`) - Full support
- **Python** (`.py`) - Full support

**Future languages (v0.4):**
- Go (`.go`)
- Rust (`.rs`)
- Java (`.java`)

## 3. How It Works

### 3.1 Initialization

The parser uses a singleton `parserManager` instance that must be initialized before use:

```javascript
import { parserManager } from './src/parser/parser.js';

// Initialize once (loads web-tree-sitter WASM)
await parserManager.initialize();
```

**What happens during initialization:**
1. Loads `web-tree-sitter` WASM runtime
2. Registers Query constructor (or falls back to deprecated API)
3. Sets up grammar loading mechanism

### 3.2 Language Detection

Language is automatically detected from file extension:

```javascript
const language = parserManager.detectLanguage('src/utils/math.ts');
// Returns: 'typescript'
```

**Supported extensions:**
- `.js`, `.jsx` → `javascript`
- `.ts`, `.tsx` → `typescript`
- `.py` → `python`

### 3.3 Grammar Loading

Grammars are lazily loaded from local WASM files:

```javascript
const language = await parserManager.loadLanguage('javascript');
// Loads: /grammars/tree-sitter-javascript.wasm
```

**Grammar locations:**
- `grammars/tree-sitter-javascript.wasm`
- `grammars/tree-sitter-typescript.wasm`
- `grammars/tree-sitter-python.wasm`

### 3.4 Parsing

Parse source code to get AST:

```javascript
const source = `function add(a, b) { return a + b; }`;
const tree = await parserManager.parse(source, 'javascript', 'src/math.js');
// Returns Tree-sitter Tree object
```

**Important:** Always delete the tree when done to free memory:

```javascript
tree.delete();
```

### 3.5 Extraction

Use language-specific extractors to extract code elements:

```javascript
import { extractJavaScript } from './src/extractors/javascript.js';

const result = await extractJavaScript(source, filePath, language);
// Returns: { functions, exports, imports, calls, filePath }
```

**Extracted elements:**
- **Functions** - Function declarations, methods, arrow functions
- **Exports** - Export statements (default and named)
- **Imports** - Import statements (ESM, CommonJS patterns)
- **Calls** - Function call expressions (direct and member calls)

## 4. Integration Points

### 4.1 Parser → Embeddings Agent

The parser provides function metadata for embedding generation:

```javascript
// Parser output includes function metadata
{
  functions: [
    {
      id: "src/math.js::add",
      name: "add",
      fqName: "math.add",
      filePath: "src/math.js",
      startLine: 1,
      endLine: 5,
      source: "function add(a, b) { ... }",
      // ... other fields
    }
  ]
}
```

**Integration:** Embeddings agent uses `functions[]` array to generate embeddings.

### 4.2 Parser → Graph Agent

The parser provides call edges for graph construction:

```javascript
// Parser output includes call edges
{
  callEdges: [
    {
      id: "call::caller→callee",
      source: "src/caller.js::caller",
      target: "src/callee.js::callee",
      resolution: {
        status: "resolved",
        candidates: [{ id: "...", confidence: 0.9 }]
      },
      // ... other fields
    }
  ]
}
```

**Integration:** Graph agent uses `callEdges[]` array to build Graphology graph.

### 4.3 Parser → Storage Agent

The parser payload is stored in SQLite for persistence:

```javascript
// Parser payload format matches schema
{
  functions: [...],
  callEdges: [...],
  metadata: {
    timestamp: "...",
    schemaVersion: "...",
    // ... other metadata
  }
}
```

**Integration:** Storage agent persists parser output in `analysis_snapshots` table.

### 4.4 Parser → Viz Agent

The parser provides data for visualization:

```javascript
// Viz agent consumes parser output through graph pipeline
// Nodes: functions[] mapped to graph nodes
// Links: callEdges[] mapped to graph links
```

**Integration:** Viz agent renders parser output as 3D graph visualization.

## 5. Payload Format

The parser output follows the schema defined in `docs/payloads.md`:

**Required fields:**
- `functions[]` - Array of function objects
- `callEdges[]` - Array of call edge objects (may be empty)

**Optional fields:**
- `metadata` - Parser metadata (timestamp, version, stats)
- `stats` - Statistics (function counts, edge counts, resolution stats)

**Validation:**
```bash
node tools/validate-parser-output.mjs <parser-output.json>
```

**Sample payload:**
See `docs/examples/parser-output-sample.json`

## 6. Name Resolution

The parser uses enhanced heuristic resolution (PLAN §10.2):

### 6.1 Resolution Strategies

1. **Lexical scope** - Prefers functions defined before calls (closures/nested scopes)
2. **Local matches** - Functions in the same file
3. **Import matches** - Functions imported via module imports
4. **Default exports** - Handles default exports imported with different names
5. **Symbol table** - Uses fully qualified names (FQN) from symbol tables
6. **Module similarity** - Prefers functions from same directory/module
7. **External fallback** - Other functions with same name (lower confidence)

### 6.2 Resolution Status

- **Resolved** - Single high-confidence match
- **Ambiguous** - Multiple matches (2+ candidates)
- **Unresolved** - No matches found (creates virtual node)

### 6.3 Virtual Nodes

Unresolved calls create virtual nodes:

```javascript
{
  id: "virtual:calleeName:src/caller.js",
  name: "calleeName",
  fqName: "[unresolved] calleeName",
  isVirtual: true,
  // ... other fields
}
```

**Purpose:** Track unresolved calls for analysis and debugging.

## 7. Adding New Languages

To add support for a new language (e.g., Go):

### 7.1 Add Grammar WASM

1. Download Tree-sitter grammar WASM file:
   ```bash
   # Build or download tree-sitter-go.wasm
   # Place in grammars/ directory
   ```

2. Update `src/parser/parser.js`:
   ```javascript
   const GRAMMAR_URLS = {
     // ... existing languages
     go: '/grammars/tree-sitter-go.wasm'
   };
   
   const LANGUAGE_MAP = {
     // ... existing extensions
     '.go': 'go'
   };
   ```

### 7.2 Create Query Patterns

Create `src/extractors/go.js`:

```javascript
export const GO_QUERIES = {
  functions: `
    (function_declaration
      name: (identifier) @name) @func
  `,
  imports: `
    (import_declaration) @import
  `,
  calls: `
    (call_expression
      function: (identifier) @callee) @call
  `
};
```

### 7.3 Create Extractor

Create extractor function similar to `extractJavaScript`:

```javascript
export async function extractGo(source, filePath, language) {
  const tree = await parserManager.parse(source, 'go', filePath);
  // ... extract functions, imports, calls
  return { functions, imports, calls, filePath };
}
```

### 7.4 Update Main Extraction Logic

Update `index.html` or main extraction function to handle new language:

```javascript
if (language === 'go') {
  return await extractGo(source, filePath, language);
}
```

### 7.5 Add Tests

Create `tests/extractors/go.test.mjs` with test cases for the new language.

## 8. Testing

### 8.1 Unit Tests

**Parser tests:**
```bash
node --test tests/parser/*.test.mjs
```

**Extractor tests:**
```bash
node --test tests/extractors/*.test.mjs
```

### 8.2 Validation

**Validate parser output:**
```bash
node tools/validate-parser-output.mjs <output.json>
```

**Validate against payload schema:**
```bash
node tools/validate-payload.mjs <payload.json>
```

### 8.3 Regression Testing

**Run regression tests:**
```bash
node tools/regression-test.mjs
```

**Golden repos:**
- `tests/golden-repos/simple-web-app/`
- `tests/golden-repos/mixed-language-api/`
- `tests/golden-repos/typescript-library/`

## 9. Troubleshooting

### 9.1 Common Issues

**Issue: "Grammar load failed"**
- **Cause:** Grammar WASM file not found or invalid
- **Fix:** Verify grammar file exists in `grammars/` directory and is valid WASM

**Issue: "Query constructor not found"**
- **Cause:** Query constructor not registered
- **Fix:** Parser falls back to deprecated `language.query()` - this is okay, but less efficient

**Issue: "Language not detected"**
- **Cause:** File extension not in `LANGUAGE_MAP`
- **Fix:** Add extension to `LANGUAGE_MAP` in `src/parser/parser.js`

**Issue: "Parse failed"**
- **Cause:** Invalid syntax or unsupported language features
- **Fix:** Tree-sitter grammars may not support all language features - check grammar documentation

### 9.2 Debug Mode

Enable debug logging:

```javascript
// In browser console
localStorage.setItem('debug', 'parser*');
```

**Logs:**
- `[TreeSitter]` - Initialization and grammar loading
- `[Queries]` - Query compilation
- `[Extractor]` - Extraction progress

### 9.3 Performance Issues

**Large files:**
- Tree-sitter is fast but very large files (>10k LOC) may take time
- Consider chunking large files or showing progress indicators

**Many files:**
- Parse files in parallel using workers (future enhancement)
- Current implementation parses sequentially

**Memory:**
- Always call `tree.delete()` after parsing
- Clear parser cache if needed: `parserManager.cleanup()`

## 10. Performance Considerations

### 10.1 Initialization

- **First init:** ~100-200ms (loads WASM runtime)
- **Subsequent:** Cached, near-instant

### 10.2 Grammar Loading

- **First load:** ~50-100ms per grammar (downloads WASM)
- **Subsequent:** Cached, near-instant

### 10.3 Parsing

- **Small files (<100 LOC):** <1ms
- **Medium files (100-1000 LOC):** 1-10ms
- **Large files (1000-10000 LOC):** 10-100ms

### 10.4 Extraction

- **Extraction overhead:** ~0.5-2ms per file (query execution + processing)

**Overall:** Parsing is fast enough for real-time use on repos up to ~5000 functions.

## 11. Future Enhancements

**Planned (post-MVP):**
- Stack-graphs integration (blocked on upstream WASM build)
- Additional language support (Go, Rust, Java)
- Worker pool for parallel parsing
- Incremental parsing (parse only changed files)
- Type-aware resolution (TypeScript type information)

**Stack-graphs status:**
- Currently blocked on upstream WASM-capable build
- Enhanced heuristic resolution provides good baseline accuracy
- See PLAN.md §89 for details

## 12. Related Documentation

- **Payload schema:** `docs/payloads.md`
- **Testing guide:** `docs/TESTING.md`
- **Regression testing:** `docs/regression-testing.md`
- **Storage integration:** `docs/storage.md`
- **Architecture:** `PLAN.md` §§3.2, 3.3

## 13. API Reference

### `parserManager`

**Methods:**
- `initialize()` - Initialize Tree-sitter (loads WASM)
- `detectLanguage(filePath)` - Detect language from file path
- `loadLanguage(language)` - Load grammar WASM (lazy)
- `parse(source, language, filePath)` - Parse source to AST
- `cleanup()` - Clear caches and free resources

### Extractors

**JavaScript/TypeScript:**
- `extractJavaScript(source, filePath, language)` - Extract JS/TS elements

**Python:**
- `extractPython(source, filePath, language)` - Extract Python elements

### Call Graph Builder

- `buildCallGraph(functions, allCalls, symbolTableManager)` - Build call graph with resolution

### Symbol Table Manager

- `SymbolTableManager` - Manages per-file symbol tables
- `SymbolTable` - Per-file symbol table

**See source code for detailed API documentation.**
