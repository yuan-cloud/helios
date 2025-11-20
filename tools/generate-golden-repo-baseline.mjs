#!/usr/bin/env node
/**
 * Generate golden repo baseline parser payloads for regression testing
 * 
 * Creates realistic parser payloads with metadata including:
 * - Expected counts (functions, call edges, languages)
 * - Top central nodes (with PageRank values)
 * - Resolution statistics
 * 
 * Usage:
 *   node tools/generate-golden-repo-baseline.mjs <repo-name> <function-count> <output-dir>
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
// Generate functions and call edges (copied from generate-parser-fixtures.mjs since not exported)

function generateFunctions(count, prefix = '') {
  const functions = [];
  const modules = ['utils', 'api', 'components', 'lib', 'services', 'models', 'helpers'];
  const langs = ['javascript', 'typescript', 'python'];
  
  for (let i = 0; i < count; i++) {
    const module = modules[i % modules.length];
    const lang = langs[i % langs.length];
    const name = `func${prefix}${i + 1}`;
    const filePath = `src/${module}/${name}.${lang === 'python' ? 'py' : lang === 'typescript' ? 'ts' : 'js'}`;
    const id = `${filePath}::${name}`;
    
    functions.push({
      id,
      name,
      fqName: `${module}.${name}`,
      filePath,
      moduleId: module,
      lang,
      isVirtual: false,
      startLine: (i % 50) * 10 + 1,
      endLine: (i % 50) * 10 + 25,
      startColumn: 0,
      endColumn: 0,
      loc: 25,
      doc: `Function ${name} in ${module}`,
      source: `function ${name}() { /* ... */ }`,
      metrics: {}
    });
  }
  
  return functions;
}

function generateCallEdges(functions, targetCallCount) {
  const edges = [];
  const edgeKeys = new Set();
  
  // Create a structured call graph with clusters
  const clusters = [];
  const clusterSize = Math.max(1, Math.floor(functions.length / 5)); // Ensure at least 1 to avoid infinite loop
  for (let i = 0; i < functions.length; i += clusterSize) {
    clusters.push(functions.slice(i, i + clusterSize));
  }
  
  let edgeCount = 0;
  
  // Within-cluster edges (high connectivity)
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    for (let i = 0; i < cluster.length - 1 && edgeCount < targetCallCount; i++) {
      const source = cluster[i];
      const target = cluster[i + 1];
      const key = `${source.id}→${target.id}`;
      
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({
          id: `call::${key}`,
          source: source.id,
          target: target.id,
          weight: Math.floor(Math.random() * 3) + 1,
          isDynamic: Math.random() < 0.1,
          language: source.lang,
          callSites: [{
            filePath: source.filePath,
            line: source.startLine + 5,
            column: 10,
            context: `${target.name}();`
          }],
          resolution: (() => {
            const statusRand = Math.random();
            if (statusRand < 0.15) {
              // Unresolved: no candidates or reason explaining why
              return {
                status: 'unresolved',
                reason: 'Cannot resolve statically',
                candidates: []
              };
            } else if (statusRand < 0.2) {
              // Ambiguous: multiple candidates
              // Find a different function from target for the second candidate
              const otherCandidates = functions.filter(f => f.id !== target.id);
              const otherFunc = otherCandidates.length > 0 
                ? otherCandidates[Math.floor(Math.random() * otherCandidates.length)]
                : functions[0]; // Fallback if only one function
              return {
                status: 'ambiguous',
                reason: 'Multiple matches found',
                candidates: [
                  { id: target.id, confidence: 0.85 },
                  { id: otherFunc.id, confidence: 0.6 }
                ]
              };
            } else {
              // Resolved: single candidate, no reason
              return {
                status: 'resolved',
                reason: null,
                candidates: [{ id: target.id, confidence: 0.9 }]
              };
            }
          })()
        });
        edgeCount++;
      }
    }
  }
  
  // Cross-cluster edges (lower connectivity)
  for (let i = 0; i < clusters.length - 1 && edgeCount < targetCallCount; i++) {
    const clusterA = clusters[i];
    const clusterB = clusters[i + 1];
    if (clusterA.length === 0 || clusterB.length === 0) continue;
    
    const source = clusterA[Math.floor(Math.random() * clusterA.length)];
    const target = clusterB[Math.floor(Math.random() * clusterB.length)];
    const key = `${source.id}→${target.id}`;
    
    if (!edgeKeys.has(key) && Math.random() < 0.3) {
      edgeKeys.add(key);
      edges.push({
        id: `call::${key}`,
        source: source.id,
        target: target.id,
        weight: 1,
        isDynamic: false,
        language: source.lang,
        callSites: [{
          filePath: source.filePath,
          line: source.startLine + 8,
          column: 12,
          context: `await ${target.name}();`
        }],
        resolution: {
          status: 'resolved',
          reason: null,
          candidates: [{ id: target.id, confidence: 0.9 }],
          importInfo: {
            module: `../${target.moduleId}`,
            resolvedModule: target.moduleId
          }
        }
      });
      edgeCount++;
    }
  }
  
  return edges;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Compute mock PageRank for top central nodes
 * Simulates centrality by considering node degree and position in call graph
 */
function computeMockPageRank(functions, edges) {
  // Build in-degree map
  const inDegree = new Map();
  functions.forEach(f => inDegree.set(f.id, 0));
  
  edges.forEach(edge => {
    if (edge.resolution?.status === 'resolved') {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + edge.weight);
    }
  });
  
  // Build out-degree map
  const outDegree = new Map();
  functions.forEach(f => outDegree.set(f.id, 0));
  
  edges.forEach(edge => {
    if (edge.resolution?.status === 'resolved') {
      outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + edge.weight);
    }
  });
  
  // Compute simple PageRank approximation: (in-degree + out-degree) / max-degree
  const allDegrees = Array.from(inDegree.values()).concat(Array.from(outDegree.values()));
  const maxDegree = Math.max(...allDegrees, 1);
  
  const pageRanks = new Map();
  functions.forEach(func => {
    const degree = (inDegree.get(func.id) || 0) + (outDegree.get(func.id) || 0);
    const rank = Math.max(0.01, (degree / maxDegree) * 0.1); // Scale to 0.01-0.1 range
    pageRanks.set(func.id, rank);
  });
  
  return pageRanks;
}

/**
 * Generate baseline parser payload with metadata
 */
function generateBaseline(repoName, functionCount, description) {
  // Generate functions and edges
  const functions = generateFunctions(functionCount);
  const targetEdgeCount = Math.floor(functionCount * 0.8); // ~80% of functions have call edges
  const callEdges = generateCallEdges(functions, targetEdgeCount);
  
  // Compute stats
  let resolvedEdges = 0;
  let ambiguousEdges = 0;
  let unresolvedEdges = 0;
  let staticEdges = 0;
  let dynamicEdges = 0;
  
  callEdges.forEach(edge => {
    if (edge.isDynamic) {
      dynamicEdges += 1;
    } else {
      staticEdges += 1;
    }
    
    const status = edge.resolution?.status;
    if (status === 'resolved') {
      resolvedEdges += 1;
    } else if (status === 'ambiguous') {
      ambiguousEdges += 1;
    } else if (status === 'unresolved') {
      unresolvedEdges += 1;
    }
  });
  
  // Compute language distribution
  const languages = {};
  functions.forEach(f => {
    const lang = f.lang || 'unknown';
    languages[lang] = (languages[lang] || 0) + 1;
  });
  
  // Compute mock PageRank and get top 10 central nodes
  const pageRanks = computeMockPageRank(functions, callEdges);
  const topCentralNodes = Array.from(pageRanks.entries())
    .map(([id, pageRank]) => ({ id, pageRank }))
    .sort((a, b) => b.pageRank - a.pageRank)
    .slice(0, 10);
  
  // Generate baseline payload
  const baseline = {
    metadata: {
      repoName,
      description,
      generatedAt: new Date().toISOString(),
      parserVersion: "1.0.0",
      expectedCounts: {
        functions: functions.length,
        callEdges: callEdges.length,
        languages
      },
      topCentralNodes
    },
    functions,
    callEdges,
    stats: {
      resolvedEdges,
      ambiguousEdges,
      unresolvedEdges,
      staticEdges,
      dynamicEdges,
      totalNodes: functions.length,
      totalEdges: callEdges.length
    },
    symbolTables: {} // Empty for now, can be populated if needed
  };
  
  return baseline;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: node tools/generate-golden-repo-baseline.mjs <repo-name> <function-count> <output-dir>');
    console.log('');
    console.log('Example:');
    console.log('  node tools/generate-golden-repo-baseline.mjs simple-web-app 100 tests/golden-repos/simple-web-app/');
    process.exit(0);
  }
  
  const [repoName, functionCountStr, outputDir] = args;
  const functionCount = parseInt(functionCountStr, 10);
  
  if (isNaN(functionCount) || functionCount < 1) {
    console.error('Error: function-count must be a positive integer');
    process.exit(1);
  }
  
  // Generate baseline
  const description = `Golden repo baseline for ${repoName} - ${functionCount} functions`;
  const baseline = generateBaseline(repoName, functionCount, description);
  
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  // Write baseline.json
  const baselinePath = path.join(outputDir, 'baseline.json');
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2), 'utf8');
  
  console.log(`✅ Generated baseline: ${baselinePath}`);
  console.log(`   Functions: ${baseline.functions.length}`);
  console.log(`   Call edges: ${baseline.callEdges.length}`);
  console.log(`   Top central nodes: ${baseline.metadata.topCentralNodes.length}`);
  console.log(`   Languages: ${Object.keys(baseline.metadata.expectedCounts.languages).join(', ')}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

