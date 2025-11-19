#!/usr/bin/env node
/**
 * Generate sample parser payload fixtures for network analysis validation harness
 * Creates small, medium, and large representative payloads
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const clusterSize = Math.floor(functions.length / 5);
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
          resolution: {
            status: Math.random() < 0.15 ? 'unresolved' : Math.random() < 0.2 ? 'ambiguous' : 'resolved',
            reason: Math.random() < 0.15 ? 'Cannot resolve statically' : null,
            candidates: Math.random() < 0.2 ? [
              { id: target.id, confidence: 0.85 },
              { id: functions[Math.floor(Math.random() * functions.length)].id, confidence: 0.6 }
            ] : [{ id: target.id, confidence: 0.9 }]
          }
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

async function generateFixtures() {
  const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures', 'network-analysis');
  
  // Small: 10 functions, ~10 edges
  const smallFuncs = generateFunctions(10);
  const smallEdges = generateCallEdges(smallFuncs, 10);
  const smallPayload = {
    functions: smallFuncs,
    callEdges: smallEdges,
    similarityEdges: []
  };
  
  // Medium: 75 functions, ~100 edges
  const mediumFuncs = generateFunctions(75);
  const mediumEdges = generateCallEdges(mediumFuncs, 100);
  const mediumPayload = {
    functions: mediumFuncs,
    callEdges: mediumEdges,
    similarityEdges: []
  };
  
  // Large: 300 functions, ~400 edges
  const largeFuncs = generateFunctions(300);
  const largeEdges = generateCallEdges(largeFuncs, 400);
  const largePayload = {
    functions: largeFuncs,
    callEdges: largeEdges,
    similarityEdges: []
  };
  
  // Write fixtures
  await fs.writeFile(
    path.join(fixturesDir, 'sample-parser-payload-small.json'),
    JSON.stringify(smallPayload, null, 2)
  );
  
  await fs.writeFile(
    path.join(fixturesDir, 'sample-parser-payload-medium.json'),
    JSON.stringify(mediumPayload, null, 2)
  );
  
  await fs.writeFile(
    path.join(fixturesDir, 'sample-parser-payload-large.json'),
    JSON.stringify(largePayload, null, 2)
  );
  
  console.log('✅ Generated parser payload fixtures:');
  console.log(`  - Small: ${smallFuncs.length} functions, ${smallEdges.length} edges`);
  console.log(`  - Medium: ${mediumFuncs.length} functions, ${mediumEdges.length} edges`);
  console.log(`  - Large: ${largeFuncs.length} functions, ${largeEdges.length} edges`);
}

generateFixtures().catch(console.error);

