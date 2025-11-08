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

    // Layout persistence metadata
    this.layoutStorageKey = 'helios:layout:last';
    this.lastRestoredLayoutHash = null;

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

    // Dynamically import 3d-force-graph
    const ForceGraph3DModule = await import('3d-force-graph');
    const ForceGraph3D = ForceGraph3DModule.default || ForceGraph3DModule;

    // Create 3D force graph
    this.graph = ForceGraph3D()
      .nodeId('id')
      .nodeLabel(node => this.getNodeLabel(node))
      .nodeColor(node => this.getNodeColor(node))
      .nodeVal(node => this.getNodeSize(node))
      .linkSource(link => this.getLinkNodeId(link, 'source'))
      .linkTarget(link => this.getLinkNodeId(link, 'target'))
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
      .linkLineDash(link => this.getLinkDashArray(link))
      .nodeRelSize(6)
      .onNodeHover(node => this.handleNodeHover(node))
      .onNodeClick(node => this.handleNodeClick(node))
      .onNodeDrag(node => this.handleNodeDrag(node))
      .onBackgroundClick(() => this.handleBackgroundClick())
      .enableNodeDrag(true)
      .enableNavigationControls(true)
      .showNavInfo(false)
      .cameraPosition({ x: 0, y: 0, z: 1000 });

    // Mount to container
    this.graph(this.container);

    // Set initial camera
    this.resetCamera();

    return this;
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

    this.filteredLinks = this.filterLinks(normalizedLinks);
    this.buildAdjacencyMap(normalizedNodes, this.filteredLinks);

    this.applyGraphData();

    return this;
  }

  setLayoutStorageKey(key) {
    if (typeof key === 'string' && key.trim().length > 0) {
      this.layoutStorageKey = key.trim();
    }
  }

  /**
   * Normalize node data to expected format
   */
  normalizeNode(node) {
    const normalized = {
      ...node,
      id: node.id || node.fqName || node.name,
      fqName: node.fqName || node.name,
      name: node.name,
      filePath: node.filePath || '',
      lang: node.lang || 'javascript',
      moduleId: node.moduleId || null,
      isVirtual: !!node.isVirtual,
      size: node.size || node.loc || 0,
      metrics: node.metrics || {},
      community: node.community,
      centrality: typeof node.centrality === 'number' ? node.centrality : 0,
      doc: node.doc || '',
      x: node.x,
      y: node.y,
      z: node.z
    };

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
    if (node.metrics && Object.keys(node.metrics).length > 0) {
      const metricsStr = Object.entries(node.metrics)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      parts.push(`\n${metricsStr}`);
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

  computeCentralityScore(node) {
    if (!node) return null;

    const direct = typeof node.centrality === 'number' ? node.centrality : null;
    if (direct !== null && Number.isFinite(direct)) {
      return this.clamp(direct, 0, 1);
    }

    const metrics = node.metrics || {};
    const candidates = ['pagerank', 'centrality', 'betweenness', 'degree'];

    const values = candidates
      .map(key => metrics[key])
      .filter(value => typeof value === 'number' && Number.isFinite(value));

    if (!values.length) {
      return null;
    }

    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);

    const normalized = this.scaleValue(
      maxValue,
      [minValue || 0, minValue === maxValue ? maxValue + 1 : maxValue],
      [0, 1]
    );

    return this.clamp(normalized, 0, 1);
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

  /**
   * Get node size (by centrality or default)
   */
  getNodeSize(node) {
    const centralitySize = node.centralityScore !== null
      ? this.scaleValue(node.centralityScore, [0, 1], [4, 16])
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
    const links = this.filteredLinks || this.data.links || [];

    this.graph.graphData({ nodes, links });
    this.repaintGraph();

    // Refresh hover detail listeners with current state
    if (this.onHoverDetails) {
      this.emitHoverDetails(this.hoveredNode);
    }
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
      } else {
        this.graph.resumeAnimation();
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

  saveLayoutToStorage({ key = this.layoutStorageKey } = {}) {
    if (!key || typeof localStorage === 'undefined') {
      return false;
    }

    try {
      const snapshot = {
        version: 1,
        nodes: this.captureLayoutSnapshot(),
        savedAt: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(snapshot));
      return true;
    } catch (err) {
      console.warn('GraphVisualization.saveLayoutToStorage failed:', err);
      return false;
    }
  }

  loadLayoutFromStorage({ key = this.layoutStorageKey } = {}) {
    if (!key || typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes)) {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('GraphVisualization.loadLayoutFromStorage failed:', err);
      return null;
    }
  }

  restoreLayoutFromStorage({ key = this.layoutStorageKey, freeze = true } = {}) {
    const snapshot = this.loadLayoutFromStorage({ key });
    if (!snapshot || !Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
      return false;
    }

    const applied = this.applyLayoutSnapshot(snapshot.nodes, { freeze, refresh: true });
    if (applied > 0) {
      this.lastRestoredLayoutHash = this.hashLayout(snapshot.nodes);
      this.pauseSimulation(true);
      return true;
    }
    return false;
  }

  hasStoredLayout({ key = this.layoutStorageKey } = {}) {
    if (!key || typeof localStorage === 'undefined') {
      return false;
    }
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  clearStoredLayout({ key = this.layoutStorageKey } = {}) {
    if (!key || typeof localStorage === 'undefined') {
      return false;
    }
    try {
      localStorage.removeItem(key);
      if (this.lastRestoredLayoutHash && key === this.layoutStorageKey) {
        this.lastRestoredLayoutHash = null;
      }
      return true;
    } catch (err) {
      console.warn('GraphVisualization.clearStoredLayout failed:', err);
      return false;
    }
  }

  resetLayoutToDefault({ clearStored = false } = {}) {
    if (clearStored) {
      this.clearStoredLayout({});
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
    if (!this.graph) return null;
    
    // Use 3d-force-graph's screenshot capability
    return this.graph.screenshot();
  }

  /**
   * Export graph data as JSON
   */
  exportJSON() {
    return JSON.stringify({
      nodes: this.data.nodes.map(node => ({
        id: node.id,
        fqName: node.fqName,
        name: node.name,
        filePath: node.filePath,
        x: node.x,
        y: node.y,
        z: node.z
      })),
      links: this.data.links.map(link => ({
        source: link.source,
        target: link.target,
        type: link.type,
        weight: link.weight
      }))
    }, null, 2);
  }

  /**
   * Cleanup and dispose resources
   */
  dispose() {
    if (this.graph) {
      // 3d-force-graph doesn't have explicit dispose, but we can clear data
      this.graph.graphData({ nodes: [], links: [] });
      this.graph = null;
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
    this.repaintGraph();
    this.fadeAnimationFrame = requestAnimationFrame(() => this.animateFadeStep());
  }
}

