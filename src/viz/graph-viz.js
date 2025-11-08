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

    this.baseLinkOpacity = 0.6;
    this.minFadeOpacity = 0.12;
    this.currentNonNeighborOpacity = this.baseLinkOpacity;
    this.fadeTargetOpacity = this.baseLinkOpacity;
    this.fadeAnimationFrame = null;
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
      .linkDirectionalParticleSpeed(0.01)
      .linkDirectionalParticleWidth(3)
      .linkDirectionalArrowLength(6)
      .linkDirectionalArrowRelPos(1)
      .linkOpacity(link => this.getLinkDisplayOpacity(link))
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

    this.buildAdjacencyMap(normalizedNodes, normalizedLinks);
    this.hoveredNeighbors = new Set();
    this.hoveredNodeId = null;
    this.setFadeTarget(this.baseLinkOpacity, true);

    const visibleLinks = normalizedLinks.filter(link => {
      if (link.type === 'call' && !this.options.showCallEdges) return false;
      if (link.type === 'similarity' && !this.options.showSimilarityEdges) return false;
      return true;
    });

    this.filteredLinks = visibleLinks;

    this.applyGraphData();

    return this;
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
      size: node.size || node.loc || 0,
      metrics: node.metrics || {},
      community: node.community,
      centrality: node.centrality || 0,
      doc: node.doc || '',
      x: node.x,
      y: node.y,
      z: node.z
    };

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

    return {
      source: sourceId,
      target: targetId,
      sourceId,
      targetId,
      type: link.type || 'call',
      weight: link.weight || link.sim || 1,
      dynamic: link.dynamic || false,
      ...link
    };
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

    if (node && node.community !== undefined && node.community !== null) {
      return this.getCommunityColor(node.community);
    }

    const langColors = {
      javascript: '#fbbf24',
      typescript: '#3178c6',
      python: '#3776ab',
      default: '#8b5cf6'
    };

    return langColors[node?.lang] || langColors.default;
  }

  /**
   * Get community color (hash-based for consistency)
   */
  getCommunityColor(communityId) {
    // Simple hash function for consistent colors
    const hue = (communityId * 137.508) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  /**
   * Get node size (by centrality or default)
   */
  getNodeSize(node) {
    let baseSize;
    if (node.size !== undefined && node.size !== null) {
      baseSize = Math.max(2, Math.min(20, node.size / 50));
    } else if (node.centrality !== undefined) {
      baseSize = Math.max(2, Math.min(20, node.centrality * 100));
    } else {
      baseSize = this.options.nodeSize;
    }

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
      return `Call (${link.weight || 1} call${link.weight !== 1 ? 's' : ''})`;
    } else if (link.type === 'similarity') {
      return `Similarity: ${(link.weight || 0).toFixed(2)}`;
    }
    return '';
  }

  /**
   * Get link color
   */
  getLinkColor(link) {
    if (link.type === 'call') {
      // Call edges: solid, color by type
      if (link.dynamic) {
        return 'rgba(239, 68, 68, 0.6)'; // Red for dynamic
      }
      return 'rgba(99, 102, 241, 0.8)'; // Blue for static
    } else if (link.type === 'similarity') {
      // Similarity edges: dashed, desaturated
      return 'rgba(139, 92, 246, 0.4)';
    }
    return 'rgba(255, 255, 255, 0.3)';
  }

  /**
   * Get link width
   */
  getLinkWidth(link) {
    const baseWidth = link.type === 'similarity' ? 1 : 2;
    const weight = link.weight || 1;
    return baseWidth * Math.min(3, Math.max(0.5, weight));
  }

  getLinkDisplayOpacity(link) {
    if (!this.highlightNeighbors || !this.hoveredNodeId) {
      return this.baseLinkOpacity;
    }

    const sourceId = this.getLinkNodeId(link, 'source');
    const targetId = this.getLinkNodeId(link, 'target');
    if (!sourceId || !targetId) {
      return this.baseLinkOpacity;
    }

    const isNeighbor = sourceId === this.hoveredNodeId || targetId === this.hoveredNodeId;
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
      return Math.min(5, Math.max(1, Math.floor(link.weight || 1)));
    }
    return 0;
  }

  updateHoverState(node) {
    if (!this.highlightNeighbors) {
      this.hoveredNodeId = node ? node.id : null;
      this.hoveredNeighbors = new Set();
      this.setFadeTarget(this.baseLinkOpacity, true);
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

    this.repaintGraph();
  }

  /**
   * Handle node hover
   */
  handleNodeHover(node) {
    this.hoveredNode = node;
    this.updateHoverState(node);

    if (this.onNodeHover) {
      this.onNodeHover(node);
    }
  }

  /**
   * Handle node click
   */
  handleNodeClick(node) {
    this.selectedNode = node;
    
    if (this.onNodeClick) {
      this.onNodeClick(node);
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
  }

  /**
   * Toggle similarity edges visibility
   */
  toggleSimilarityEdges(show) {
    this.options.showSimilarityEdges = show;
    if (!this.data) return;

    this.filteredLinks = (this.data.links || []).filter(link => {
      if (link.type === 'call' && !this.options.showCallEdges) return false;
      if (link.type === 'similarity' && !this.options.showSimilarityEdges) return false;
      return true;
    });

    this.applyGraphData();
  }

  /**
   * Toggle call edges visibility
   */
  toggleCallEdges(show) {
    this.options.showCallEdges = show;
    if (!this.data) return;

    this.filteredLinks = (this.data.links || []).filter(link => {
      if (link.type === 'call' && !this.options.showCallEdges) return false;
      if (link.type === 'similarity' && !this.options.showSimilarityEdges) return false;
      return true;
    });

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

