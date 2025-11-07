# BEST_PRACTICES_VISUALIZATION.md - 3D Graphics & ML Guide

## 3D Graphics Performance (Three.js, Force-Directed Graphs)

### Three.js Best Practices

```javascript
// ✅ CORRECT: Efficient scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ 
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x

// ❌ WRONG: Creating new objects in render loop
function animate() {
  const geometry = new THREE.BoxGeometry(); // Leak!
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  renderer.render(scene, camera);
}
```

**Critical patterns:**
- Reuse geometries and materials (use `clone()` for variations)
- Use `Object3D` groups for hierarchical updates
- Dispose of resources: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`
- Use `requestAnimationFrame` for animation loops
- Cap pixel ratio at 2x to avoid excessive rendering on high-DPI displays

### Force-Directed Graph Optimization

```javascript
// ✅ CORRECT: Efficient force simulation
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id))
  .force('charge', d3.forceManyBody().strength(-300))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .alphaDecay(0.0228) // Slower decay = longer simulation
  .velocityDecay(0.4);

// Stop simulation when stable
simulation.on('tick', () => {
  if (simulation.alpha() < 0.001) {
    simulation.stop();
  }
  render();
});
```

**Performance tips:**
- Use `simulation.stop()` when alpha is low
- Adjust `alphaDecay` and `velocityDecay` for desired behavior
- Limit node count: sample large graphs (top-N by centrality)
- Use `simulation.alphaTarget()` to restart simulation smoothly
- Batch DOM updates (don't update on every tick)

### Instanced Rendering for Large Graphs

```javascript
// ✅ CORRECT: Instanced meshes for thousands of nodes
const geometry = new THREE.SphereGeometry(0.1, 16, 16);
const material = new THREE.MeshBasicMaterial();
const instancedMesh = new THREE.InstancedMesh(geometry, material, nodeCount);

// Update positions
nodes.forEach((node, i) => {
  const matrix = new THREE.Matrix4();
  matrix.setPosition(node.x, node.y, node.z);
  instancedMesh.setMatrixAt(i, matrix);
});
instancedMesh.instanceMatrix.needsUpdate = true;
```

**Gotchas:**
- InstancedMesh supports up to ~1M instances (hardware dependent)
- Update `instanceMatrix.needsUpdate` after modifying matrices
- Use `InstancedBufferGeometry` for per-instance attributes (color, size)

---

## Tree-sitter AST Traversal

### Efficient Query Patterns

```javascript
// ✅ CORRECT: Compiled queries (faster)
const parser = new Parser();
parser.setLanguage(language);

const query = language.query(`
  (function_declaration
    name: (identifier) @func_name
    parameters: (formal_parameters) @params
    body: (statement_block) @body)
  
  (call_expression
    function: (identifier) @callee)
`);

const matches = query.matches(tree.rootNode);

// ❌ WRONG: Re-parsing on every query
function findFunctions(source) {
  const tree = parser.parse(source); // Expensive!
  return query.matches(tree.rootNode);
}
```

**Critical patterns:**
- Parse once, query many times
- Use Tree-sitter's query DSL (faster than manual traversal)
- Cache compiled queries
- Use `tree.walk()` for custom traversals (more control, less efficient)

### Incremental Parsing

```javascript
// ✅ CORRECT: Incremental updates
let tree = parser.parse(source);

// On edit, reuse previous tree
function updateTree(edit) {
  tree = parser.parse(source, tree, edit);
  // Only re-query changed regions
}
```

**Gotchas:**
- Incremental parsing requires valid edit ranges
- Tree becomes invalid after source changes (must re-parse)
- Use `tree.rootNode.walk()` for efficient traversal

### Memory Management

```javascript
// ✅ CORRECT: Dispose trees when done
function parseFile(source) {
  const tree = parser.parse(source);
  const results = extractFunctions(tree);
  tree.delete(); // Free WASM memory
  return results;
}
```

**Performance tips:**
- Delete trees when no longer needed (WASM memory)
- Batch parsing in workers
- Use `tree.rootNode.toString()` sparingly (expensive)

---

## ML Embeddings in Browser (Transformers.js)

### Model Loading and Caching

```javascript
// ✅ CORRECT: Cached model loading
import { pipeline } from '@xenova/transformers';

let embeddingModel = null;

async function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        quantized: true, // Use quantized model (smaller, faster)
        device: 'webgpu' // Prefer WebGPU
      }
    );
  }
  return embeddingModel;
}
```

**Gotchas:**
- Models are cached in IndexedDB automatically
- First load downloads model (can be 10-100MB)
- Use quantized models for better performance
- Check `navigator.gpu` before using WebGPU backend

### Batch Processing

```javascript
// ✅ CORRECT: Batch embeddings for efficiency
async function embedChunks(chunks) {
  const model = await getEmbeddingModel();
  const batchSize = 32; // Tune based on model/memory
  
  const results = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await model(batch, {
      pooling: 'mean',
      normalize: true
    });
    results.push(...embeddings);
  }
  return results;
}
```

**Performance tips:**
- Batch size depends on model and available memory
- Use `pooling: 'mean'` for sentence-level embeddings
- Normalize vectors for cosine similarity
- Process in workers to avoid blocking UI

### WebGPU vs WASM Fallback

```javascript
// ✅ CORRECT: Backend detection and fallback
async function initEmbeddingBackend() {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return 'webgpu'; // 5-10x faster
      }
    } catch (err) {
      console.warn('WebGPU not available:', err);
    }
  }
  return 'wasm'; // Fallback
}

const backend = await initEmbeddingBackend();
const model = await pipeline('feature-extraction', modelName, {
  device: backend
});
```

**Critical patterns:**
- Always provide WASM fallback
- WebGPU requires Chrome 113+, Safari 16.4+, Firefox 141+
- Test both backends (WebGPU can have driver issues)
- Show backend in UI for debugging

---

## Large Dataset Handling

### Chunking Strategy

```javascript
// ✅ CORRECT: Semantic chunking by syntax
function chunkFunction(funcNode, source) {
  const chunks = [];
  const statements = funcNode.descendantsOfType('statement');
  
  let currentChunk = [];
  let tokenCount = 0;
  const maxTokens = 200;
  
  for (const stmt of statements) {
    const stmtText = source.slice(stmt.startIndex, stmt.endIndex);
    const tokens = stmtText.split(/\s+/).length;
    
    if (tokenCount + tokens > maxTokens && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.map(s => s.text).join('\n'),
        start: currentChunk[0].start,
        end: currentChunk[currentChunk.length - 1].end
      });
      currentChunk = [];
      tokenCount = 0;
    }
    
    currentChunk.push({ text: stmtText, start: stmt.startIndex, end: stmt.endIndex });
    tokenCount += tokens;
  }
  
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.map(s => s.text).join('\n'),
      start: currentChunk[0].start,
      end: currentChunk[currentChunk.length - 1].end
    });
  }
  
  return chunks;
}
```

**Critical patterns:**
- Chunk by syntactic boundaries (not arbitrary splits)
- Maintain source offsets for highlighting
- Target 100-200 tokens per chunk
- Preserve context (don't split mid-expression)

### Progressive Loading

```javascript
// ✅ CORRECT: Progressive graph construction
class ProgressiveGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.loaded = 0;
    this.total = 0;
  }
  
  async addFile(file) {
    this.total++;
    const functions = await parseFile(file);
    
    // Add nodes immediately
    functions.forEach(fn => this.nodes.set(fn.id, fn));
    
    // Process edges in background
    requestIdleCallback(() => {
      this.processEdges(functions);
      this.loaded++;
      this.updateProgress();
    });
  }
  
  updateProgress() {
    const progress = (this.loaded / this.total) * 100;
    // Update UI
  }
}
```

**Performance tips:**
- Use `requestIdleCallback` for non-critical work
- Show progress for long operations
- Load high-priority nodes first (by centrality)
- Use virtual scrolling for large lists

### Memory-Efficient Data Structures

```javascript
// ✅ CORRECT: Typed arrays for embeddings
class EmbeddingStore {
  constructor(dimension) {
    this.dimension = dimension;
    this.vectors = new Float32Array(0); // Grow as needed
    this.count = 0;
  }
  
  add(embedding) {
    const newSize = (this.count + 1) * this.dimension;
    if (newSize > this.vectors.length) {
      const newVectors = new Float32Array(newSize * 2); // 2x growth
      newVectors.set(this.vectors);
      this.vectors = newVectors;
    }
    this.vectors.set(embedding, this.count * this.dimension);
    this.count++;
  }
}
```

**Gotchas:**
- Use TypedArrays for numeric data (smaller, faster)
- Quantize embeddings (Float32 → Int8) for storage
- Use ArrayBuffer for binary serialization

---

## Graph Layout Algorithms

### Force-Directed Layout

```javascript
// ✅ CORRECT: Efficient force simulation
function createForceLayout(nodes, edges) {
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges)
      .id(d => d.id)
      .distance(d => 1 / Math.sqrt(d.weight))) // Inverse weight
    .force('charge', d3.forceManyBody()
      .strength(d => -Math.sqrt(d.degree) * 50))
    .force('center', d3.forceCenter())
    .force('collision', d3.forceCollide()
      .radius(d => Math.sqrt(d.size) + 5));
  
  // Adaptive cooling
  simulation.alphaDecay(1 - Math.pow(0.001, 1 / 300)); // 300 ticks
  return simulation;
}
```

**Performance tips:**
- Use `forceCollide` to prevent node overlap
- Adjust forces based on graph size
- Stop simulation when stable (`alpha < threshold`)
- Use Barnes-Hut approximation for large graphs

### UMAP Seeding (Optional)

```javascript
// ✅ CORRECT: UMAP for initial layout
import { UMAP } from 'umap-js';

async function seedLayout(embeddings) {
  const umap = new UMAP({
    nComponents: 3, // 3D layout
    nNeighbors: 15,
    minDist: 0.1
  });
  
  const layout = umap.fit(embeddings);
  
  // Apply to nodes
  nodes.forEach((node, i) => {
    node.x = layout[i][0] * 100;
    node.y = layout[i][1] * 100;
    node.z = layout[i][2] * 100;
  });
}
```

**Gotchas:**
- UMAP is expensive (O(n²) for large graphs)
- Use only for initial layout, then refine with force simulation
- Sample nodes for very large graphs (>10k nodes)

### Community Detection

```javascript
// ✅ CORRECT: Louvain algorithm for communities
import { communities } from 'graphology-communities-louvain';

function detectCommunities(graph) {
  const communities = louvain(graph);
  
  // Assign colors by community
  graph.forEachNode((node, attrs) => {
    attrs.color = getCommunityColor(communities[node]);
  });
}
```

**Performance tips:**
- Run community detection once (expensive)
- Cache results for static graphs
- Update incrementally when possible

---

## Critical Checklist

- [ ] Three.js objects disposed when done
- [ ] Force simulation stopped when stable
- [ ] Instanced rendering for >1000 nodes
- [ ] Tree-sitter queries compiled and cached
- [ ] Embeddings batched (not one-by-one)
- [ ] WebGPU fallback to WASM
- [ ] Chunks sized 100-200 tokens
- [ ] Progressive loading for large datasets
- [ ] TypedArrays for numeric data
- [ ] Graph layout optimized for size
- [ ] Memory leaks checked (DevTools)

