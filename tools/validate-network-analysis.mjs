#!/usr/bin/env node
/**
 * Validation harness for network analysis algorithms (PLAN.md §10.4).
 *
 * Validates that graph analysis produces reasonable results on sample payloads.
 * Tests centralities, communities, and cliques metrics.
 *
 * Usage:
 *   node tools/validate-network-analysis.mjs <payload.json>
 *   node tools/validate-network-analysis.mjs --dir tests/fixtures/network-analysis/
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Import analysis functions
const { buildAnalyzedGraph, serializeGraph } = await import('../src/graph/pipeline.js');

/**
 * Validate a single payload file.
 * @param {string} filePath
 * @returns {{valid: boolean, errors: Array<string>, warnings: Array<string>, stats: Object}}
 */
async function validatePayload(filePath) {
  const errors = [];
  const warnings = [];
  const stats = {
    functions: 0,
    callEdges: 0,
    similarityEdges: 0,
    nodes: 0,
    edges: 0,
    communities: 0,
    cliques: 0,
    coreNumbers: 0
  };

  try {
    // Load payload
    const content = readFileSync(filePath, 'utf-8');
    const payload = JSON.parse(content);

    // Validate payload structure
    if (!payload.functions || !Array.isArray(payload.functions)) {
      errors.push('Payload missing or invalid functions array');
      return { valid: false, errors, warnings, stats };
    }

    stats.functions = payload.functions.length;
    stats.callEdges = (payload.callEdges || []).length;
    stats.similarityEdges = (payload.similarityEdges || []).length;

    if (stats.functions === 0) {
      warnings.push('Payload has no functions - skipping analysis');
      return { valid: true, errors, warnings, stats };
    }

    // Run analysis pipeline
    const { graph, summary } = buildAnalyzedGraph(payload, {
      assignMetrics: true,
      analysis: {
        builder: {},
        pageRank: { damping: 0.85, tolerance: 1e-6, maxIterations: 100 },
        communities: {},
        cliques: { maxCliques: 1000 }
      }
    });

    if (!graph) {
      errors.push('Graph construction failed');
      return { valid: false, errors, warnings, stats };
    }

    // Serialize and validate
    const serialized = serializeGraph(graph);
    stats.nodes = serialized.nodes.length;
    stats.edges = serialized.edges.length;

    // Validate centralities
    const centralityErrors = validateCentralities(serialized.nodes, summary.centrality);
    errors.push(...centralityErrors);

    // Validate communities
    const communityErrors = validateCommunities(serialized.nodes, summary.communities);
    errors.push(...communityErrors);
    stats.communities = new Set(serialized.nodes.map(n => n.community).filter(Boolean)).size;

    // Validate cliques and cores
    const cliqueErrors = validateCliques(serialized.nodes, summary.cliques);
    errors.push(...cliqueErrors);
    stats.cliques = summary.cliques?.cliques?.length || 0;
    stats.coreNumbers = Object.keys(summary.cliques?.coreNumbers || {}).length;

    // Check for reasonable graph structure
    if (stats.nodes === 0) {
      warnings.push('Graph has no nodes after analysis');
    }
    if (stats.edges === 0 && stats.functions > 1) {
      warnings.push('Graph has no edges despite multiple functions');
    }
    if (stats.communities === 0 && stats.nodes > 0) {
      warnings.push('No communities detected (all nodes may be isolated)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats
    };
  } catch (error) {
    errors.push(`Failed to validate ${filePath}: ${error.message}`);
    return { valid: false, errors, warnings, stats };
  }
}

/**
 * Validate centrality metrics.
 * @param {Array<Object>} nodes
 * @param {Object} centralitySummary
 * @returns {Array<string>}
 */
function validateCentralities(nodes, centralitySummary) {
  const errors = [];

  if (!centralitySummary) {
    errors.push('Centrality summary missing');
    return errors;
  }

  const { degree, betweenness, pageRank } = centralitySummary;

  // Validate degree centrality
  if (degree) {
    for (const [nodeId, metrics] of Object.entries(degree)) {
      if (typeof metrics !== 'object') {
        errors.push(`Degree metrics for ${nodeId} is not an object`);
        continue;
      }
      if (typeof metrics.total !== 'number' || metrics.total < 0) {
        errors.push(`Degree total for ${nodeId} is invalid: ${metrics.total}`);
      }
      if (typeof metrics.normalized === 'number' && (metrics.normalized < 0 || metrics.normalized > 1)) {
        errors.push(`Degree normalized for ${nodeId} out of range [0,1]: ${metrics.normalized}`);
      }
    }
  }

  // Validate betweenness centrality
  if (betweenness) {
    for (const [nodeId, value] of Object.entries(betweenness)) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`Betweenness for ${nodeId} out of range [0,1]: ${value}`);
      }
      if (!Number.isFinite(value)) {
        errors.push(`Betweenness for ${nodeId} is not finite: ${value}`);
      }
    }
  }

  // Validate PageRank
  if (pageRank) {
    let totalRank = 0;
    for (const [nodeId, value] of Object.entries(pageRank)) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        errors.push(`PageRank for ${nodeId} out of range [0,1]: ${value}`);
      }
      if (!Number.isFinite(value)) {
        errors.push(`PageRank for ${nodeId} is not finite: ${value}`);
      }
      totalRank += value;
    }
    // PageRank should sum to approximately 1 (allowing for floating point errors)
    if (Math.abs(totalRank - 1.0) > 0.01 && Object.keys(pageRank).length > 0) {
      errors.push(`PageRank sum is ${totalRank}, expected ~1.0`);
    }
  }

  return errors;
}

/**
 * Validate community detection results.
 * @param {Array<Object>} nodes
 * @param {Object} communitySummary
 * @returns {Array<string>}
 */
function validateCommunities(nodes, communitySummary) {
  const errors = [];

  if (!communitySummary) {
    errors.push('Community summary missing');
    return errors;
  }

  const communities = new Set();
  for (const node of nodes) {
    const community = node.community;
    if (community !== undefined && community !== null) {
      if (typeof community !== 'number' || !Number.isInteger(community)) {
        errors.push(`Community for node ${node.id} is not an integer: ${community}`);
      } else if (community < 0) {
        errors.push(`Community for node ${node.id} is negative: ${community}`);
      } else {
        communities.add(community);
      }
    }
  }

  // Check that communities are reasonably distributed
  if (communities.size > 0 && nodes.length > 0) {
    const avgCommunitySize = nodes.length / communities.size;
    if (avgCommunitySize < 1) {
      errors.push(`More communities (${communities.size}) than nodes (${nodes.length})`);
    }
  }

  return errors;
}

/**
 * Validate clique and core number results.
 * @param {Array<Object>} nodes
 * @param {Object} cliqueSummary
 * @returns {Array<string>}
 */
function validateCliques(nodes, cliqueSummary) {
  const errors = [];

  if (!cliqueSummary) {
    errors.push('Clique summary missing');
    return errors;
  }

  const { coreNumbers, degeneracy, cliques } = cliqueSummary;

  // Validate core numbers
  if (coreNumbers) {
    for (const [nodeId, core] of Object.entries(coreNumbers)) {
      if (typeof core !== 'number' || !Number.isInteger(core)) {
        errors.push(`Core number for ${nodeId} is not an integer: ${core}`);
      } else if (core < 0) {
        errors.push(`Core number for ${nodeId} is negative: ${core}`);
      }
    }

    // Validate degeneracy
    if (typeof degeneracy !== 'number' || !Number.isInteger(degeneracy)) {
      errors.push(`Degeneracy is not an integer: ${degeneracy}`);
    } else if (degeneracy < 0) {
      errors.push(`Degeneracy is negative: ${degeneracy}`);
    } else {
      // Degeneracy should equal max core number
      const maxCore = Math.max(...Object.values(coreNumbers), 0);
      if (degeneracy !== maxCore) {
        errors.push(`Degeneracy (${degeneracy}) does not match max core number (${maxCore})`);
      }
    }
  }

  // Validate cliques
  if (cliques) {
    if (!Array.isArray(cliques)) {
      errors.push('Cliques is not an array');
    } else {
      for (let i = 0; i < cliques.length; i++) {
        const clique = cliques[i];
        if (!Array.isArray(clique)) {
          errors.push(`Clique ${i} is not an array`);
        } else if (clique.length < 2) {
          errors.push(`Clique ${i} has fewer than 2 nodes`);
        } else {
          // Check for duplicates
          const unique = new Set(clique);
          if (unique.size !== clique.length) {
            errors.push(`Clique ${i} contains duplicate nodes`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Main CLI entry point.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node tools/validate-network-analysis.mjs <payload.json>');
    console.error('   or: node tools/validate-network-analysis.mjs --dir <directory>');
    process.exit(1);
  }

  let files = [];

  if (args[0] === '--dir') {
    const dirPath = args[1] || join(repoRoot, 'tests', 'fixtures', 'network-analysis');
    try {
      const entries = readdirSync(dirPath);
      files = entries
        .map(entry => join(dirPath, entry))
        .filter(path => {
          const stat = statSync(path);
          return stat.isFile() && extname(path) === '.json';
        });
    } catch (error) {
      console.error(`Failed to read directory ${dirPath}: ${error.message}`);
      process.exit(1);
    }
  } else {
    files = args.map(arg => {
      if (!arg.startsWith('/')) {
        return join(process.cwd(), arg);
      }
      return arg;
    });
  }

  if (files.length === 0) {
    console.error('No JSON files found to validate');
    process.exit(1);
  }

  console.log(`Validating ${files.length} payload file(s)...\n`);

  let totalErrors = 0;
  let totalWarnings = 0;
  let validCount = 0;

  for (const file of files) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Validating: ${file}`);
    console.log('='.repeat(60));

    const result = await validatePayload(file);

    // Print stats
    console.log('\nStatistics:');
    console.log(`  Functions: ${result.stats.functions}`);
    console.log(`  Call edges: ${result.stats.callEdges}`);
    console.log(`  Similarity edges: ${result.stats.similarityEdges}`);
    console.log(`  Graph nodes: ${result.stats.nodes}`);
    console.log(`  Graph edges: ${result.stats.edges}`);
    console.log(`  Communities: ${result.stats.communities}`);
    console.log(`  Cliques: ${result.stats.cliques}`);
    console.log(`  Nodes with core numbers: ${result.stats.coreNumbers}`);

    // Print warnings
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach(w => console.log(`  ⚠ ${w}`));
      totalWarnings += result.warnings.length;
    }

    // Print errors
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(e => console.log(`  ❌ ${e}`));
      totalErrors += result.errors.length;
    } else {
      console.log('\n✅ Validation passed');
      validCount++;
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total files: ${files.length}`);
  console.log(`Valid: ${validCount}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Warnings: ${totalWarnings}`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

