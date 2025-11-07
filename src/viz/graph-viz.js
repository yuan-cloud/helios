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

import ForceGraph3D from '3d-force-graph';

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
  }

  /**
   * Initialize the 3D graph visualization
   */
  async initialize() {
    if (!this.container) {
      throw new Error('Container element required');
    }

    // Create 3D force graph
    this.graph = ForceGraph3D()
      .nodeId('id')
      .nodeLabel(node => this.getNodeLabel(node))
      .nodeColor(node => this.getNodeColor(node))
      .nodeVal(node => this.getNodeSize(node))
      .linkSource(link => link.source)
      .linkTarget(link => link.target)
      .linkLabel(link => this.getLinkLabel(link))
      .linkColor(link => this.getLinkColor(link))
      .linkWidth(link => this.getLinkWidth(link))
      .linkDirectionalParticles(link => this.getLinkParticles(link))
      .linkDirectionalParticleSpeed(0.01)
      .linkDirectionalParticleWidth(3)
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

    this.data = {
      nodes: data.nodes.map(node => this.normalizeNode(node)),
      links: data.links.map(link => this.normalizeLink(link))
    };

    // Filter links based on options
    const visibleLinks = this.data.links.filter(link => {
      if (link.type === 'call' && !this.options.showCallEdges) return false;
      if (link.type === 'similarity' && !this.options.showSimilarityEdges) return false;
      return true;
    });

    // Update graph
    if (this.graph) {
      this.graph
        .graphData({
          nodes: this.data.nodes,
          links: visibleLinks
        });
    }

    return this;
  }

  /**
   * Normalize node data to expected format
   */
  normalizeNode(node) {
    return {
      id: node.id || node.fqName || node.name,
      fqName: node.fqName || node.name,
      name: node.name,
      filePath: node.filePath || '',
      lang: node.lang || 'javascript',
      size: node.size || node.loc || 0,
      metrics: node.metrics || {},
      community: node.community || 0,
      centrality: node.centrality || 0,
      doc: node.doc || '',
      // Position (will be set by force simulation)
      x: node.x,
      y: node.y,
      z: node.z,
      // Visual properties
      color: node.color,
      ...node
    };
  }

  /**
   * Normalize link data to expected format
   */
  normalizeLink(link) {
    return {
      source: typeof link.source === 'string' ? link.source : link.source.id,
      target: typeof link.target === 'string' ? link.target : link.target.id,
      type: link.type || 'call', // 'call' or 'similarity'
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
    if (node.color) return node.color;
    
    // Color by community if available
    if (node.community !== undefined) {
      return this.getCommunityColor(node.community);
    }
    
    // Default color by language
    const langColors = {
      javascript: '#fbbf24',
      typescript: '#3178c6',
      python: '#3776ab',
      default: '#8b5cf6'
    };
    
    return langColors[node.lang] || langColors.default;
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
    if (node.size !== undefined) {
      // Normalize size (assume max 1000 LOC)
      return Math.max(2, Math.min(20, node.size / 50));
    }
    
    if (node.centrality !== undefined) {
      // Scale by centrality
      return Math.max(2, Math.min(20, node.centrality * 100));
    }
    
    return this.options.nodeSize;
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

  /**
   * Handle node hover
   */
  handleNodeHover(node) {
    this.hoveredNode = node;
    
    if (this.onNodeHover) {
      this.onNodeHover(node);
    }
    
    // Highlight connected nodes
    if (node && this.graph) {
      this.graph.linkOpacity(link => {
        return (link.source === node.id || link.target === node.id) ? 1 : 0.2;
      });
    } else {
      this.graph.linkOpacity(1);
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
    
    // Reset link opacity
    if (this.graph) {
      this.graph.linkOpacity(1);
    }
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

  /**
   * Toggle similarity edges visibility
   */
  toggleSimilarityEdges(show) {
    this.options.showSimilarityEdges = show;
    this.refresh();
  }

  /**
   * Toggle call edges visibility
   */
  toggleCallEdges(show) {
    this.options.showCallEdges = show;
    this.refresh();
  }

  /**
   * Refresh graph with current options
   */
  refresh() {
    if (this.graph && this.data) {
      this.loadData(this.data);
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
    
    this.data = { nodes: [], links: [] };
    this.selectedNode = null;
    this.hoveredNode = null;
  }
}

