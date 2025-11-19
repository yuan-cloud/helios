#!/usr/bin/env node

/**
 * Vendorizes critical CDN-hosted dependencies by copying their ESM bundles
 * from node_modules into the public/vendor directory. This enables HELIOS to
 * fall back to same-origin mirrors when external CDNs are unavailable.
 *
 * Usage:
 *   node tools/vendorize-deps.mjs
 *
 * The script assumes `npm install` has been run with the relevant packages
 * listed in package.json (graphology, 3d-force-graph, etc.).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const dependencies = [
  {
    name: "graphology",
    sources: [
      {
        from: path.join(repoRoot, "node_modules", "graphology", "dist", "graphology.esm.js"),
        to: path.join(repoRoot, "public", "vendor", "graphology", "graphology.esm.js"),
      },
      {
        from: path.join(repoRoot, "node_modules", "graphology", "dist", "graphology.esm.js.map"),
        to: path.join(repoRoot, "public", "vendor", "graphology", "graphology.esm.js.map"),
        optional: true,
      },
      {
        from: path.join(repoRoot, "node_modules", "graphology", "LICENSE.txt"),
        to: path.join(repoRoot, "public", "vendor", "graphology", "LICENSE.txt"),
      },
    ],
  },
  {
    name: "3d-force-graph",
    sources: [
      {
        from: path.join(repoRoot, "node_modules", "3d-force-graph", "dist", "3d-force-graph.mjs"),
        to: path.join(repoRoot, "public", "vendor", "3d-force-graph", "3d-force-graph.mjs"),
      },
      {
        from: path.join(repoRoot, "node_modules", "3d-force-graph", "dist", "3d-force-graph.js.map"),
        to: path.join(repoRoot, "public", "vendor", "3d-force-graph", "3d-force-graph.js.map"),
        optional: true,
      },
      {
        from: path.join(repoRoot, "node_modules", "3d-force-graph", "LICENSE"),
        to: path.join(repoRoot, "public", "vendor", "3d-force-graph", "LICENSE"),
      },
    ],
  },
  {
    name: "graphology-communities-louvain",
    sources: [
      {
        from: path.join(repoRoot, "node_modules", "graphology-communities-louvain", "index.js"),
        to: path.join(repoRoot, "public", "vendor", "graphology-communities-louvain", "index.js"),
      },
      {
        from: path.join(repoRoot, "node_modules", "graphology-communities-louvain", "LICENSE"),
        to: path.join(repoRoot, "public", "vendor", "graphology-communities-louvain", "LICENSE"),
        optional: true,
      },
    ],
  },
];

async function copyFile(source, destination, optional = false) {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    console.log(`✔ ${path.relative(repoRoot, destination)}`);
  } catch (error) {
    if (optional && error.code === "ENOENT") {
      console.warn(`⚠ Optional artifact missing: ${path.relative(repoRoot, source)}`);
      return;
    }
    throw error;
  }
}

async function vendorize() {
  for (const dep of dependencies) {
    console.log(`\n→ Vendorizing ${dep.name}`);
    for (const artifact of dep.sources) {
      await copyFile(artifact.from, artifact.to, artifact.optional);
    }
  }
  console.log("\nVendorization complete. Update import maps if you wish to use the local mirrors.");
}

vendorize().catch((error) => {
  console.error("Vendorization failed:", error);
  process.exitCode = 1;
});


