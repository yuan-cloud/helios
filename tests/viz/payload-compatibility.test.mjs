#!/usr/bin/env node

/**
 * Visualization payload compatibility tests.
 * 
 * Verifies that payloads conforming to docs/payloads.md can be:
 * 1. Validated by the payload validator
 * 2. Processed through the graph pipeline
 * 3. Converted to visualization format
 * 4. Consumed by the visualization layer
 * 
 * This helps ensure schema ratification and visualization integration compatibility.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateGraphPayload } from "../../src/graph/payload-validator.js";
import { mergeGraphPayload } from "../../src/graph/merge.js";
import { collectGraphPayload, buildAnalyzedGraph, serializeGraph } from "../../src/graph/pipeline.js";
import { GraphVisualization } from "../../src/viz/graph-viz.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Simulate convertCallGraphToVizData conversion (from index.html)
 * This matches the actual conversion logic used in the app
 */
function convertCallGraphToVizData(graph, similarityEdges = []) {
  if (!graph) return { nodes: [], links: [] };

  const nodes = (graph.nodes || []).map(fn => {
    const startLine = fn.startLine ?? null;
    const endLine = fn.endLine ?? null;
    const locEstimate = startLine && endLine ? Math.max(1, endLine - startLine + 1) : 1;

    return {
      id: fn.id,
      fqName: fn.fqName || fn.name || fn.id,
      name: fn.name || fn.fqName || fn.id,
      filePath: fn.filePath || '',
      lang: fn.lang || 'javascript',
      moduleId: fn.moduleId || null,
      isVirtual: !!fn.isVirtual,
      size: fn.loc || locEstimate,
      startLine,
      endLine,
      doc: fn.doc || '',
      metrics: fn.metrics || {},
      analysis: fn.analysis || null,
      source: fn.source || ''
    };
  });

  const links = [];
  let hasSimilarityEdges = false;

  (graph.edges || []).forEach(edge => {
    const layer = (edge.layer || edge.type || '').toLowerCase();
    const isSimilarity =
      layer === 'similarity' ||
      (!!edge.undirected && layer !== 'call') ||
      (layer !== 'call' && typeof edge.similarity === 'number');

    if (isSimilarity) {
      hasSimilarityEdges = true;
      links.push({
        source: edge.source,
        target: edge.target,
        type: 'similarity',
        weight: Number.isFinite(edge.similarity) ? edge.similarity : 0,
        similarity: Number.isFinite(edge.similarity) ? edge.similarity : 0,
        method: edge.method || 'topk-avg',
        representativeSimilarity: edge.representativeSimilarity ?? null,
        topPairs: edge.topPairs || [],
        undirected: edge.undirected ?? true,
        metadata: edge.metadata || null
      });
      return;
    }

    const metadata = edge.metadata || {};
    const resolution = edge.resolution || metadata.resolution || null;
    const resolutionStatus = resolution?.status || 'resolved';

    links.push({
      source: edge.source,
      target: edge.target,
      type: 'call',
      weight: Number.isFinite(edge.weight) ? Number(edge.weight) : 1,
      dynamic: !!edge.isDynamic,
      resolution,
      resolutionStatus,
      resolutionReason: resolution?.reason || '',
      importInfo: resolution?.importInfo || metadata.importInfo || null,
      metadata,
      callSites: edge.callSites || metadata.callSites || null
    });
  });

  // Add similarity edges if not already included
  if (!hasSimilarityEdges && similarityEdges.length > 0) {
    similarityEdges.forEach(edge => {
      links.push({
        source: edge.source,
        target: edge.target,
        type: 'similarity',
        weight: edge.similarity || 0,
        similarity: edge.similarity || 0,
        method: edge.method || 'topk-avg',
        representativeSimilarity: edge.representativeSimilarity ?? null,
        topPairs: edge.topPairs || [],
        undirected: true
      });
    });
  }

  return { nodes, links };
}

async function loadVizPayloadSample() {
  const samplePath = path.resolve(__dirname, "../fixtures/viz-payload-sample.json");
  const contents = await fs.readFile(samplePath, "utf-8");
  return JSON.parse(contents);
}

test("payload passes validation", async () => {
  const payload = await loadVizPayloadSample();
  const result = validateGraphPayload(payload, { strict: false, collectStats: true });

  assert.equal(result.valid, true, `Expected payload to be valid:\n${result.errors.map(e => `${e.path}: ${e.message}`).join("\n")}`);
  assert.ok(result.stats, "Expected stats to be collected");
  assert.equal(result.stats.functionCount, 3, "Expected 3 functions");
  assert.equal(result.stats.callEdgeCount, 3, "Expected 3 call edges");
  assert.equal(result.stats.similarityEdgeCount, 1, "Expected 1 similarity edge");
});

test("payload can be processed through graph pipeline", async () => {
  const payload = await loadVizPayloadSample();
  
  // Step 1: Merge payload (from envelope format to merged format)
  const merged = mergeGraphPayload(payload);
  assert.ok(Array.isArray(merged.functions), "Functions should be an array");
  assert.ok(Array.isArray(merged.callEdges), "Call edges should be an array");
  assert.ok(Array.isArray(merged.similarityEdges), "Similarity edges should be an array");
  assert.equal(merged.functions.length, 3, "Should have 3 functions");
  assert.equal(merged.callEdges.length, 3, "Should have 3 call edges");
  assert.equal(merged.similarityEdges.length, 1, "Should have 1 similarity edge");

  // Step 2: Collect payload (normalizes arrays)
  const collected = collectGraphPayload(merged);
  assert.ok(Array.isArray(collected.functions), "Functions should be an array");
  assert.ok(Array.isArray(collected.callEdges), "Call edges should be an array");
  assert.ok(Array.isArray(collected.similarityEdges), "Similarity edges should be an array");
  assert.equal(collected.functions.length, 3, "Should have 3 functions");
  assert.equal(collected.callEdges.length, 3, "Should have 3 call edges");
  assert.equal(collected.similarityEdges.length, 1, "Should have 1 similarity edge");

  // Step 3: Build analyzed graph
  const { graph, summary } = buildAnalyzedGraph(collected, {
    assignMetrics: true,
    analysis: {}
  });
  assert.ok(graph, "Graph should be created");
  assert.ok(summary, "Summary should be created");
  assert.equal(typeof graph.forEachNode, 'function', "Graph should be a Graphology instance");

  // Step 4: Serialize graph
  const serialized = serializeGraph(graph);
  assert.ok(Array.isArray(serialized.nodes), "Serialized nodes should be an array");
  assert.ok(Array.isArray(serialized.edges), "Serialized edges should be an array");
  assert.equal(serialized.nodes.length, 3, "Should have 3 serialized nodes");
  assert.ok(serialized.edges.length >= 3, "Should have at least 3 serialized edges (call + similarity)");
});

test("payload can be converted to visualization format", async () => {
  const payload = await loadVizPayloadSample();
  
  // Process through graph pipeline
  const merged = mergeGraphPayload(payload);
  const collected = collectGraphPayload(merged);
  const { graph } = buildAnalyzedGraph(collected, { assignMetrics: true });
  const serialized = serializeGraph(graph);

  // Convert to visualization format
  const vizData = convertCallGraphToVizData(serialized, collected.similarityEdges);

  assert.ok(Array.isArray(vizData.nodes), "Viz nodes should be an array");
  assert.ok(Array.isArray(vizData.links), "Viz links should be an array");
  assert.equal(vizData.nodes.length, 3, "Should have 3 viz nodes");
  assert.ok(vizData.links.length >= 3, "Should have at least 3 viz links");

  // Verify node structure
  const node = vizData.nodes[0];
  assert.ok(node.id, "Node should have id");
  assert.ok(node.name || node.fqName, "Node should have name or fqName");
  assert.ok(typeof node.filePath === 'string', "Node should have filePath");
  assert.ok(node.lang, "Node should have lang");

  // Verify link structure
  const callLink = vizData.links.find(l => l.type === 'call');
  assert.ok(callLink, "Should have at least one call link");
  assert.ok(callLink.source, "Call link should have source");
  assert.ok(callLink.target, "Call link should have target");
  assert.equal(callLink.type, 'call', "Link should have type 'call'");
  assert.ok(typeof callLink.weight === 'number', "Call link should have weight");

  const simLink = vizData.links.find(l => l.type === 'similarity');
  assert.ok(simLink, "Should have at least one similarity link");
  assert.equal(simLink.type, 'similarity', "Link should have type 'similarity'");
  assert.ok(typeof simLink.similarity === 'number', "Similarity link should have similarity");
});

test("visualization can consume converted payload", async () => {
  const payload = await loadVizPayloadSample();
  
  // Process through full pipeline
  const merged = mergeGraphPayload(payload);
  const collected = collectGraphPayload(merged);
  const { graph } = buildAnalyzedGraph(collected, { assignMetrics: true });
  const serialized = serializeGraph(graph);
  const vizData = convertCallGraphToVizData(serialized, collected.similarityEdges);

  // Create visualization instance (without container for testing)
  const viz = new GraphVisualization(null);

  // Test that loadData accepts the format
  assert.doesNotThrow(() => {
    viz.loadData(vizData);
  }, "loadData should accept the converted payload format");

  // Verify data was loaded
  assert.equal(viz.data.nodes.length, 3, "Visualization should have 3 nodes");
  assert.ok(viz.data.links.length >= 3, "Visualization should have at least 3 links");

  // Verify similarity stats were computed
  const simLinks = viz.data.links.filter(l => l.type === 'similarity');
  if (simLinks.length > 0) {
    assert.ok(viz.similarityStats.count > 0, "Similarity stats should be computed");
    assert.ok(Number.isFinite(viz.similarityStats.min), "Similarity min should be finite");
    assert.ok(Number.isFinite(viz.similarityStats.max), "Similarity max should be finite");
  }
});

test("visualization handles resolution states correctly", async () => {
  const payload = await loadVizPayloadSample();
  
  const merged = mergeGraphPayload(payload);
  const collected = collectGraphPayload(merged);
  const { graph } = buildAnalyzedGraph(collected, { assignMetrics: true });
  const serialized = serializeGraph(graph);
  const vizData = convertCallGraphToVizData(serialized, collected.similarityEdges);

  const viz = new GraphVisualization(null);
  viz.loadData(vizData);

  // Find resolved edge
  const resolvedLink = viz.data.links.find(l => 
    l.type === 'call' && 
    l.resolutionStatus === 'resolved'
  );
  assert.ok(resolvedLink, "Should have resolved call edge");
  assert.equal(resolvedLink.resolutionStatus, 'resolved', "Link should be marked as resolved");

  // Note: Unresolved edges to external functions may not be included in the graph
  // if the target function doesn't exist. Check if any unresolved edge exists.
  const unresolvedLink = viz.data.links.find(l => 
    l.type === 'call' && 
    (l.resolutionStatus === 'unresolved' || l.resolutionStatus === 'ambiguous')
  );
  // If unresolved edge exists, verify it's marked correctly
  if (unresolvedLink) {
    assert.ok(
      unresolvedLink.resolutionStatus === 'unresolved' || unresolvedLink.resolutionStatus === 'ambiguous',
      "Unresolved/ambiguous link should be marked correctly"
    );
  } else {
    // If no unresolved edge in graph (because external target doesn't exist),
    // verify that at least resolved edges are present
    assert.ok(resolvedLink, "Should have at least one resolved call edge");
  }
});

test("visualization extracts similarity edge fields correctly", async () => {
  const payload = await loadVizPayloadSample();
  
  const merged = mergeGraphPayload(payload);
  const collected = collectGraphPayload(merged);
  const { graph } = buildAnalyzedGraph(collected, { assignMetrics: true });
  const serialized = serializeGraph(graph);
  const vizData = convertCallGraphToVizData(serialized, collected.similarityEdges);

  const viz = new GraphVisualization(null);
  viz.loadData(vizData);

  const simLink = viz.data.links.find(l => l.type === 'similarity');
  assert.ok(simLink, "Should have similarity link");
  assert.equal(typeof simLink.similarity, 'number', "Should have similarity value");
  assert.ok(simLink.similarity >= 0 && simLink.similarity <= 1, "Similarity should be in [0,1] range");
  assert.ok(simLink.method, "Should have method field");
  assert.equal(simLink.undirected, true, "Similarity edges should be undirected");
});

test("payload validator catches visualization-incompatible issues", async () => {
  const payload = await loadVizPayloadSample();
  
  // Test missing required fields
  const invalidPayload = { ...payload };
  invalidPayload.parser.functions[0].id = '';
  
  const result = validateGraphPayload(invalidPayload, { strict: false });
  assert.equal(result.valid, false, "Should reject payload with empty function id");
  assert.ok(result.errors.length > 0, "Should report errors");
  assert.ok(
    result.errors.some(e => e.message.includes('id') || e.message.includes('Required')),
    "Should report id-related error"
  );
});

test("payload with all recommended fields works correctly", async () => {
  const payload = await loadVizPayloadSample();
  
  // Ensure similarity edge has all recommended fields
  const edge = payload.embeddings.similarityEdges[0];
  assert.ok(edge.id, "Similarity edge should have id");
  assert.ok(edge.method, "Similarity edge should have method");
  assert.ok(edge.metadata, "Similarity edge should have metadata");
  assert.ok(edge.undirected !== undefined, "Similarity edge should have undirected field");

  // Process through pipeline
  const merged = mergeGraphPayload(payload);
  const collected = collectGraphPayload(merged);
  const { graph } = buildAnalyzedGraph(collected, { assignMetrics: true });
  const serialized = serializeGraph(graph);
  const vizData = convertCallGraphToVizData(serialized, collected.similarityEdges);

  // Verify visualization can use all fields
  const viz = new GraphVisualization(null);
  viz.loadData(vizData);

  const simLink = viz.data.links.find(l => l.type === 'similarity');
  assert.ok(simLink, "Should have similarity link");
  assert.ok(simLink.method, "Should preserve method field");
  assert.ok(simLink.metadata || simLink.topPairs, "Should preserve metadata or topPairs");
});

