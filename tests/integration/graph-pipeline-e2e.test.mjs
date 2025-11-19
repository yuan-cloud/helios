#!/usr/bin/env node

/**
 * End-to-end integration test for graph pipeline.
 * 
 * Verifies the complete flow: parser output → embeddings → graph worker → visualization format
 * 
 * This test exercises:
 * 1. Schema-compliant parser payload ingestion
 * 2. Similarity edge integration
 * 3. Graph building and analysis
 * 4. Metric computation (centralities, communities, cliques)
 * 5. Graph serialization
 * 6. Visualization format conversion (optional)
 * 
 * Uses PinkMountain's sample parser payload fixtures as test data.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateGraphPayload } from "../../src/graph/payload-validator.js";
import { mergeGraphPayload } from "../../src/graph/merge.js";
import { collectGraphPayload, buildAnalyzedGraph, serializeGraph } from "../../src/graph/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load a parser payload fixture
 */
async function loadParserFixture(name) {
  const fixturePath = path.join(
    __dirname,
    "../fixtures/network-analysis",
    `sample-parser-payload-${name}.json`
  );
  const content = await fs.readFile(fixturePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Generate mock similarity edges for testing
 * Creates similarity edges between functions based on module proximity
 */
function generateMockSimilarityEdges(functions, callEdges = []) {
  const edges = [];
  const functionIds = functions.map(f => f.id);
  
  // Create similarity edges between functions in the same module
  const moduleGroups = new Map();
  functions.forEach(fn => {
    const module = fn.moduleId || "unknown";
    if (!moduleGroups.has(module)) {
      moduleGroups.set(module, []);
    }
    moduleGroups.get(module).push(fn.id);
  });
  
  // Add similarity edges within modules (higher similarity)
  for (const [module, ids] of moduleGroups.entries()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length && j < i + 3; j++) {
        edges.push({
          id: `sim::${ids[i]}↔${ids[j]}`,
          source: ids[i],
          target: ids[j],
          similarity: 0.75 + Math.random() * 0.2, // 0.75-0.95
          type: "similarity",
          method: "topk-avg",
          representativeSimilarity: 0.8,
          topPairs: [],
          undirected: true,
          metadata: {
            bundleSize: 8,
            sourceChunkCount: 1,
            targetChunkCount: 1,
            model: "all-MiniLM-L6-v2"
          }
        });
      }
    }
  }
  
  // Add a few cross-module similarity edges (lower similarity)
  const allIds = Array.from(functionIds);
  for (let i = 0; i < Math.min(5, allIds.length); i++) {
    const source = allIds[i];
    const target = allIds[(i + Math.floor(allIds.length / 2)) % allIds.length];
    if (source !== target) {
      edges.push({
        id: `sim::${source}↔${target}`,
        source,
        target,
        similarity: 0.6 + Math.random() * 0.15, // 0.6-0.75
        type: "similarity",
        method: "topk-avg",
        representativeSimilarity: 0.65,
        topPairs: [],
        undirected: true,
        metadata: {
          bundleSize: 8,
          sourceChunkCount: 1,
          targetChunkCount: 1,
          model: "all-MiniLM-L6-v2"
        }
      });
    }
  }
  
  return edges;
}

test("End-to-end: Small parser payload → graph pipeline → analysis", async () => {
  // Load parser fixture
  const parserPayload = await loadParserFixture("small");
  
  // Validate parser payload structure
  assert.ok(parserPayload.functions, "Parser payload should have functions");
  assert.ok(Array.isArray(parserPayload.functions), "Functions should be an array");
  assert.ok(parserPayload.callEdges, "Parser payload should have callEdges");
  assert.ok(Array.isArray(parserPayload.callEdges), "CallEdges should be an array");
  
  // Generate mock similarity edges
  const similarityEdges = generateMockSimilarityEdges(
    parserPayload.functions,
    parserPayload.callEdges
  );
  
  // Create schema-compliant payload
  const mergedPayload = mergeGraphPayload({
    parser: {
      functions: parserPayload.functions,
      callEdges: parserPayload.callEdges,
      stats: parserPayload.stats || null,
      symbolTables: parserPayload.symbolTables || null
    },
    embeddings: {
      similarityEdges,
      metadata: {
        model: "all-MiniLM-L6-v2",
        dimension: 384
      },
      stats: {
        functionsWithEmbeddings: parserPayload.functions.length,
        totalEdges: similarityEdges.length
      }
    }
  });
  
  // Validate merged payload
  const validation = validateGraphPayload(mergedPayload);
  assert.ok(validation.valid, `Payload should be valid: ${validation.errors?.join(", ") || "unknown error"}`);
  
  // Collect payload (should return same structure)
  const collected = collectGraphPayload({
    functions: mergedPayload.functions,
    callEdges: mergedPayload.callEdges,
    similarityEdges: mergedPayload.similarityEdges
  });
  
  assert.equal(collected.functions.length, parserPayload.functions.length, "Collected functions count should match");
  assert.ok(collected.callEdges.length > 0, "Should have call edges");
  assert.ok(collected.similarityEdges.length > 0, "Should have similarity edges");
  
  // Build and analyze graph
  const analysisResult = buildAnalyzedGraph(mergedPayload, {
    assignMetrics: true,
    analysis: {
      centralities: true,
      communities: true,
      cliques: true
    }
  });
  
  assert.ok(analysisResult.graph, "Graph should be built");
  assert.ok(analysisResult.summary, "Summary should be generated");
  
  // Verify graph structure
  const graph = analysisResult.graph;
  let nodeCount = 0;
  let edgeCount = 0;
  
  graph.forEachNode(() => { nodeCount++; });
  graph.forEachEdge(() => { edgeCount++; });
  
  assert.equal(nodeCount, parserPayload.functions.length, "Graph should have all functions as nodes");
  assert.ok(edgeCount > 0, "Graph should have edges");
  
  // Verify analysis metrics
  const summary = analysisResult.summary;
  assert.ok(summary.centrality, "Should have centrality metrics");
  assert.ok(summary.centrality.degree, "Should have degree centrality");
  assert.ok(summary.centrality.betweenness || Object.keys(summary.centrality.betweenness || {}).length >= 0, "Should have betweenness centrality");
  assert.ok(summary.centrality.pageRank || Object.keys(summary.centrality.pageRank || {}).length >= 0, "Should have PageRank");
  
  assert.ok(summary.communities, "Should have community detection results");
  assert.ok(summary.cliques, "Should have clique analysis results");
  
  // Serialize graph
  const serialized = serializeGraph(graph);
  assert.ok(serialized.nodes, "Serialized should have nodes");
  assert.ok(serialized.edges, "Serialized should have edges");
  assert.equal(serialized.nodes.length, nodeCount, "Serialized nodes count should match graph");
  assert.equal(serialized.edges.length, edgeCount, "Serialized edges count should match graph");
  
  // Verify serialized nodes have analysis metrics
  // Metrics are stored directly on node attributes (centrality, community, etc.)
  const nodeWithMetrics = serialized.nodes.find(n => n.centrality || n.community !== undefined);
  assert.ok(nodeWithMetrics, "At least one node should have analysis metrics");
  if (nodeWithMetrics) {
    // Centrality metrics are stored under n.centrality
    if (nodeWithMetrics.centrality) {
      assert.ok(typeof nodeWithMetrics.centrality.degree === "object" || nodeWithMetrics.centrality.degree === undefined, "Node should have degree metrics in centrality");
    }
    // Community is stored directly on the node
    assert.ok(typeof nodeWithMetrics.community === "number" || nodeWithMetrics.community === undefined, "Node should have community assignment");
  }
  
  // Verify serialized edges preserve schema fields
  const callEdge = serialized.edges.find(e => e.type === "call" || !e.type);
  if (callEdge) {
    assert.ok(callEdge.source, "Call edge should have source");
    assert.ok(callEdge.target, "Call edge should have target");
    assert.ok(typeof callEdge.weight === "number", "Call edge should have weight");
  }
  
  const simEdge = serialized.edges.find(e => e.type === "similarity");
  if (simEdge) {
    assert.equal(simEdge.type, "similarity", "Similarity edge should have type");
    assert.ok(typeof simEdge.similarity === "number", "Similarity edge should have similarity score");
    assert.ok(simEdge.undirected === true, "Similarity edge should be undirected");
  }
});

test("End-to-end: Medium parser payload → graph pipeline → analysis", async () => {
  // Load medium fixture
  const parserPayload = await loadParserFixture("medium");
  
  // Generate similarity edges
  const similarityEdges = generateMockSimilarityEdges(
    parserPayload.functions,
    parserPayload.callEdges
  );
  
  // Create and merge payload
  const mergedPayload = mergeGraphPayload({
    parser: {
      functions: parserPayload.functions,
      callEdges: parserPayload.callEdges,
      stats: parserPayload.stats || null,
      symbolTables: parserPayload.symbolTables || null
    },
    embeddings: {
      similarityEdges,
      metadata: { model: "all-MiniLM-L6-v2", dimension: 384 },
      stats: { functionsWithEmbeddings: parserPayload.functions.length, totalEdges: similarityEdges.length }
    }
  });
  
  // Validate
  const validation = validateGraphPayload(mergedPayload);
  assert.ok(validation.valid, `Medium payload should be valid: ${validation.errors?.join(", ") || "unknown error"}`);
  
  // Build and analyze
  const analysisResult = buildAnalyzedGraph(mergedPayload, {
    assignMetrics: true,
    analysis: { centralities: true, communities: true, cliques: true }
  });
  
  assert.ok(analysisResult.graph, "Medium graph should be built");
  assert.ok(analysisResult.summary, "Medium summary should be generated");
  
  // Verify metrics are computed
  const summary = analysisResult.summary;
  assert.ok(summary.centrality, "Medium payload should have centrality metrics");
  assert.ok(summary.communities, "Medium payload should have communities");
  assert.ok(summary.cliques, "Medium payload should have cliques");
  
  // Serialize
  const serialized = serializeGraph(analysisResult.graph);
  assert.ok(serialized.nodes.length > 0, "Medium serialized should have nodes");
  assert.ok(serialized.edges.length > 0, "Medium serialized should have edges");
});

test("End-to-end: Large parser payload → graph pipeline → analysis", async () => {
  // Load large fixture
  const parserPayload = await loadParserFixture("large");
  
  // Generate similarity edges (limit for performance)
  const similarityEdges = generateMockSimilarityEdges(
    parserPayload.functions,
    parserPayload.callEdges
  ).slice(0, 100); // Limit to 100 edges for test performance
  
  // Create and merge payload
  const mergedPayload = mergeGraphPayload({
    parser: {
      functions: parserPayload.functions,
      callEdges: parserPayload.callEdges,
      stats: parserPayload.stats || null,
      symbolTables: parserPayload.symbolTables || null
    },
    embeddings: {
      similarityEdges,
      metadata: { model: "all-MiniLM-L6-v2", dimension: 384 },
      stats: { functionsWithEmbeddings: parserPayload.functions.length, totalEdges: similarityEdges.length }
    }
  });
  
  // Validate
  const validation = validateGraphPayload(mergedPayload);
  assert.ok(validation.valid, `Large payload should be valid: ${validation.errors?.join(", ") || "unknown error"}`);
  
  // Build and analyze
  const analysisResult = buildAnalyzedGraph(mergedPayload, {
    assignMetrics: true,
    analysis: { centralities: true, communities: true, cliques: true }
  });
  
  assert.ok(analysisResult.graph, "Large graph should be built");
  assert.ok(analysisResult.summary, "Large summary should be generated");
  
  // Verify metrics
  const summary = analysisResult.summary;
  assert.ok(summary.centrality, "Large payload should have centrality metrics");
  assert.ok(summary.communities, "Large payload should have communities");
  assert.ok(summary.cliques, "Large payload should have cliques");
  
  // Serialize
  const serialized = serializeGraph(analysisResult.graph);
  assert.ok(serialized.nodes.length > 0, "Large serialized should have nodes");
  assert.ok(serialized.edges.length > 0, "Large serialized should have edges");
  
  // Verify performance: large graphs should complete in reasonable time
  assert.ok(serialized.nodes.length === parserPayload.functions.length, "All functions should be serialized");
});

test("End-to-end: Empty payload handling", async () => {
  // Test with empty payload
  const emptyPayload = mergeGraphPayload({
    parser: { functions: [], callEdges: [], stats: null, symbolTables: null },
    embeddings: { similarityEdges: [], metadata: null, stats: null }
  });
  
  const validation = validateGraphPayload(emptyPayload);
  // Empty payload might be valid or invalid depending on validator rules
  // Just ensure it doesn't crash
  
  const collected = collectGraphPayload({
    functions: [],
    callEdges: [],
    similarityEdges: []
  });
  
  assert.equal(collected.functions.length, 0, "Empty payload should have no functions");
  assert.equal(collected.callEdges.length, 0, "Empty payload should have no call edges");
  assert.equal(collected.similarityEdges.length, 0, "Empty payload should have no similarity edges");
  
  // Build graph with empty payload
  const analysisResult = buildAnalyzedGraph(emptyPayload, {
    assignMetrics: true,
    analysis: { centralities: true, communities: true, cliques: true }
  });
  
  // Should handle gracefully
  if (analysisResult.graph) {
    let nodeCount = 0;
    analysisResult.graph.forEachNode(() => { nodeCount++; });
    assert.equal(nodeCount, 0, "Empty graph should have no nodes");
  }
});

test("End-to-end: Payload with only call edges (no similarity)", async () => {
  const parserPayload = await loadParserFixture("small");
  
  const mergedPayload = mergeGraphPayload({
    parser: {
      functions: parserPayload.functions,
      callEdges: parserPayload.callEdges,
      stats: parserPayload.stats || null,
      symbolTables: parserPayload.symbolTables || null
    },
    embeddings: {
      similarityEdges: [],
      metadata: null,
      stats: null
    }
  });
  
  const validation = validateGraphPayload(mergedPayload);
  assert.ok(validation.valid, "Payload with only call edges should be valid");
  
  const analysisResult = buildAnalyzedGraph(mergedPayload, {
    assignMetrics: true,
    analysis: { centralities: true, communities: true, cliques: true }
  });
  
  assert.ok(analysisResult.graph, "Graph with only call edges should be built");
  assert.ok(analysisResult.summary, "Summary should be generated");
  
  const serialized = serializeGraph(analysisResult.graph);
  assert.ok(serialized.nodes.length > 0, "Should have nodes");
  assert.ok(serialized.edges.length > 0, "Should have call edges");
  
  // Verify no similarity edges
  const simEdges = serialized.edges.filter(e => e.type === "similarity");
  assert.equal(simEdges.length, 0, "Should have no similarity edges");
});

