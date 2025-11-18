/**
 * 3D Force-Directed Graph Visualization
 * 
 * Implements sections 3.7 and 11 from PLAN.md:
 * - 3D force-directed graph with 3d-force-graph
 * - Directional arrows/particles for call edges
 * - Labels on hover
 * - Click to focus
 * - Tooltip with filename, metrics, docstring
 * - Inspector panel integration
 * - Toggles for similarity edges, filters
 */

// 3d-force-graph will be loaded dynamically in initialize()

/**
 * GraphVisualization - Main 3D visualization controller
 */
export class GraphVisualization {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      showSimilarityEdges: true,
      showCallEdges: true,
      nodeSize: 4,
      linkWidth: 1,
      ...options
    };
    
    this.graph = null;
    this.data = {
      nodes: [],
      links: []
    };
    
    // Callbacks
    this.onNodeClick = null;
    this.onNodeHover = null;
    
    // State
    this.selectedNode = null;
    this.hoveredNode = null;
    this.hoveredNodeId = null;
    this.hoveredNeighbors = new Set();
    this.highlightNeighbors = true;
    this.adjacency = new Map();
    this.filteredLinks = [];

    this.customRenderer = null;
    this.boundResizeHandler = null;

    this.baseLinkOpacity = 0.6;
    this.minFadeOpacity = 0.12;
    this.currentNonNeighborOpacity = this.baseLinkOpacity;
    this.fadeTargetOpacity = this.baseLinkOpacity;
    this.fadeAnimationFrame = null;

    this.onHoverDetails = null;

    this.similarityStats = {
      count: 0,
      min: null,
      max: null
    };
    this.similarityOptions = {
      minWeight: 0
    };
    this.onSimilarityStatsChange = null;

    this.graphAnalysisSummary = null;
    this.centralityReference = {
      maxPageRank: null,
      maxBetweenness: null,
      maxDegree: null
    };
    this.currentAnalysisDigest = null;
    this.onAnalysisSummary = null;

    // Layout persistence metadata
    this.layoutStorageKey = 'helios:layout:last';
    this.layoutGraphHash = null;
    this.layoutStorageProvider = null;
    this.lastRestoredLayoutHash = null;
    this.lastLayoutLoadResult = { status: 'idle' };
    this.pendingAutoSaveTimer = null;
    this.autoSaveOnStability = true;
    this.autoSaveDebounceMs = 1500;
    this.autoFreezeOnStability = true;

    this.palettes = {
      languages: {
        javascript: '#f59e0b',
        typescript: '#3b82f6',
        python: '#22d3ee',
        default: '#a855f7'
      },
      communities: {
        saturation: 72,
        lightness: 58
      },
      edges: {
        callStatic: '#60a5fa',
        callDynamic: '#f97316',
        similarity: '#c084fc'
      },
      neutrals: {
        faded: '#94a3b8'
      },
      resolution: {
        resolved: '#60a5fa',
        ambiguous: '#facc15',
        unresolved: '#ef4444'
      }
    };

    this.performance = {
      mode: 'balanced',
      auto: true,
      lastReason: 'initial',
      lastSettleMs: null,
      runStart: null
    };
    this.performanceDirectionalParticles = true;
    this.performanceAutoFreeze = true;
    this.performancePresets = {
      balanced: {
        cooldownTicks: 140,
        cooldownTime: 15000,
        velocityDecay: 0.28,
        chargeStrength: -130,
        enableParticles: true,
        autoFreeze: true
      },
      performance: {
        cooldownTicks: 80,
        cooldownTime: 9000,
        velocityDecay: 0.42,
        chargeStrength: -90,
        enableParticles: false,
        autoFreeze: true
      }
    };

    this.onPerformanceChange = null;
  }

  getResolutionPalette() {
    const defaults = {
      resolved: this.palettes?.edges?.callStatic || '#60a5fa',
      ambiguous: '#facc15',
      unresolved: this.palettes?.edges?.callDynamic || '#ef4444'
    };
    return {
      ...defaults,
      ...(this.palettes?.resolution || {})
    };
  }

  /**
   * Initialize the 3D graph visualization
   */
  async initialize() {
    if (!this.container) {
      throw new Error('Container element required');
    }

    // Dynamically import 3d-force-graph with CDN fallback (avoids CORS on some CDNs)
    let ForceGraph3DModule;
    try {
      ForceGraph3DModule = await import('3d-force-graph');
    } catch (err) {
      console.warn('[GraphViz] Primary import failed, using jsDelivr fallback:', err?.message || err);
      ForceGraph3DModule = await import('https://cdn.jsdelivr.net/npm/3d-force-graph@1.70.25/dist/3d-force-graph.esm.min.js');
    }
    const ForceGraph3D = ForceGraph3DModule.default || ForceGraph3DModule.ForceGraph3D || ForceGraph3DModule;

    // Create 3D force graph
    const graphInstance = ForceGraph3D()(this.container)
      .nodeId('id')
      .nodeLabel(node => this.getNodeLabel(node))
      .nodeColor(node => this.getNodeColor(node))
      .nodeVal(node => this.getNodeSize(node))
      // .linkSource(link => link.sourceId || this.getLinkNodeId(link, 'source'))
      // .linkTarget(link => link.targetId || this.getLinkNodeId(link, 'target'))
      // .linkSource(link => this.getLinkNodeId(link, 'source'))
      // .linkTarget(link => this.getLinkNodeId(link, 'target'))
      .linkLabel(link => this.getLinkLabel(link))
      .linkColor(link => this.getLinkColor(link))
      .linkWidth(link => this.getLinkWidth(link))
      .linkDirectionalParticles(link => this.getLinkParticles(link))
      .linkDirectionalParticleColor(link => this.getLinkParticleColor(link))
      .linkDirectionalParticleSpeed(0.01)
      .linkDirectionalParticleWidth(3)
      .linkDirectionalArrowLength(6)
      .linkDirectionalArrowRelPos(1)
      .linkOpacity(link => this.getLinkDisplayOpacity(link))
      //.linkLineDash(link => this.getLinkDashArray(link))
      .nodeRelSize(6)
      .onNodeHover(node => this.handleNodeHover(node))
      .onNodeClick(node => this.handleNodeClick(node))
      .onNodeDrag(node => this.handleNodeDrag(node))
      .onBackgroundClick(() => this.handleBackgroundClick())
      .enableNodeDrag(true)
      .enableNavigationControls(true)
      .showNavInfo(false)
      .cameraPosition({ x: 0, y: 0, z: 1000 });

    // Try to access THREE.js from various locations
    // 3d-force-graph may load THREE.js internally, check multiple sources
    let threeLib = null;
    
    // Method 0: Try to import THREE.js directly (if available as a module)
    // The "Multiple instances" warning suggests THREE.js is being loaded
    try {
      const threeModule = await import('three');
      if (threeModule && threeModule.WebGLRenderer) {
        threeLib = threeModule;
      } else if (threeModule.default && threeModule.default.WebGLRenderer) {
        threeLib = threeModule.default;
      }
    } catch (err) {
      // THREE.js might not be available as a separate module
    }
    
    // First try the module itself
    if (!threeLib) {
      threeLib = ForceGraph3DModule.THREE ||
                 (ForceGraph3DModule.default && ForceGraph3DModule.default.THREE) ||
                 (ForceGraph3DModule.ForceGraph3D && ForceGraph3DModule.ForceGraph3D.THREE);
    }
    
    // If not found, check global scope (3d-force-graph may attach it)
    if (!threeLib) {
      if (typeof window !== 'undefined' && window.THREE) {
        threeLib = window.THREE;
      } else if (typeof globalThis !== 'undefined' && globalThis.THREE) {
        threeLib = globalThis.THREE;
      }
    }
    
    // If still not found, wait a bit and check again (3d-force-graph may load THREE.js async)
    // Or try to access it from the graph instance's internal renderer
    if (!threeLib && graphInstance) {
      // Try to get renderer from graph instance
      try {
        if (typeof graphInstance.renderer === 'function') {
          const existingRenderer = graphInstance.renderer();
          if (existingRenderer && existingRenderer.constructor && existingRenderer.constructor.name === 'WebGLRenderer') {
            // We have a renderer - get THREE from its constructor
            threeLib = existingRenderer.constructor || null;
          }
        }
      } catch (err) {
        // graphInstance.renderer() might not be available yet
      }
    }
    
    // Last resort: check if THREE was added to window after module load
    // Wait longer for async loading (3d-force-graph may load THREE.js async)
    if (!threeLib && typeof window !== 'undefined') {
      // Wait multiple ticks for async loading
      for (let i = 0; i < 3 && !threeLib; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (window.THREE && typeof window.THREE.WebGLRenderer === 'function') {
          threeLib = window.THREE;
          break;
        }
      }
    }
    
    // Try one more time: get THREE from the graph's renderer constructor
    // 3d-force-graph bundles THREE.js internally, we can extract it from the renderer
    if (!threeLib && graphInstance) {
      try {
        // Get renderer from graph instance
        let renderer = null;
        if (typeof graphInstance.renderer === 'function') {
          renderer = graphInstance.renderer();
        }
        
        if (renderer && renderer.constructor) {
          // THREE.js classes store the namespace in various places
          const RendererClass = renderer.constructor;
          
          // Method 1: Check if constructor has THREE property (some bundlers expose it)
          if (RendererClass.THREE && RendererClass.THREE.WebGLRenderer) {
            threeLib = RendererClass.THREE;
          }
          
          // Method 2: Try to find THREE via the scene object
          if (!threeLib && typeof graphInstance.scene === 'function') {
            try {
              const scene = graphInstance.scene();
              if (scene && scene.constructor) {
                const SceneClass = scene.constructor;
                // Check if Scene class has THREE reference
                if (SceneClass.THREE || (SceneClass.WebGLRenderer && SceneClass.Scene)) {
                  threeLib = SceneClass.THREE || SceneClass;
                }
              }
            } catch (err) {
              // Ignore
            }
          }
          
          // Method 3: Look for THREE in the renderer's prototype chain
          if (!threeLib) {
            let proto = RendererClass;
            while (proto && !threeLib) {
              // Some bundlers attach THREE to the constructor
              if (proto.THREE && typeof proto.THREE.WebGLRenderer === 'function') {
                threeLib = proto.THREE;
                break;
              }
              proto = Object.getPrototypeOf(proto);
            }
          }
        }
      } catch (err) {
        // Ignore errors
      }
    }

    if (threeLib && typeof threeLib.WebGLRenderer === 'function') {
      try {
        const renderer = new threeLib.WebGLRenderer({
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true
        });
        if (typeof renderer.setPixelRatio === 'function' && typeof window !== 'undefined') {
          renderer.setPixelRatio(window.devicePixelRatio || 1);
        }
        const { width, height } = this.getContainerDimensions();
        if (typeof renderer.setSize === 'function') {
          renderer.setSize(width, height, false);
        }
        // Try to set the renderer on the graph instance
        if (typeof graphInstance.renderer === 'function') {
          graphInstance.renderer(renderer);
          this.customRenderer = renderer;
          console.log('[GraphViz] Custom renderer configured with preserveDrawingBuffer for PNG export');
        } else {
          // Store renderer anyway, might be accessible via the canvas later
          this.customRenderer = renderer;
          console.warn('[GraphViz] Renderer created but graphInstance.renderer() not available; using fallback canvas lookup');
        }
      } catch (err) {
        console.warn('[GraphViz] Failed to create custom renderer:', err?.message || err);
      }
    } else {
      // THREE.js not found - this is okay, we'll use fallback canvas lookup for PNG export
      // The "Multiple instances" warning from THREE.js suggests it's loaded but not accessible
      console.debug('[GraphViz] THREE.js not found in module; PNG export will use fallback canvas lookup');
    }

    this.graph = graphInstance;

    if (typeof this.graph.onEngineStop === 'function') {
      this.graph.onEngineStop(() => this.handleEngineStop());
    }

    if (typeof window !== 'undefined' && !this.boundResizeHandler) {
      this.boundResizeHandler = () => this.handleResize();
      window.addEventListener('resize', this.boundResizeHandler, { passive: true });
    }

    // Mount to container
   // this.graph(this.container);

    this.applyPerformancePreset(this.performance.mode);
    // Set initial camera
    this.resetCamera();

    return this;
  }

  getContainerDimensions() {
    const width =
      (this.container && (this.container.clientWidth || this.container.offsetWidth)) ||
      (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height =
      (this.container && (this.container.clientHeight || this.container.offsetHeight)) ||
      (typeof window !== 'undefined' ? window.innerHeight : 600);
    return { width, height };
  }

  handleResize() {
    if (!this.customRenderer) {
      return;
    }
    const { width, height } = this.getContainerDimensions();
    if (typeof this.customRenderer.setSize === 'function') {
      this.customRenderer.setSize(width, height, false);
    }
  }

  /**
   * Load graph data (nodes and links)
   * @param {Object} data - { nodes: [], links: [] }
   */
  loadData(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
      throw new Error('Invalid graph data format');
    }

    const normalizedNodes = data.nodes.map(node => this.normalizeNode(node));
    const normalizedLinks = data.links.map(link => this.normalizeLink(link));

    this.data = {
      nodes: normalizedNodes,
      links: normalizedLinks
    };

    this.updateSimilarityStats(normalizedLinks);
    this.hoveredNode = null;
    this.hoveredNeighbors = new Set();
    this.hoveredNodeId = null;
    this.setFadeTarget(this.baseLinkOpacity, true);

    this.cancelPendingAutoSave();

    this.filteredLinks = this.filterLinks(normalizedLinks);
    this.buildAdjacencyMap(normalizedNodes, this.filteredLinks);

    this.applyGraphData();
    this.evaluatePerformancePreset(true);
    this.emitAnalysisSummary();

    return this;
  }

  setLayoutStorageKey(key, graphHash = null) {
    if (typeof key === 'string' && key.trim().length > 0) {
      this.layoutStorageKey = key.trim();
    }
    this.layoutGraphHash =
      typeof graphHash === 'string' && graphHash.trim().length > 0 ? graphHash.trim() : null;
  }

  setLayoutStorageProvider(provider) {
    if (provider && typeof provider === 'object') {
      this.layoutStorageProvider = provider;
    } else {
      this.layoutStorageProvider = null;
    }
  }

  getLastLayoutLoadResult() {
    return this.lastLayoutLoadResult;
  }

  getPerformanceState() {
    return {
      mode: this.performance.mode,
      auto: this.performance.auto,
      lastReason: this.performance.lastReason,
      lastSettleMs: this.performance.lastSettleMs,
      directionalParticles: this.performanceDirectionalParticles,
      autoFreeze: this.performanceAutoFreeze
    };
  }

  setPerformanceMode(mode, { reason = 'manual', auto = null } = {}) {
    if (!['balanced', 'performance'].includes(mode)) {
      return;
    }
    if (auto !== null) {
      this.performance.auto = !!auto;
    } else if (reason === 'manual') {
      this.performance.auto = false;
    }
    this.performance.lastReason = reason;
    if (this.performance.mode !== mode || reason === 'manual') {
      this.applyPerformancePreset(mode);
    } else {
      this.emitPerformanceState();
    }
  }

  setPerformanceAuto(enabled) {
    const next = !!enabled;
    if (this.performance.auto === next) {
      return;
    }
    this.performance.auto = next;
    this.performance.lastReason = next ? 'auto' : 'manual';
    if (next) {
      this.evaluatePerformancePreset(true);
    } else {
      this.emitPerformanceState();
    }
  }

  applyPerformancePreset(mode) {
    const preset = this.performancePresets[mode];
    if (!preset) {
      return;
    }

    if (this.graph) {
      if (typeof this.graph.cooldownTicks === 'function') {
        this.graph.cooldownTicks(preset.cooldownTicks);
      }
      if (typeof this.graph.cooldownTime === 'function') {
        this.graph.cooldownTime(preset.cooldownTime);
      }
      if (typeof this.graph.d3VelocityDecay === 'function') {
        this.graph.d3VelocityDecay(preset.velocityDecay);
      }
      const chargeForce = this.graph.d3Force && this.graph.d3Force('charge');
      if (chargeForce && typeof chargeForce.strength === 'function') {
        chargeForce.strength(preset.chargeStrength);
      }
    }

    this.performanceDirectionalParticles = preset.enableParticles !== false;
    this.performanceAutoFreeze = preset.autoFreeze !== false;
    this.performance.mode = mode;
    this.emitPerformanceState();
  }

  evaluatePerformancePreset(force = false) {
    if (!this.performance.auto) {
      if (force) {
        this.emitPerformanceState();
      }
      return;
    }
    const nodeCount = Array.isArray(this.data?.nodes) ? this.data.nodes.length : 0;
    const linkCount = Array.isArray(this.data?.links) ? this.data.links.length : 0;
    const heavy = nodeCount >= 250 || linkCount >= 700;
    const moderate = nodeCount >= 150 || linkCount >= 500;
    const desiredMode = heavy || moderate ? 'performance' : 'balanced';

    if (this.performance.mode !== desiredMode) {
      this.performance.lastReason = heavy ? 'node-count' : moderate ? 'graph-size' : 'auto';
      this.applyPerformancePreset(desiredMode);
    } else if (force) {
      this.emitPerformanceState();
    }
  }

  emitPerformanceState() {
    if (typeof this.onPerformanceChange === 'function') {
      this.onPerformanceChange(this.getPerformanceState());
    }
  }

  cancelPendingAutoSave() {
    if (this.pendingAutoSaveTimer) {
      clearTimeout(this.pendingAutoSaveTimer);
      this.pendingAutoSaveTimer = null;
    }
  }

  scheduleAutoSave() {
    if (!this.autoSaveOnStability) {
      return;
    }
    if (!this.layoutStorageKey) {
      return;
    }
    if (!Array.isArray(this.data?.nodes) || this.data.nodes.length === 0) {
      return;
    }
    this.cancelPendingAutoSave();
    this.pendingAutoSaveTimer = setTimeout(async () => {
      this.pendingAutoSaveTimer = null;
      try {
        await this.saveLayoutToStorage();
      } catch (err) {
        console.warn('GraphVisualization.autoSave failed:', err);
      }
    }, this.autoSaveDebounceMs);
  }

  getNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  handleEngineStop() {
    const now = this.getNow();
    if (typeof this.performance.runStart === 'number') {
      this.performance.lastSettleMs = Math.max(0, now - this.performance.runStart);
      this.performance.runStart = null;
    }
    if (this.performanceAutoFreeze && this.autoFreezeOnStability) {
      this.pauseSimulation(true);
    }
    this.scheduleAutoSave();
    this.emitPerformanceState();
  }

  /**
   * Normalize node data to expected format
   */
  normalizeNode(node) {
    const metrics = node && typeof node.metrics === 'object' ? { ...node.metrics } : {};
    const normalized = {
      ...node,
      id: node.id || node.fqName || node.name,
      fqName: node.fqName || node.name || node.id,
      name: node.name || node.fqName || node.id,
      filePath: node.filePath || '',
      lang: node.lang || 'javascript',
      moduleId: node.moduleId || null,
      isVirtual: !!node.isVirtual,
      size: node.size || node.loc || 0,
      metrics,
      doc: node.doc || '',
      x: node.x,
      y: node.y,
      z: node.z
    };

    normalized.community = this.getNodeCommunity(normalized);
    normalized.coreNumber = this.getNodeCoreNumber(normalized);
    normalized.centralityDetails = this.getNodeCentralityMetrics(normalized);
    normalized.centralityScore = this.computeCentralityScore(normalized);
    normalized.locSize = this.deriveLocSize(normalized);

    const baseColor = this.resolveBaseColor(normalized);
    normalized.baseColor = baseColor;
    normalized.color = baseColor;

    return normalized;
  }

  /**
   * Normalize link data to expected format
   */
  normalizeLink(link) {
    const sourceId = this.getLinkNodeId(link, 'source');
    const targetId = this.getLinkNodeId(link, 'target');
    const metadata = link.metadata || {};
    const type = link.type || metadata.type || 'call';

    const similarity =
      typeof link.similarity === 'number'
        ? link.similarity
        : typeof metadata.similarity === 'number'
          ? metadata.similarity
          : null;

    const normalized = {
      ...link,
      source: sourceId,
      target: targetId,
      sourceId,
      targetId,
      type,
      weight: typeof link.weight === 'number' ? link.weight : typeof link.sim === 'number' ? link.sim : similarity ?? 1,
      dynamic: link.dynamic || false,
      similarity,
      method: link.method || metadata.method || null,
      topPairs: link.topPairs || metadata.topPairs || [],
      metadata
    };

    if (normalized.type === 'call') {
      const resolution = link.resolution || metadata.resolution || null;
      const resolutionStatus = link.resolutionStatus || resolution?.status || 'resolved';
      normalized.resolution = resolution;
      normalized.resolutionStatus = resolutionStatus;
      normalized.resolutionReason = link.resolutionReason || resolution?.reason || '';
      normalized.importInfo = link.importInfo || resolution?.importInfo || null;
    } else {
      normalized.resolution = null;
      normalized.resolutionStatus = null;
      normalized.resolutionReason = '';
      normalized.importInfo = null;
    }

    return normalized;
  }

  filterLinks(links = []) {
    return links.filter(link => {
      if (link.type === 'call') {
        if (!this.options.showCallEdges) {
          return false;
        }
        return true;
      }
      if (link.type === 'similarity') {
        if (!this.options.showSimilarityEdges) {
          return false;
        }
        if (this.similarityStats.count > 0) {
          const weight = this.getSimilarityWeight(link);
          if (!Number.isFinite(weight) || weight < this.similarityOptions.minWeight) {
            return false;
          }
        }
        return true;
      }
      return true;
    });
  }

  updateSimilarityStats(links = []) {
    const similarityLinks = links.filter(link => link.type === 'similarity');
    const previousThreshold = Number.isFinite(this.similarityOptions.minWeight)
      ? this.similarityOptions.minWeight
      : 0;

    if (similarityLinks.length === 0) {
      this.similarityStats = { count: 0, min: null, max: null };
      this.similarityOptions.minWeight = 0;
      if (typeof this.onSimilarityStatsChange === 'function') {
        this.onSimilarityStatsChange({ ...this.similarityStats }, { minWeight: this.similarityOptions.minWeight });
      }
      return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    similarityLinks.forEach(link => {
      const weight = this.getSimilarityWeight(link);
      if (!Number.isFinite(weight)) {
        return;
      }
      if (weight < min) min = weight;
      if (weight > max) max = weight;
    });

    if (!Number.isFinite(min)) {
      min = 0;
    }
    if (!Number.isFinite(max)) {
      max = min === 0 ? 1 : min;
    }

    this.similarityStats = {
      count: similarityLinks.length,
      min,
      max
    };

    let nextThreshold = previousThreshold;
    if (!Number.isFinite(nextThreshold) || nextThreshold < min || nextThreshold > max) {
      nextThreshold = min;
    }
    this.similarityOptions.minWeight = this.clamp(nextThreshold, min, max);

    if (typeof this.onSimilarityStatsChange === 'function') {
      this.onSimilarityStatsChange({ ...this.similarityStats }, { minWeight: this.similarityOptions.minWeight });
    }
  }

  setSimilarityThreshold(value) {
    if (!this.similarityStats.count) {
      this.similarityOptions.minWeight = 0;
      return;
    }
    const min = this.similarityStats.min ?? 0;
    const max = this.similarityStats.max ?? min;
    let next = Number.isFinite(value) ? value : min;
    next = this.clamp(next, min, max);
    if (this.similarityOptions.minWeight === next) {
      return;
    }
    this.similarityOptions.minWeight = next;
    this.filteredLinks = this.filterLinks(this.data?.links || []);
    this.buildAdjacencyMap(this.data?.nodes || [], this.filteredLinks);
    this.applyGraphData();
    if (typeof this.onSimilarityStatsChange === 'function') {
      this.onSimilarityStatsChange({ ...this.similarityStats }, { minWeight: this.similarityOptions.minWeight });
    }
  }

  getSimilarityWeight(link) {
    if (!link) {
      return 0;
    }
    if (typeof link.similarity === 'number') {
      return link.similarity;
    }
    if (typeof link.representativeSimilarity === 'number') {
      return link.representativeSimilarity;
    }
    if (typeof link.weight === 'number') {
      return link.weight;
    }
    const similarityMeta = link.metadata && link.metadata.similarity;
    if (typeof similarityMeta === 'number') {
      return similarityMeta;
    }
    return 0;
  }

  normalizeSimilarityWeight(weight) {
    if (!Number.isFinite(weight)) {
      return 0;
    }
    const { min, max } = this.similarityStats;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return weight;
    }
    return (weight - min) / (max - min);
  }

  getSimilarityOpacity(weight) {
    if (!this.similarityStats.count) {
      return this.baseLinkOpacity;
    }
    const normalized = this.normalizeSimilarityWeight(weight);
    const alpha = this.scaleValue(normalized, [0, 1], [0.25, 0.85]);
    return this.clamp(alpha, 0.05, 1);
  }

  /**
   * Get node label for hover tooltip
   */
  getNodeLabel(node) {
    if (!node) return '';
    
    const parts = [];
    if (node.fqName) parts.push(node.fqName);
    if (node.filePath) parts.push(`\n${node.filePath}`);
    if (node.size) parts.push(`\n${node.size} LOC`);
    const centrality = this.getNodeCentralityMetrics(node);
    if (Number.isFinite(centrality.pageRank)) {
      parts.push(`\nPR: ${centrality.pageRank.toFixed(3)}`);
    }
    if (Number.isFinite(centrality.betweenness)) {
      parts.push(`\nBC: ${centrality.betweenness.toFixed(3)}`);
    }
    if (Number.isFinite(centrality.degree)) {
      parts.push(`\nDegree: ${Math.round(centrality.degree)}`);
    }
    const community = this.getNodeCommunity(node);
    if (community !== undefined && community !== null) {
      parts.push(`\nCommunity: ${community}`);
    }
    const coreNumber = this.getNodeCoreNumber(node);
    if (Number.isFinite(coreNumber)) {
      parts.push(`\nCore: ${coreNumber}`);
    }
    
    return parts.join('');
  }

  /**
   * Get node color (by community or default)
   */
  getNodeColor(node) {
    const baseColor = node.baseColor || this.resolveBaseColor(node);

    if (!this.highlightNeighbors || !this.hoveredNodeId) {
      return baseColor;
    }

    if (node.id === this.hoveredNodeId) {
      return baseColor;
    }

    if (this.hoveredNeighbors.has(node.id)) {
      return baseColor;
    }

    const fadeRatio = Math.max(0.2, (this.currentNonNeighborOpacity / this.baseLinkOpacity) * 0.5);
    return `rgba(148, 163, 184, ${fadeRatio.toFixed(2)})`;
  }

  resolveBaseColor(node) {
    if (node && typeof node.color === 'string' && node.color.length) {
      return node.color;
    }

    if (node && typeof node.baseColor === 'string' && node.baseColor.length) {
      return node.baseColor;
    }

    if (node && node.isVirtual) {
      const resolutionPalette = this.getResolutionPalette();
      return this.colorWithAlpha(resolutionPalette.unresolved, 0.75);
    }

    if (node && node.community !== undefined && node.community !== null) {
      return this.getCommunityColor(node.community);
    }

    const langKey = (node?.lang || '').toLowerCase();
    return this.palettes.languages[langKey] || this.palettes.languages.default;
  }

  /**
   * Get community color (hash-based for consistency)
   */
  getCommunityColor(communityId) {
    // Simple hash function for consistent colors
    const hue = (communityId * 137.508) % 360;
    return `hsl(${Math.round(hue)}, ${this.palettes.communities.saturation}%, ${this.palettes.communities.lightness}%)`;
  }

  computeCentralityScore(node, reference = null) {
    if (!node) return null;
    const ref = reference || this.centralityReference || {};
    const centrality = this.getNodeCentralityMetrics(node);
    if (!centrality) {
      return null;
    }

    if (Number.isFinite(centrality.pageRank)) {
      const max = Number.isFinite(ref.maxPageRank) ? ref.maxPageRank : centrality.pageRank;
      const normalized = max > 0 ? centrality.pageRank / max : centrality.pageRank;
      return this.clamp(normalized, 0, 1);
    }

    if (Number.isFinite(centrality.normalizedDegree)) {
      return this.clamp(centrality.normalizedDegree, 0, 1);
    }

    if (Number.isFinite(centrality.betweenness)) {
      const max = Number.isFinite(ref.maxBetweenness) ? ref.maxBetweenness : centrality.betweenness;
      const normalized = max > 0 ? centrality.betweenness / max : centrality.betweenness;
      return this.clamp(normalized, 0, 1);
    }

    if (Number.isFinite(centrality.degree)) {
      const max = Number.isFinite(ref.maxDegree) ? ref.maxDegree : centrality.degree;
      const normalized = max > 0 ? centrality.degree / max : centrality.degree;
      return this.clamp(normalized, 0, 1);
    }

    return null;
  }

  deriveLocSize(node) {
    if (!node) return null;

    const loc = typeof node.loc === 'number'
      ? node.loc
      : typeof node.size === 'number'
        ? node.size
        : null;

    if (loc === null || !Number.isFinite(loc)) {
      return null;
    }

    const scaled = Math.log10(Math.max(1, loc));
    return this.clamp(scaled / 4, 0, 1);
  }

  scaleValue(value, [inMin, inMax], [outMin, outMax]) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return outMin;
    }

    const clampedInMax = inMax === inMin ? inMin + 1 : inMax;
    const ratio = (value - inMin) / (clampedInMax - inMin);
    const normalized = this.clamp(ratio, 0, 1);
    return outMin + normalized * (outMax - outMin);
  }

  colorWithAlpha(hexColor, alpha = 1) {
    const rgb = this.hexToRgb(hexColor);
    if (!rgb) {
      return `rgba(255, 255, 255, ${this.clamp(alpha, 0, 1)})`;
    }
    const clampedAlpha = this.clamp(alpha, 0, 1);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
  }

  hexToRgb(hexColor) {
    if (typeof hexColor !== 'string') return null;
    const sanitized = hexColor.replace('#', '');

    if (![3, 6].includes(sanitized.length)) {
      return null;
    }

    const expanded = sanitized.length === 3
      ? sanitized.split('').map(ch => ch + ch).join('')
      : sanitized;

    const intVal = parseInt(expanded, 16);
    if (Number.isNaN(intVal)) {
      return null;
    }

    return {
      r: (intVal >> 16) & 255,
      g: (intVal >> 8) & 255,
      b: intVal & 255
    };
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  setAnalysisSummary(summary) {
    this.graphAnalysisSummary = summary || null;
    this.emitAnalysisSummary();
    if (this.graph) {
      if (typeof this.graph.nodeVal === 'function') {
        this.graph.nodeVal(this.graph.nodeVal());
      }
      if (typeof this.graph.nodeColor === 'function') {
        this.graph.nodeColor(this.graph.nodeColor());
      }
      this.repaintGraph();
    }
  }

  emitAnalysisSummary() {
    const digest = this.buildAnalysisDigest();
    this.currentAnalysisDigest = digest;
    if (typeof this.onAnalysisSummary === 'function') {
      this.onAnalysisSummary(digest);
    }
  }

  buildAnalysisDigest() {
    const nodes = Array.isArray(this.data?.nodes) ? this.data.nodes : [];
    const links = Array.isArray(this.data?.links) ? this.data.links : [];

    const counts = {
      nodes: nodes.length,
      edges: links.length,
      callEdges: links.filter(link => link.type === 'call').length,
      similarityEdges: links.filter(link => link.type === 'similarity').length
    };

    const maxima = this.computeCentralityMaxima(this.graphAnalysisSummary, nodes);
    this.centralityReference = maxima;

    const topCentral = nodes
      .map(node => {
        const centrality = this.getNodeCentralityMetrics(node);
        const score = this.computeCentralityScore(node, maxima);
        return {
          id: node.id,
          name: node.fqName || node.name || node.id,
          score,
          pageRank: centrality.pageRank,
          betweenness: centrality.betweenness
        };
      })
      .filter(entry => Number.isFinite(entry.score))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5)
      .map(entry => ({
        ...entry,
        score: Number.isFinite(entry.score) ? Number(entry.score.toFixed(3)) : null,
        pageRank: Number.isFinite(entry.pageRank) ? Number(entry.pageRank.toFixed(3)) : null,
        betweenness: Number.isFinite(entry.betweenness) ? Number(entry.betweenness.toFixed(3)) : null
      }));

    const communityMap = new Map();
    nodes.forEach(node => {
      const community = this.getNodeCommunity(node);
      if (community === undefined || community === null) {
        return;
      }
      const entry = communityMap.get(community) || { community, count: 0 };
      entry.count += 1;
      communityMap.set(community, entry);
    });

    const communityList = Array.from(communityMap.values()).sort((a, b) => b.count - a.count);
    const topCommunities = communityList.slice(0, 5);
    const modularity = this.graphAnalysisSummary?.communities?.modularity;

    const coreCounts = new Map();
    let maxCoreNumber = null;
    nodes.forEach(node => {
      const coreNumber = this.getNodeCoreNumber(node);
      if (coreNumber === undefined || coreNumber === null) {
        return;
      }
      const entry = coreCounts.get(coreNumber) || { coreNumber, count: 0 };
      entry.count += 1;
      coreCounts.set(coreNumber, entry);
      if (maxCoreNumber === null || coreNumber > maxCoreNumber) {
        maxCoreNumber = coreNumber;
      }
    });
    const coreList = Array.from(coreCounts.values()).sort((a, b) => b.coreNumber - a.coreNumber);

    return {
      counts,
      centrality: {
        top: topCentral,
        reference: maxima
      },
      communities: {
        total: communityMap.size,
        modularity: Number.isFinite(modularity) ? modularity : null,
        top: topCommunities
      },
      cores: {
        degeneracy: Number.isFinite(this.graphAnalysisSummary?.cliques?.degeneracy)
          ? this.graphAnalysisSummary.cliques.degeneracy
          : null,
        top: coreList[0] || null
      }
    };
  }

  computeCentralityMaxima(summary, nodes) {
    const maxima = {
      maxPageRank: null,
      maxBetweenness: null,
      maxDegree: null
    };

    if (summary?.centrality?.pageRank) {
      const values = Object.values(summary.centrality.pageRank).filter(Number.isFinite);
      if (values.length) {
        maxima.maxPageRank = Math.max(...values);
      }
    }
    if (summary?.centrality?.betweenness) {
      const values = Object.values(summary.centrality.betweenness).filter(Number.isFinite);
      if (values.length) {
        maxima.maxBetweenness = Math.max(...values);
      }
    }
    if (summary?.centrality?.degree) {
      const values = Object.values(summary.centrality.degree)
        .map(value => {
          if (typeof value === 'number') {
            return value;
          }
          if (value && typeof value === 'object' && Number.isFinite(value.total)) {
            return value.total;
          }
          return null;
        })
        .filter(Number.isFinite);
      if (values.length) {
        maxima.maxDegree = Math.max(...values);
      }
    }

    if (!Number.isFinite(maxima.maxPageRank)) {
      nodes.forEach(node => {
        const centrality = this.getNodeCentralityMetrics(node);
        if (Number.isFinite(centrality.pageRank)) {
          maxima.maxPageRank = Math.max(maxima.maxPageRank ?? centrality.pageRank, centrality.pageRank);
        }
      });
    }
    if (!Number.isFinite(maxima.maxBetweenness)) {
      nodes.forEach(node => {
        const centrality = this.getNodeCentralityMetrics(node);
        if (Number.isFinite(centrality.betweenness)) {
          maxima.maxBetweenness = Math.max(maxima.maxBetweenness ?? centrality.betweenness, centrality.betweenness);
        }
      });
    }
    if (!Number.isFinite(maxima.maxDegree)) {
      nodes.forEach(node => {
        const centrality = this.getNodeCentralityMetrics(node);
        if (Number.isFinite(centrality.degree)) {
          maxima.maxDegree = Math.max(maxima.maxDegree ?? centrality.degree, centrality.degree);
        }
      });
    }

    return maxima;
  }

  getNodeCommunity(node) {
    if (!node) {
      return null;
    }
    if (node.community !== undefined && node.community !== null) {
      return node.community;
    }
    const metrics = node.metrics || {};
    const communities = metrics.communities;
    if (communities && typeof communities === 'object') {
      if (communities.community !== undefined && communities.community !== null) {
        return communities.community;
      }
      const keys = Object.keys(communities);
      for (const key of keys) {
        const value = communities[key];
        if (value !== null && value !== undefined) {
          return value;
        }
      }
    }
    if (metrics.community !== undefined && metrics.community !== null) {
      return metrics.community;
    }
    return null;
  }

  getNodeCoreNumber(node) {
    if (!node) {
      return null;
    }
    if (typeof node.coreNumber === 'number' && Number.isFinite(node.coreNumber)) {
      return node.coreNumber;
    }
    const metrics = node.metrics || {};
    if (typeof metrics.coreNumber === 'number' && Number.isFinite(metrics.coreNumber)) {
      return metrics.coreNumber;
    }
    const cores = metrics.cores;
    if (cores && typeof cores === 'object') {
      if (typeof cores.coreNumber === 'number' && Number.isFinite(cores.coreNumber)) {
        return cores.coreNumber;
      }
      const keys = Object.keys(cores);
      for (const key of keys) {
        const value = cores[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
      }
    }
    return null;
  }

  getNodeCentralityMetrics(node) {
    if (!node) {
      return {};
    }
    if (node.centralityDetails && typeof node.centralityDetails === 'object') {
      return node.centralityDetails;
    }
    const metrics = node.metrics || {};
    const centrality = metrics.centrality || {};
    const degreeInfo = centrality.degree;

    const pageRank = this.asFiniteNumber(
      centrality.pageRank ?? centrality.pagerank ?? node.pageRank
    );
    const betweenness = this.asFiniteNumber(centrality.betweenness ?? node.betweenness);
    const degreeTotal = this.asFiniteNumber(
      typeof degreeInfo === 'number' ? degreeInfo : degreeInfo?.total
    );
    const degreeIn = this.asFiniteNumber(degreeInfo?.in);
    const degreeOut = this.asFiniteNumber(degreeInfo?.out);
    let normalizedDegree = this.asFiniteNumber(degreeInfo?.normalized ?? centrality.normalizedDegree);
    if (normalizedDegree === null && Number.isFinite(degreeTotal) && Number.isFinite(this.centralityReference?.maxDegree)) {
      const max = this.centralityReference.maxDegree;
      normalizedDegree = max > 0 ? degreeTotal / max : null;
    }

    return {
      pageRank,
      betweenness,
      degree: degreeTotal,
      degreeIn,
      degreeOut,
      normalizedDegree
    };
  }

  asFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /**
   * Get node size (by centrality or default)
   */
  getNodeSize(node) {
    const centralityScore = this.computeCentralityScore(node);
    const centralitySize = centralityScore !== null
      ? this.scaleValue(centralityScore, [0, 1], [4, 16])
      : null;

    const locSize = node.locSize !== null
      ? this.scaleValue(node.locSize, [0, 1], [3, 12])
      : null;

    const baseSize = centralitySize ?? locSize ?? this.options.nodeSize;

    if (!this.highlightNeighbors || !this.hoveredNodeId) {
      return baseSize;
    }

    if (node.id === this.hoveredNodeId) {
      return Math.min(baseSize * 1.6, 30);
    }

    if (this.hoveredNeighbors.has(node.id)) {
      return Math.min(baseSize * 1.25, 24);
    }

    return Math.max(2, baseSize * 0.9);
  }

  /**
   * Get link label
   */
  getLinkLabel(link) {
    if (link.type === 'call') {
      const parts = [`Call (${link.weight || 1} call${link.weight !== 1 ? 's' : ''})`];
      if (link.resolutionStatus) {
        parts.push(link.resolutionStatus.toUpperCase());
      }
      if (link.dynamic) {
        parts.push('dynamic');
      }
      if (link.resolutionReason) {
        parts.push(link.resolutionReason);
      }
      return parts.join('\n');
    } else if (link.type === 'similarity') {
      return `Similarity: ${(link.weight || 0).toFixed(2)}`;
    }
    return '';
  }

  /**
   * Get link color
   */
  getLinkColor(link) {
    const resolutionPalette = this.getResolutionPalette();
    if (link.type === 'call') {
      if (link.resolutionStatus === 'unresolved') {
        return this.colorWithAlpha(resolutionPalette.unresolved, link.dynamic ? 0.95 : 0.85);
      }
      if (link.resolutionStatus === 'ambiguous') {
        return this.colorWithAlpha(resolutionPalette.ambiguous, 0.8);
      }
      if (link.dynamic) {
        return this.colorWithAlpha(this.palettes.edges.callDynamic, 0.78);
      }
      return this.colorWithAlpha(this.palettes.edges.callStatic, 0.72);
    } else if (link.type === 'similarity') {
      const weight = this.getSimilarityWeight(link);
      const alpha = this.getSimilarityOpacity(weight);
      return this.colorWithAlpha(this.palettes.edges.similarity, alpha);
    }
    return this.colorWithAlpha('#ffffff', 0.3);
  }

  /**
   * Get link width
   */
  getLinkWidth(link) {
    const weight = Math.max(0, link.weight || link.sim || 1);

    if (link.type === 'similarity') {
      const similarityWeight = this.getSimilarityWeight(link);
      if (this.similarityStats.count) {
        const min = this.similarityStats.min ?? 0;
        const max = this.similarityStats.max ?? (min === 0 ? 1 : min + 1);
        const denom = max === min ? max + 1 : max;
        const scaled = this.scaleValue(similarityWeight, [min, denom], [0.4, 2.4]);
        return Number(this.clamp(scaled, 0.2, 3).toFixed(2));
      }
      const scaled = this.scaleValue(similarityWeight, [0, 1], [0.4, 1.6]);
      return Number(this.clamp(scaled, 0.2, 2).toFixed(2));
    }

    const logWeight = Math.log2(weight + 1);
    const scaled = this.scaleValue(logWeight, [0, 4], [1.2, 4.5]);

    return Number(scaled.toFixed(2));
  }

  getLinkDisplayOpacity(link) {
    if (!this.highlightNeighbors || !this.hoveredNodeId) {
      if (link.type === 'similarity') {
        const weight = this.getSimilarityWeight(link);
        return this.getSimilarityOpacity(weight);
      }
      return this.baseLinkOpacity;
    }

    const sourceId = this.getLinkNodeId(link, 'source');
    const targetId = this.getLinkNodeId(link, 'target');
    if (!sourceId || !targetId) {
      return this.baseLinkOpacity;
    }

    const isNeighbor = sourceId === this.hoveredNodeId || targetId === this.hoveredNodeId;
    if (link.type === 'similarity') {
      const weight = this.getSimilarityWeight(link);
      const alpha = this.getSimilarityOpacity(weight);
      return isNeighbor ? alpha : Math.min(alpha, this.currentNonNeighborOpacity);
    }
    return isNeighbor ? 1 : this.currentNonNeighborOpacity;
  }

  /**
   * Helper to retrieve source/target ids regardless of object mutation
   */
  getLinkNodeId(link, key) {
    if (!link) return undefined;
    const value = link[key];
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      return value.id || value.fqName || value.name;
    }
    return value;
  }

  /**
   * Get directional particles for links
   */
  getLinkParticles(link) {
    // Only show particles on call edges
    if (link.type === 'call') {
      if (!this.performanceDirectionalParticles) {
        return 0;
      }
      if (link.resolutionStatus === 'unresolved') {
        return 0;
      }
      if (link.resolutionStatus === 'ambiguous') {
        return 1;
      }
      const weight = Math.max(1, link.weight || 1);
      return Math.min(6, Math.max(link.dynamic ? 2 : 1, Math.floor(Math.log2(weight + 1)) + (link.dynamic ? 1 : 0)));
    }
    return 0;
  }

  getLinkParticleColor(link) {
    const resolutionPalette = this.getResolutionPalette();
    if (link.type !== 'call') {
      const weight = this.getSimilarityWeight(link);
      const alpha = Math.max(0.25, this.getSimilarityOpacity(weight));
      return this.colorWithAlpha(this.palettes.edges.similarity, alpha);
    }

    if (link.resolutionStatus === 'unresolved') {
      return this.colorWithAlpha(resolutionPalette.unresolved, 0.8);
    }

    if (link.resolutionStatus === 'ambiguous') {
      return this.colorWithAlpha(resolutionPalette.ambiguous, 0.75);
    }

    const base = link.dynamic ? this.palettes.edges.callDynamic : this.palettes.edges.callStatic;
    const alpha = link.dynamic ? 0.9 : 0.7;
    return this.colorWithAlpha(base, alpha);
  }

  getLinkDashArray(link) {
    if (link.type === 'similarity') {
      return [2, 6];
    }
    if (link.type === 'call') {
      if (link.resolutionStatus === 'unresolved') {
        return [2, 2];
      }
      if (link.resolutionStatus === 'ambiguous') {
        return [6, 4];
      }
      if (link.dynamic) {
        return [4, 6];
      }
    }
    return null;
  }

  updateHoverState(node) {
    this.hoveredNode = node || null;

    if (!this.highlightNeighbors) {
      this.hoveredNodeId = node ? node.id : null;
      this.hoveredNeighbors = new Set();
      this.setFadeTarget(this.baseLinkOpacity, true);
      this.emitHoverDetails(node);
      return;
    }

    if (node) {
      this.hoveredNodeId = node.id;
      const neighbors = this.adjacency.get(node.id);
      this.hoveredNeighbors = new Set(neighbors || []);
      this.setFadeTarget(this.minFadeOpacity);
    } else {
      this.hoveredNodeId = null;
      this.hoveredNeighbors = new Set();
      this.setFadeTarget(this.baseLinkOpacity);
    }

    this.emitHoverDetails(node);
    this.repaintGraph();
  }

  emitHoverDetails(node) {
    if (!this.onHoverDetails) {
      return;
    }

    if (!node) {
      this.onHoverDetails(null);
      return;
    }

    const neighborIds = Array.from(this.adjacency.get(node.id) || []);
    const neighbors = neighborIds
      .map(id => this.getNodeById(id))
      .filter(Boolean);

    const community = this.getNodeCommunity(node);
    const coreNumber = this.getNodeCoreNumber(node);
    const centralityMetrics = this.getNodeCentralityMetrics(node);
    const centralityScore = this.computeCentralityScore(node);

    let callOutgoing = 0;
    let callIncoming = 0;
    let similarityEdges = 0;
    let resolvedEdges = 0;
    let ambiguousEdges = 0;
    let unresolvedEdges = 0;
    const similarityList = [];

    const activeLinks = this.filteredLinks && this.filteredLinks.length
      ? this.filteredLinks
      : this.data?.links || [];

    activeLinks.forEach(link => {
      const sourceId = this.getLinkNodeId(link, 'source');
      const targetId = this.getLinkNodeId(link, 'target');
      if (sourceId !== node.id && targetId !== node.id) {
        return;
      }

      if (link.type === 'call') {
        if (sourceId === node.id) callOutgoing += 1;
        if (targetId === node.id) callIncoming += 1;
        if (link.resolutionStatus === 'unresolved') {
          unresolvedEdges += 1;
        } else if (link.resolutionStatus === 'ambiguous') {
          ambiguousEdges += 1;
        } else {
          resolvedEdges += 1;
        }
      } else if (link.type === 'similarity') {
        similarityEdges += 1;
        const neighborId = sourceId === node.id ? targetId : sourceId;
        const neighborNode = this.getNodeById(neighborId);
        similarityList.push({
          nodeId: neighborId,
          node: neighborNode,
          weight: this.getSimilarityWeight(link),
          method: link.method || (link.metadata && link.metadata.method) || 'similarity',
          topPairs: link.topPairs || link.metadata?.topPairs || []
        });
      }
    });

    similarityList.sort((a, b) => (b.weight || 0) - (a.weight || 0));

    this.onHoverDetails({
      node,
      neighborCount: neighborIds.length,
      neighbors: neighbors.slice(0, 8).map(n => ({
        id: n.id,
        name: n.fqName || n.name,
        filePath: n.filePath,
        lang: n.lang
      })),
      similarity: similarityList.slice(0, 8),
      stats: {
        callOutgoing,
        callIncoming,
        similarityEdges,
        centralityScore,
        centrality: centralityMetrics,
        community,
        coreNumber,
        topSimilarity: similarityList.slice(0, 3),
        resolution: {
          resolved: resolvedEdges,
          ambiguous: ambiguousEdges,
          unresolved: unresolvedEdges
        }
      }
    });
  }

  /**
   * Handle node hover
   */
  handleNodeHover(node) {
    const nextId = node ? node.id : null;
    const prevId = this.hoveredNodeId;
    const sameNode =
      prevId === nextId &&
      ((node === null && this.hoveredNode === null) ||
        (node && this.hoveredNode && this.hoveredNode === node));

    if (!sameNode) {
      this.updateHoverState(node);
    }

    if (this.onNodeHover) {
      this.onNodeHover(node);
    }
  }

  /**
   * Handle node click
   */
  handleNodeClick(node) {
    this.selectedNode = node;
    const edgeSummary = node ? this.getEdgeSummary(node.id) : null;

    if (this.onNodeClick) {
      this.onNodeClick(node, edgeSummary);
    }
    
    // Focus camera on node
    if (node && this.graph) {
      const distance = 300;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
      
      this.graph.cameraPosition(
        {
          x: node.x * distRatio,
          y: node.y * distRatio,
          z: node.z * distRatio
        },
        node, // Look at node
        3000 // Animation duration
      );
    }
  }

  /**
   * Handle node drag
   */
  handleNodeDrag(node) {
    // Update node position
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
    }
  }

  /**
   * Handle background click (deselect)
   */
  handleBackgroundClick() {
    this.selectedNode = null;
    
    if (this.onNodeClick) {
      this.onNodeClick(null);
    }

    this.updateHoverState(null);
  }

  /**
   * Reset camera to default position
   */
  resetCamera() {
    if (this.graph) {
      this.graph.cameraPosition({ x: 0, y: 0, z: 1000 });
    }
  }

  /**
   * Fit view to show all nodes
   */
  fitToView() {
    if (!this.graph || this.data.nodes.length === 0) return;
    
    // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    this.data.nodes.forEach(node => {
      if (node.x !== undefined) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
      }
      if (node.y !== undefined) {
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
      }
      if (node.z !== undefined) {
        minZ = Math.min(minZ, node.z);
        maxZ = Math.max(maxZ, node.z);
      }
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const distance = size * 1.5;
    
    this.graph.cameraPosition(
      { x: centerX, y: centerY, z: centerZ + distance },
      { x: centerX, y: centerY, z: centerZ },
      2000
    );
  }

  applyGraphData() {
    if (!this.graph || !this.data) {
      return;
    }

    const nodes = this.data.nodes || [];
    const allLinks = this.filteredLinks || this.data.links || [];
  
    // Filter out links with undefined source/target
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = allLinks.filter(link => {
      const sourceId = this.getLinkNodeId(link, 'source');
      const targetId = this.getLinkNodeId(link, 'target');
      if (!sourceId || !targetId) {
        console.warn('Skipping link with undefined node:', link);
        return false;
      }
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
        console.warn('Skipping link with missing node:', { sourceId, targetId });
        return false;
      }
      return true;
    });
  
    console.log(`Rendering ${nodes.length} nodes and ${links.length} links (filtered from ${allLinks.length})`);

    this.graph.graphData({ 
      nodes, 
      links: links.map(link => ({
        ...link,
        source: link.sourceId || link.source,
        target: link.targetId || link.target,
        sourceId: link.sourceId || link.source,
        targetId: link.targetId || link.target
      }))
    });
    this.repaintGraph();

    // Refresh hover detail listeners with current state
    if (this.onHoverDetails) {
      this.emitHoverDetails(this.hoveredNode);
    }

    this.performance.runStart = this.getNow();
  }

  getNodeById(nodeId) {
    if (!nodeId || !this.data || !Array.isArray(this.data.nodes)) {
      return null;
    }
    return this.data.nodes.find(node => node.id === nodeId) || null;
  }

  getEdgeSummary(nodeId) {
    const summary = {
      outbound: [],
      inbound: [],
      similarity: []
    };

    if (!nodeId || !this.data) {
      return summary;
    }

    const links = (this.filteredLinks && this.filteredLinks.length)
      ? this.filteredLinks
      : this.data.links || [];

    links.forEach(link => {
      const sourceId = this.getLinkNodeId(link, 'source');
      const targetId = this.getLinkNodeId(link, 'target');
      if (sourceId === nodeId) {
        const targetNode = this.getNodeById(targetId);
        const edgeEntry = {
          nodeId: targetId,
          node: targetNode,
          weight: link.weight || 1,
          type: link.type || 'call',
          dynamic: link.dynamic || false,
          resolutionStatus: link.resolutionStatus || (link.resolution && link.resolution.status) || null,
          resolutionReason: link.resolutionReason || (link.resolution && link.resolution.reason) || '',
          resolution: link.resolution || null,
          importInfo: link.importInfo || null
        };
        if (link.type === 'similarity') {
          summary.similarity.push({
            ...edgeEntry,
            weight: this.getSimilarityWeight(link),
            method: link.method || link.metadata?.method || 'similarity',
            topPairs: link.topPairs || link.metadata?.topPairs || []
          });
        } else {
          summary.outbound.push(edgeEntry);
        }
      } else if (targetId === nodeId) {
        const sourceNode = this.getNodeById(sourceId);
        const edgeEntry = {
          nodeId: sourceId,
          node: sourceNode,
          weight: link.weight || 1,
          type: link.type || 'call',
          dynamic: link.dynamic || false,
          resolutionStatus: link.resolutionStatus || (link.resolution && link.resolution.status) || null,
          resolutionReason: link.resolutionReason || (link.resolution && link.resolution.reason) || '',
          resolution: link.resolution || null,
          importInfo: link.importInfo || null
        };
        if (link.type === 'similarity') {
          summary.similarity.push({
            ...edgeEntry,
            weight: this.getSimilarityWeight(link),
            method: link.method || link.metadata?.method || 'similarity',
            topPairs: link.topPairs || link.metadata?.topPairs || []
          });
        } else {
          summary.inbound.push(edgeEntry);
        }
      }
    });

    summary.similarity.sort((a, b) => (b.weight || 0) - (a.weight || 0));

    return summary;
  }

  /**
   * Toggle similarity edges visibility
   */
  toggleSimilarityEdges(show) {
    this.options.showSimilarityEdges = show;
    if (!this.data) return;

    this.filteredLinks = this.filterLinks(this.data.links || []);
    this.buildAdjacencyMap(this.data.nodes || [], this.filteredLinks);
    this.applyGraphData();
  }

  /**
   * Toggle call edges visibility
   */
  toggleCallEdges(show) {
    this.options.showCallEdges = show;
    if (!this.data) return;

    this.filteredLinks = this.filterLinks(this.data.links || []);
    this.buildAdjacencyMap(this.data.nodes || [], this.filteredLinks);
    this.applyGraphData();
  }

  setHighlightNeighbors(enabled) {
    this.highlightNeighbors = enabled;
    if (!enabled) {
      this.updateHoverState(null);
    } else {
      this.updateHoverState(this.hoveredNode || null);
    }
  }

  /**
   * Refresh graph with current options
   */
  repaintGraph() {
    if (this.graph && typeof this.graph.refresh === 'function') {
      this.graph.refresh();
    }
  }

  /**
   * Pause/resume force simulation
   */
  pauseSimulation(pause = true) {
    if (this.graph) {
      if (pause) {
        this.graph.pauseAnimation();
        this.performance.runStart = null;
      } else {
        this.graph.resumeAnimation();
        this.performance.runStart = this.getNow();
      }
    }
  }

  /**
   * Freeze node positions
   */
  freezePositions(freeze = true) {
    if (this.data && this.data.nodes) {
      this.data.nodes.forEach(node => {
        if (freeze) {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        } else {
          node.fx = undefined;
          node.fy = undefined;
          node.fz = undefined;
        }
      });
      
      if (this.graph) {
        this.graph.graphData({
          nodes: this.data.nodes,
          links: this.data.links
        });
      }
    }
  }

  captureLayoutSnapshot() {
    if (!this.data || !Array.isArray(this.data.nodes)) {
      return [];
    }
    return this.data.nodes.map(node => ({
      id: node.id,
      x: typeof node.x === 'number' ? node.x : null,
      y: typeof node.y === 'number' ? node.y : null,
      z: typeof node.z === 'number' ? node.z : null,
      fx: typeof node.fx === 'number' ? node.fx : null,
      fy: typeof node.fy === 'number' ? node.fy : null,
      fz: typeof node.fz === 'number' ? node.fz : null
    }));
  }

  applyLayoutSnapshot(snapshot, { freeze = true, refresh = true } = {}) {
    if (!Array.isArray(snapshot) || !this.data || !Array.isArray(this.data.nodes)) {
      return 0;
    }

    const layoutMap = new Map(snapshot.map(entry => [entry.id, entry]));
    let applied = 0;

    this.data.nodes.forEach(node => {
      const entry = layoutMap.get(node.id);
      if (!entry) {
        return;
      }

      if (typeof entry.x === 'number') node.x = entry.x;
      if (typeof entry.y === 'number') node.y = entry.y;
      if (typeof entry.z === 'number') node.z = entry.z;

      if (freeze) {
        node.fx = typeof entry.fx === 'number' ? entry.fx : entry.x;
        node.fy = typeof entry.fy === 'number' ? entry.fy : entry.y;
        node.fz = typeof entry.fz === 'number' ? entry.fz : entry.z;
      } else {
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      }

      applied += 1;
    });

    if (applied > 0 && refresh) {
      this.applyGraphData();
    }

    return applied;
  }

  async saveLayoutToStorage({ key = this.layoutStorageKey } = {}) {
    if (!key) {
      return false;
    }

    const snapshotNodes = this.captureLayoutSnapshot();
    const metadata = {
      savedAt: new Date().toISOString(),
      nodeCount: snapshotNodes.length
    };

    if (this.layoutStorageProvider?.save) {
      try {
        await this.layoutStorageProvider.save({
          key,
          graphHash: this.layoutGraphHash,
          snapshot: snapshotNodes,
          metadata
        });
        this.lastLayoutLoadResult = { status: 'saved', metadata };
        return true;
      } catch (err) {
        console.warn('GraphVisualization.saveLayoutToStorage provider failed:', err);
      }
    }

    if (typeof localStorage === 'undefined') {
      return false;
    }

    try {
      const payload = {
        version: 1,
        nodes: snapshotNodes,
        savedAt: metadata.savedAt,
        metadata,
        graphHash: this.layoutGraphHash
      };
      localStorage.setItem(key, JSON.stringify(payload));
      this.lastLayoutLoadResult = { status: 'saved-local', metadata };
      return true;
    } catch (err) {
      console.warn('GraphVisualization.saveLayoutToStorage failed:', err);
      return false;
    }
  }

  async loadLayoutFromStorage({ key = this.layoutStorageKey } = {}) {
    this.lastLayoutLoadResult = { status: 'idle' };

    if (!key) {
      return null;
    }

    if (this.layoutStorageProvider?.load) {
      try {
        const result = await this.layoutStorageProvider.load({ key });
        if (!result) {
          this.lastLayoutLoadResult = { status: 'missing' };
          return null;
        }
        if (
          result.graphHash &&
          this.layoutGraphHash &&
          result.graphHash !== this.layoutGraphHash
        ) {
          this.lastLayoutLoadResult = {
            status: 'mismatch',
            graphHash: result.graphHash,
            expected: this.layoutGraphHash
          };
          return null;
        }
        const snapshot = {
          version: result.layoutVersion ?? 1,
          nodes: Array.isArray(result.layout) ? result.layout : [],
          savedAt: result.updatedAt || result.createdAt || null,
          metadata: result.metadata ?? null,
          graphHash: result.graphHash ?? null
        };
        this.lastLayoutLoadResult = {
          status: 'ok',
          metadata: snapshot.metadata,
          savedAt: snapshot.savedAt
        };
        return snapshot;
      } catch (err) {
        console.warn('GraphVisualization.loadLayoutFromStorage provider failed:', err);
        this.lastLayoutLoadResult = { status: 'error', error: err };
      }
    }

    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        this.lastLayoutLoadResult = { status: 'missing' };
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes)) {
        this.lastLayoutLoadResult = { status: 'invalid' };
        return null;
      }
      if (
        this.layoutGraphHash &&
        parsed.graphHash &&
        parsed.graphHash !== this.layoutGraphHash
      ) {
        this.lastLayoutLoadResult = {
          status: 'mismatch',
          graphHash: parsed.graphHash,
          expected: this.layoutGraphHash
        };
        return null;
      }
      const snapshot = {
        version: parsed.version ?? 1,
        nodes: parsed.nodes,
        savedAt: parsed.savedAt ?? parsed.metadata?.savedAt ?? null,
        metadata: parsed.metadata ?? null,
        graphHash: parsed.graphHash ?? null
      };
      this.lastLayoutLoadResult = {
        status: 'ok-local',
        metadata: snapshot.metadata,
        savedAt: snapshot.savedAt
      };
      return snapshot;
    } catch (err) {
      console.warn('GraphVisualization.loadLayoutFromStorage failed:', err);
      this.lastLayoutLoadResult = { status: 'error', error: err };
      return null;
    }
  }

  async restoreLayoutFromStorage({ key = this.layoutStorageKey, freeze = true } = {}) {
    const snapshot = await this.loadLayoutFromStorage({ key });
    if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
      return false;
    }

    const applied = this.applyLayoutSnapshot(snapshot.nodes, { freeze, refresh: true });
    if (applied > 0) {
      this.lastRestoredLayoutHash = this.hashLayout(snapshot.nodes);
      this.pauseSimulation(true);
      this.lastLayoutLoadResult = {
        ...this.lastLayoutLoadResult,
        status: 'restored'
      };
      return true;
    }
    return false;
  }

  async hasStoredLayout({ key = this.layoutStorageKey } = {}) {
    if (!key) {
      return false;
    }

    if (this.layoutStorageProvider?.has) {
      try {
        return await this.layoutStorageProvider.has({ key });
      } catch (err) {
        console.warn('GraphVisualization.hasStoredLayout provider failed:', err);
      }
    }

    if (this.layoutStorageProvider?.load) {
      try {
        const result = await this.layoutStorageProvider.load({ key });
        return !!(result && Array.isArray(result.layout) && result.layout.length > 0);
      } catch (err) {
        console.warn('GraphVisualization.hasStoredLayout provider load failed:', err);
      }
    }

    if (typeof localStorage === 'undefined') {
      return false;
    }

    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  async clearStoredLayout({ key = this.layoutStorageKey } = {}) {
    if (!key) {
      return false;
    }

    let cleared = false;

    if (this.layoutStorageProvider?.delete) {
      try {
        await this.layoutStorageProvider.delete({ key });
        cleared = true;
      } catch (err) {
        console.warn('GraphVisualization.clearStoredLayout provider failed:', err);
      }
    }

    if (!cleared && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
        cleared = true;
      } catch (err) {
        console.warn('GraphVisualization.clearStoredLayout failed:', err);
      }
    }

    if (cleared && this.lastRestoredLayoutHash && key === this.layoutStorageKey) {
      this.lastRestoredLayoutHash = null;
    }

    return cleared;
  }

  async resetLayoutToDefault({ clearStored = false } = {}) {
    if (clearStored) {
      await this.clearStoredLayout({});
    }
    this.freezePositions(false);
    this.pauseSimulation(false);
    this.lastRestoredLayoutHash = null;
  }

  hashLayout(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return '0';
    }

    let hash = 0;
    const prime = 31;
    nodes.forEach(node => {
      const x = typeof node.x === 'number' ? node.x : 0;
      const y = typeof node.y === 'number' ? node.y : 0;
      const z = typeof node.z === 'number' ? node.z : 0;
      const idHash = this.simpleStringHash(node.id || '');
      hash = (hash * prime + Math.floor(x * 1000)) | 0;
      hash = (hash * prime + Math.floor(y * 1000)) | 0;
      hash = (hash * prime + Math.floor(z * 1000)) | 0;
      hash = (hash * prime + idHash) | 0;
    });
    return hash.toString(16);
  }

  simpleStringHash(value) {
    if (!value) return 0;
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /**
   * Export graph as PNG
   */
  async exportPNG() {
    if (!this.graph) {
      throw new Error('Graph renderer is not ready to export.');
    }

    // Try to use 3d-force-graph's screenshot method if available
    if (typeof this.graph.screenshot === 'function') {
      try {
        const dataUrl = await this.graph.screenshot();
        if (dataUrl && dataUrl !== 'data:,') {
          return dataUrl;
        }
      } catch (err) {
        console.warn('[GraphViz] Screenshot method failed:', err?.message || err);
      }
    }

    // Try to get renderer from graph instance or use custom renderer
    let renderer = null;
    let canvas = null;

    if (this.customRenderer && this.customRenderer.domElement) {
      renderer = this.customRenderer;
      canvas = this.customRenderer.domElement;
    } else if (this.graph && typeof this.graph.renderer === 'function') {
      try {
        renderer = this.graph.renderer();
        if (renderer && renderer.domElement) {
          canvas = renderer.domElement;
        }
      } catch (err) {
        // graphInstance.renderer() might not be a getter
      }
    }

    // Fallback: find canvas element in container (3d-force-graph creates one)
    if (!canvas && this.container) {
      canvas = this.container.querySelector('canvas');
    }

    if (!canvas || typeof canvas.toDataURL !== 'function') {
      const hasCustomRenderer = !!this.customRenderer;
      const hasCanvas = !!canvas;
      throw new Error(
        `Graph renderer is not ready to export. ` +
        `Screenshot functionality requires a WebGL canvas. ` +
        `(customRenderer: ${hasCustomRenderer}, canvas: ${hasCanvas})`
      );
    }

    try {
      // Force a render before capturing
      // If we have access to the renderer, try to render the scene explicitly
      if (renderer && typeof renderer.render === 'function') {
        // Try to get scene and camera from the graph instance
        if (typeof this.graph.scene === 'function' && typeof this.graph.camera === 'function') {
          try {
            const scene = this.graph.scene();
            const camera = this.graph.camera();
            if (scene && camera) {
              renderer.render(scene, camera);
            }
          } catch (err) {
            // Scene/camera access might not be available
          }
        }
      }

      // Also try the graph's render method if available
      if (typeof this.graph.render === 'function') {
        this.graph.render();
      }

      // Wait for multiple frames to ensure rendering completes
      // This is important because WebGL rendering is asynchronous
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      // Get the WebGL context and check if preserveDrawingBuffer is enabled
      // Note: There's no direct way to check preserveDrawingBuffer, but we can try to read pixels
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
                 canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ||
                 canvas.getContext('webgl') || 
                 canvas.getContext('webgl2');
      
      if (gl) {
        // Try to read pixels to see if the buffer has content
        const pixelBuffer = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
        const hasContent = pixelBuffer[0] > 0 || pixelBuffer[1] > 0 || pixelBuffer[2] > 0 || pixelBuffer[3] > 0;
        if (!hasContent) {
          console.warn('[GraphViz] Canvas appears empty at center pixel. preserveDrawingBuffer may not be enabled or scene not rendered.');
        }
      }

      const dataUrl = canvas.toDataURL('image/png');
      
      // Check if the data URL is valid (not empty/black)
      if (dataUrl && dataUrl !== 'data:,' && dataUrl.length > 100) {
        // Basic check: decode first few bytes to see if it's not just black
        // A valid PNG should start with PNG signature bytes
        try {
          const base64 = dataUrl.split(',')[1];
          const bytes = atob(base64);
          // PNG signature is: 89 50 4E 47 0D 0A 1A 0A
          if (bytes.length > 8 && bytes.charCodeAt(0) === 0x89 && bytes.charCodeAt(1) === 0x50) {
            return dataUrl;
          } else {
            console.warn('[GraphViz] Canvas export returned invalid PNG data');
          }
        } catch (err) {
          console.warn('[GraphViz] Failed to validate PNG data:', err?.message || err);
        }
      }

      // If we got here but have a renderer, try one more explicit render
      if (renderer && typeof renderer.render === 'function') {
        if (typeof this.graph.scene === 'function' && typeof this.graph.camera === 'function') {
          try {
            const scene = this.graph.scene();
            const camera = this.graph.camera();
            if (scene && camera) {
              renderer.render(scene, camera);
              await new Promise(resolve => requestAnimationFrame(resolve));
              const retryDataUrl = canvas.toDataURL('image/png');
              if (retryDataUrl && retryDataUrl !== 'data:,' && retryDataUrl.length > 100) {
                return retryDataUrl;
              }
            }
          } catch (err) {
            // Ignore errors
          }
        }
      }

      throw new Error('Canvas export returned empty or invalid image data. The canvas may not have preserveDrawingBuffer enabled.');
    } catch (err) {
      console.error('[GraphViz] Canvas export failed:', err?.message || err);
      throw err;
    }
  }

  /**
   * Export graph data as JSON
   */
  exportJSON() {
    const nodes = Array.isArray(this.data?.nodes) ? this.data.nodes : [];
    const links = Array.isArray(this.data?.links) ? this.data.links : [];

    const payload = {
      nodes: nodes.map(node => ({
        id: node.id,
        fqName: node.fqName,
        name: node.name,
        filePath: node.filePath,
        x: node.x,
        y: node.y,
        z: node.z
      })),
      links: links.map(link => ({
        source: link.source,
        target: link.target,
        type: link.type,
        weight: link.weight
      }))
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Cleanup and dispose resources
   */
  dispose() {
    this.cancelPendingAutoSave();
    if (this.graph) {
      // 3d-force-graph doesn't have explicit dispose, but we can clear data
      this.graph.graphData({ nodes: [], links: [] });
      this.graph = null;

    if (typeof window !== 'undefined' && this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    this.customRenderer = null;
    }

    if (this.fadeAnimationFrame) {
      cancelAnimationFrame(this.fadeAnimationFrame);
      this.fadeAnimationFrame = null;
    }

    this.data = { nodes: [], links: [] };
    this.selectedNode = null;
    this.hoveredNode = null;
  }

  focusNodeById(nodeId, { hover = true } = {}) {
    const node = this.getNodeById(nodeId);
    if (!node) {
      return;
    }

    this.handleNodeClick(node);
    if (hover) {
      this.updateHoverState(node);
    }
  }

  buildAdjacencyMap(nodes, links) {
    this.adjacency = new Map();
    nodes.forEach(node => {
      this.adjacency.set(node.id, new Set());
    });

    links.forEach(link => {
      const sourceId = link.sourceId || this.getLinkNodeId(link, 'source');
      const targetId = link.targetId || this.getLinkNodeId(link, 'target');
      if (!sourceId || !targetId) return;
      if (!this.adjacency.has(sourceId)) {
        this.adjacency.set(sourceId, new Set());
      }
      if (!this.adjacency.has(targetId)) {
        this.adjacency.set(targetId, new Set());
      }
      this.adjacency.get(sourceId).add(targetId);
      this.adjacency.get(targetId).add(sourceId);
    });
  }

  setFadeTarget(value, immediate = false) {
    const clamped = Math.max(this.minFadeOpacity, Math.min(this.baseLinkOpacity, value));
    this.fadeTargetOpacity = clamped;

    if (immediate) {
      this.currentNonNeighborOpacity = clamped;
      if (this.fadeAnimationFrame) {
        cancelAnimationFrame(this.fadeAnimationFrame);
        this.fadeAnimationFrame = null;
      }
      this.repaintGraph();
      return;
    }

    if (!this.fadeAnimationFrame) {
      this.fadeAnimationFrame = requestAnimationFrame(() => this.animateFadeStep());
    }
  }

  animateFadeStep() {
    const diff = this.fadeTargetOpacity - this.currentNonNeighborOpacity;
    if (Math.abs(diff) < 0.01) {
      this.currentNonNeighborOpacity = this.fadeTargetOpacity;
      if (this.fadeAnimationFrame) {
        cancelAnimationFrame(this.fadeAnimationFrame);
        this.fadeAnimationFrame = null;
      }
      this.repaintGraph();
      return;
    }

    this.currentNonNeighborOpacity += diff * 0.2;
    // Only repaint every other frame during animation to reduce work per frame
    // The graph will still animate smoothly, but with less per-frame overhead
    const shouldRepaint = Math.abs(diff) > 0.05; // Only skip repaint when very close to target
    if (shouldRepaint) {
      this.repaintGraph();
    }
    this.fadeAnimationFrame = requestAnimationFrame(() => this.animateFadeStep());
  }
}

