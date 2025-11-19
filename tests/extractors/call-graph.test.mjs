import test from "node:test";
import assert from "node:assert/strict";
import { buildCallGraph } from "../../src/extractors/call-graph.js";
import { SymbolTableManager } from "../../src/extractors/symbol-table.js";
import { validateGraphPayload } from "../../src/graph/payload-validator.js";

/**
 * Test that buildCallGraph output matches the payload schema format
 * from docs/payloads.md section 3 (Call Edges)
 */

test("buildCallGraph output matches payload schema format", async () => {
  // Create sample functions (with start/end byte indices and startLine/endLine per payload schema)
  // start/end are byte indices, used for findContainingFunction
  const functions = [
    {
      id: "src/file1.js::foo",
      name: "foo",
      filePath: "src/file1.js",
      start: 0,    // Byte index
      end: 500,    // Byte index
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    },
    {
      id: "src/file1.js::bar",
      name: "bar",
      filePath: "src/file1.js",
      start: 600,  // Byte index
      end: 1000,   // Byte index
      startLine: 7,
      endLine: 10,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    },
    {
      id: "src/file2.js::baz",
      name: "baz",
      filePath: "src/file2.js",
      start: 0,    // Byte index
      end: 500,    // Byte index
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    }
  ];

  // Create sample call expressions (with start/end byte indices and startLine/endLine per schema)
  // Call must have start/end within containing function's range
  const allCalls = [
    {
      filePath: "src/file1.js",
      callee: "bar",
      start: 100,   // Byte index (within foo function 0-500)
      end: 105,     // Byte index
      startLine: 3,
      endLine: 3,
      startColumn: 4,
      endColumn: 7,
      context: "inside foo",
      language: "javascript"
    },
    {
      filePath: "src/file1.js",
      callee: "bar",
      start: 700,   // Byte index (within bar function 600-1000)
      end: 705,     // Byte index
      startLine: 8,
      endLine: 8,
      startColumn: 2,
      endColumn: 5,
      context: "another call",
      language: "javascript"
    },
    {
      filePath: "src/file2.js",
      callee: "foo",
      start: 100,   // Byte index (within baz function 0-500)
      end: 103,     // Byte index
      startLine: 2,
      endLine: 2,
      startColumn: 0,
      endColumn: 3,
      language: "javascript"
    }
  ];

  const symbolTableManager = new SymbolTableManager();
  
  // Build symbol tables for files
  const table1 = symbolTableManager.getTable("src/file1.js");
  table1.addSymbol("bar", "src/file1.js::bar");
  table1.registerFunction(functions[1]); // Register bar function
  
  // Register all functions in file1 for resolution
  table1.registerFunction(functions[0]); // foo
  table1.registerFunction(functions[1]); // bar
  
  const table2 = symbolTableManager.getTable("src/file2.js");
  table2.addSymbol("foo", "src/file1.js::foo");
  table2.addImport("foo", { from: "src/file1.js", originalName: "foo" });

  // Build call graph
  const result = buildCallGraph(functions, allCalls, symbolTableManager);

  // Verify structure
  assert.ok(result, "buildCallGraph should return a result");
  assert.ok(Array.isArray(result.nodes), "nodes should be an array");
  assert.ok(Array.isArray(result.edges), "edges should be an array");
  assert.equal(result.nodes.length, 3, "should have 3 nodes");
  assert.ok(result.edges.length > 0, "should have at least one edge");

  // Verify edge format matches payload schema
  const edge = result.edges[0];
  assert.ok(edge, "should have at least one edge");
  
  // Required fields
  assert.ok(typeof edge.source === 'string', "edge.source should be a string");
  assert.ok(typeof edge.target === 'string', "edge.target should be a string");
  assert.ok(typeof edge.weight === 'number' && edge.weight >= 1, "edge.weight should be a number >= 1");

  // Recommended fields per schema
  if (edge.id) {
    assert.ok(typeof edge.id === 'string', "edge.id should be a string if present");
    assert.ok(edge.id.startsWith("call::"), "edge.id should start with 'call::'");
  }

  if (edge.isDynamic !== undefined) {
    assert.equal(typeof edge.isDynamic, 'boolean', "edge.isDynamic should be a boolean if present");
  }

  if (edge.language) {
    assert.ok(typeof edge.language === 'string', "edge.language should be a string if present");
  }

  // Verify callSites format (top-level, not in metadata)
  if (edge.callSites) {
    assert.ok(Array.isArray(edge.callSites), "edge.callSites should be an array");
    if (edge.callSites.length > 0) {
      const callSite = edge.callSites[0];
      assert.ok(typeof callSite.filePath === 'string', "callSite.filePath should be a string");
      assert.ok(typeof callSite.line === 'number', "callSite.line should be a number");
      assert.ok(typeof callSite.column === 'number', "callSite.column should be a number");
      // context is optional
      if (callSite.context !== undefined) {
        assert.ok(typeof callSite.context === 'string', "callSite.context should be a string if present");
      }
    }
  }

  // Verify resolution format (top-level, not in metadata)
  if (edge.resolution) {
    assert.ok(typeof edge.resolution === 'object', "edge.resolution should be an object if present");
    assert.ok(['resolved', 'ambiguous', 'unresolved'].includes(edge.resolution.status),
      "edge.resolution.status should be one of: resolved, ambiguous, unresolved");
    
    if (edge.resolution.reason !== undefined) {
      assert.ok(typeof edge.resolution.reason === 'string' || edge.resolution.reason === null,
        "edge.resolution.reason should be a string or null");
    }

    // Verify candidates format: { id, confidence }
    if (edge.resolution.candidates) {
      assert.ok(Array.isArray(edge.resolution.candidates), "edge.resolution.candidates should be an array if present");
      if (edge.resolution.candidates.length > 0) {
        const candidate = edge.resolution.candidates[0];
        assert.ok(typeof candidate.id === 'string', "candidate.id should be a string");
        assert.ok(typeof candidate.confidence === 'number', "candidate.confidence should be a number");
        assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1,
          "candidate.confidence should be between 0 and 1");
      }
    }

    // Verify importInfo format if present
    if (edge.resolution.importInfo) {
      assert.ok(typeof edge.resolution.importInfo === 'object', "edge.resolution.importInfo should be an object if present");
    }
  }

  // Verify callSites and resolution are NOT nested in metadata
  assert.ok(!edge.metadata || !edge.metadata.callSites, 
    "callSites should NOT be nested in metadata (should be top-level)");
  assert.ok(!edge.metadata || !edge.metadata.resolution, 
    "resolution should NOT be nested in metadata (should be top-level)");
});

test("buildCallGraph output validates against payload validator", async () => {
  const functions = [
    {
      id: "src/test.js::main",
      name: "main",
      filePath: "src/test.js",
      start: 0,     // Byte index
      end: 1000,    // Byte index
      startLine: 1,
      endLine: 10,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    },
    {
      id: "src/test.js::helper",
      name: "helper",
      filePath: "src/test.js",
      start: 1200,  // Byte index
      end: 1500,    // Byte index
      startLine: 12,
      endLine: 15,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    }
  ];

  const allCalls = [
    {
      filePath: "src/test.js",
      callee: "helper",
      start: 500,   // Byte index (within main function 0-1000)
      end: 508,     // Byte index
      startLine: 5,
      endLine: 5,
      startColumn: 2,
      endColumn: 8,
      language: "javascript"
    }
  ];

  const symbolTableManager = new SymbolTableManager();
  const table = symbolTableManager.getTable("src/test.js");
  table.addSymbol("helper", "src/test.js::helper");
  table.registerFunction(functions[1]); // Register helper function

  const result = buildCallGraph(functions, allCalls, symbolTableManager);

  // Create a payload envelope format (as expected by validator)
  const payload = {
    functions: result.nodes,
    callEdges: result.edges,
    similarityEdges: []
  };

  // Validate against payload validator
  const validation = validateGraphPayload(payload, { collectStats: true });

  assert.equal(validation.valid, true, 
    `buildCallGraph output should validate against payload validator. Errors: ${JSON.stringify(validation.errors, null, 2)}`);
  assert.ok(validation.stats, "validation should include stats");
  assert.equal(validation.stats.functionCount, 2, "should have 2 functions");
  assert.equal(validation.stats.callEdgeCount, 1, "should have 1 call edge");
  assert.equal(validation.stats.resolvedCallEdges, 1, "should have 1 resolved call edge");
});

test("buildCallGraph handles resolved edges with candidates format", async () => {
  const functions = [
    {
      id: "src/a.js::caller",
      name: "caller",
      filePath: "src/a.js",
      start: 0,     // Byte index
      end: 500,     // Byte index
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    },
    {
      id: "src/b.js::target",
      name: "target",
      filePath: "src/b.js",
      start: 0,     // Byte index
      end: 500,     // Byte index
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    }
  ];

  const allCalls = [
    {
      filePath: "src/a.js",
      callee: "target",
      start: 200,   // Byte index (within caller function 0-500)
      end: 210,     // Byte index
      startLine: 3,
      endLine: 3,
      startColumn: 4,
      endColumn: 10,
      language: "javascript"
    }
  ];

  const symbolTableManager = new SymbolTableManager();
  // Add import resolution
  const tableA = symbolTableManager.getTable("src/a.js");
  tableA.addSymbol("target", "src/b.js::target");
  tableA.addImport("target", "src/b.js", "target");
  
  const tableB = symbolTableManager.getTable("src/b.js");
  tableB.registerFunction(functions[1]); // Register target function

  const result = buildCallGraph(functions, allCalls, symbolTableManager);

  // Find the resolved edge
  const edge = result.edges.find(e => e.source === "src/a.js::caller" && e.target === "src/b.js::target");
  assert.ok(edge, "should have a resolved edge");

  // Verify resolution structure
  if (edge.resolution) {
    assert.equal(edge.resolution.status, "resolved", "should be resolved");
    
    // For resolved edges, candidates should be an array with a single candidate
    if (edge.resolution.candidates) {
      assert.ok(Array.isArray(edge.resolution.candidates), "candidates should be an array");
      assert.equal(edge.resolution.candidates.length, 1, "resolved edge should have 1 candidate");
      
      const candidate = edge.resolution.candidates[0];
      assert.equal(candidate.id, "src/b.js::target", "candidate.id should match target");
      assert.ok(typeof candidate.confidence === 'number' && candidate.confidence > 0.5,
        "candidate.confidence should be high for resolved edges");
    }
  }
});

test("buildCallGraph edge IDs follow schema format", async () => {
  const functions = [
    {
      id: "src/test.js::a",
      name: "a",
      filePath: "src/test.js",
      start: 0,     // Byte index
      end: 500,     // Byte index
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    },
    {
      id: "src/test.js::b",
      name: "b",
      filePath: "src/test.js",
      start: 600,   // Byte index
      end: 1000,    // Byte index
      startLine: 7,
      endLine: 10,
      startColumn: 0,
      endColumn: 10,
      lang: "javascript",
      params: []
    }
  ];

  const allCalls = [
    {
      filePath: "src/test.js",
      callee: "b",
      start: 200,   // Byte index (within a function 0-500)
      end: 203,     // Byte index
      startLine: 3,
      endLine: 3,
      startColumn: 2,
      endColumn: 3,
      language: "javascript"
    }
  ];

  const symbolTableManager = new SymbolTableManager();
  const table = symbolTableManager.getTable("src/test.js");
  table.addSymbol("b", "src/test.js::b");
  table.registerFunction(functions[1]); // Register b function

  const result = buildCallGraph(functions, allCalls, symbolTableManager);

  // Verify all edges have IDs in the format "call::source→target"
  result.edges.forEach(edge => {
    if (edge.id) {
      assert.ok(edge.id.startsWith("call::"), 
        `edge.id should start with "call::", got: ${edge.id}`);
      assert.ok(edge.id.includes("→"), 
        `edge.id should contain "→" separator, got: ${edge.id}`);
      
      // Verify ID format matches source and target
      const idParts = edge.id.replace("call::", "").split("→");
      assert.equal(idParts.length, 2, `edge.id should have format "call::source→target", got: ${edge.id}`);
      assert.equal(idParts[0], edge.source, `edge.id source should match edge.source, got: ${edge.id}`);
      assert.equal(idParts[1], edge.target, `edge.id target should match edge.target, got: ${edge.id}`);
    }
  });
});

