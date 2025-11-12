/**
 * Inspector Panel for Code Display
 * 
 * Shows function source code with syntax highlighting (Prism.js)
 * Displays on node click in the 3D graph
 */

/**
 * InspectorPanel - Code inspector with syntax highlighting
 */
export class InspectorPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      showLineNumbers: true,
      theme: 'default',
      ...options
    };
    
    this.currentNode = null;
    this.sourceCode = null;
    this.onNavigate = null;
    
    this.init();
  }

  /**
   * Initialize inspector UI
   */
  init() {
    if (!this.container) {
      throw new Error('Container element required');
    }

    this.container.innerHTML = `
      <div class="inspector-panel hidden">
        <div class="inspector-header">
          <h3 class="inspector-title">Function Inspector</h3>
          <button class="inspector-close" aria-label="Close inspector">×</button>
        </div>
        <div class="inspector-content">
          <div class="inspector-info" id="inspectorInfo"></div>
          <div class="inspector-edges" id="inspectorEdges">
            <div class="inspector-edges-section">
              <div class="inspector-edges-title">Outgoing Calls</div>
              <div class="inspector-edge-list" id="inspectorEdgeOut"></div>
            </div>
            <div class="inspector-edges-section">
              <div class="inspector-edges-title">Incoming Calls</div>
              <div class="inspector-edge-list" id="inspectorEdgeIn"></div>
            </div>
            <div class="inspector-edges-section">
              <div class="inspector-edges-title">Similar Functions</div>
              <div class="inspector-edge-list" id="inspectorEdgeSimilarity"></div>
            </div>
          </div>
          <div class="inspector-code-container">
            <pre class="inspector-code" id="inspectorCode"><code></code></pre>
          </div>
        </div>
      </div>
    `;
    
    // Store panel element for visibility toggling
    this.panelEl = this.container.querySelector('.inspector-panel');
    this.edgesContainer = this.container.querySelector('#inspectorEdges');
    this.edgeOutList = this.container.querySelector('#inspectorEdgeOut');
    this.edgeInList = this.container.querySelector('#inspectorEdgeIn');
    this.edgeSimilarityList = this.container.querySelector('#inspectorEdgeSimilarity');

    // Close button handler
    const closeBtn = this.container.querySelector('.inspector-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Initially hidden
    this.hide();
  }

  /**
   * Show inspector with node data
   * @param {Object} node - Graph node data
   * @param {string} sourceCode - Function source code
   */
  show(node, sourceCode = null, edgeSummary = null) {
    if (!node) {
      this.hide();
      return;
    }

    this.currentNode = node;
    this.sourceCode = sourceCode || node.source || '';

    // Update info section
    const infoEl = this.container.querySelector('#inspectorInfo');
    if (infoEl) {
      infoEl.innerHTML = this.renderInfo(node);
    }

    // Update code section
    const codeEl = this.container.querySelector('#inspectorCode code');
    if (codeEl) {
      codeEl.textContent = this.sourceCode;
      
      // Determine language for syntax highlighting
      const lang = this.getLanguage(node);
      codeEl.className = `language-${lang}`;
      
      // Highlight syntax (Prism.js should be loaded)
      if (window.Prism) {
        Prism.highlightElement(codeEl);
      }
    }

    // Show panel
    if (this.panelEl) {
      this.panelEl.classList.remove('hidden');
      this.panelEl.classList.add('visible');
    }

    this.renderEdges(edgeSummary);
    this.attachEdgeButtonHandlers();
  }

  /**
   * Hide inspector
   */
  hide() {
    if (this.panelEl) {
      this.panelEl.classList.add('hidden');
      this.panelEl.classList.remove('visible');
    }
    this.currentNode = null;
    this.sourceCode = null;
    this.renderEdges(null);
  }

  /**
   * Check if inspector is visible
   */
  isVisible() {
    return this.panelEl && this.panelEl.classList.contains('visible');
  }

  /**
   * Render node information
   */
  renderInfo(node) {
    const parts = [];
    
    if (node.fqName) {
      parts.push(`<div class="info-row"><strong>Name:</strong> <code>${this.escapeHtml(node.fqName)}</code></div>`);
    }
    
    if (node.filePath) {
      parts.push(`<div class="info-row"><strong>File:</strong> <code>${this.escapeHtml(node.filePath)}</code></div>`);
    }
    
    if (node.lang) {
      parts.push(`<div class="info-row"><strong>Language:</strong> ${this.escapeHtml(node.lang)}</div>`);
    }
    
    if (node.size || node.loc) {
      parts.push(`<div class="info-row"><strong>Lines:</strong> ${node.size || node.loc}</div>`);
    }
    
    if (node.startLine && node.endLine) {
      parts.push(`<div class="info-row"><strong>Range:</strong> ${node.startLine}:${node.startColumn} - ${node.endLine}:${node.endColumn}</div>`);
    }
    
    const metricBadges = this.buildMetricBadges(node.metrics);
    if (metricBadges.length) {
      parts.push(`<div class="info-row"><strong>Metrics:</strong> ${metricBadges.join('')}</div>`);
    }

    const centralityRow = this.renderCentralityRow(node);
    if (centralityRow) {
      parts.push(centralityRow);
    }

    const coreNumber = this.getCoreNumber(node);
    if (coreNumber !== null) {
      parts.push(`<div class="info-row"><strong>Core Number:</strong> ${coreNumber}</div>`);
    }
    
    const community = this.getCommunity(node);
    if (community !== null) {
      parts.push(`<div class="info-row"><strong>Community:</strong> ${community}</div>`);
    }
    
    if (node.doc) {
      parts.push(`<div class="info-row"><strong>Documentation:</strong> <em>${this.escapeHtml(node.doc)}</em></div>`);
    }
    
    return parts.join('');
  }

  renderEdges(edgeSummary) {
    if (!this.edgesContainer || !this.edgeOutList || !this.edgeInList) {
      return;
    }

    if (!edgeSummary) {
      this.edgesContainer.classList.add('hidden');
      this.edgeOutList.innerHTML = '';
      this.edgeInList.innerHTML = '';
      if (this.edgeSimilarityList) {
        this.edgeSimilarityList.innerHTML = '';
      }
      return;
    }

    this.edgesContainer.classList.remove('hidden');
    this.edgeOutList.innerHTML = this.renderEdgeList(edgeSummary.outbound || [], 'No outgoing calls');
    this.edgeInList.innerHTML = this.renderEdgeList(edgeSummary.inbound || [], 'No incoming calls');
    if (this.edgeSimilarityList) {
      this.edgeSimilarityList.innerHTML = this.renderEdgeList(
        edgeSummary.similarity || [],
        'No similar functions'
      );
    }
  }

  renderEdgeList(edges, emptyMessage) {
    if (!edges.length) {
      return `<div class="inspector-edge-empty">${emptyMessage}</div>`;
    }

    const limited = edges.slice(0, 8);
    const html = limited.map(edge => {
      const target = edge.node || {};
      const label = this.escapeHtml(target.fqName || target.name || edge.nodeId || '(unknown)');
      const metaParts = [];
      if (edge.type === 'call') {
        metaParts.push(edge.dynamic ? 'dynamic' : 'static');
        metaParts.push(`×${edge.weight || 1}`);
      } else if (edge.type === 'similarity') {
        metaParts.push('similarity');
        const weight = Number.isFinite(edge.weight) ? edge.weight : 0;
        metaParts.push(`sim ${weight.toFixed(2)}`);
        if (edge.method) {
          metaParts.push(edge.method);
        }
      } else {
        metaParts.push(edge.type || 'edge');
        metaParts.push(`×${edge.weight || 1}`);
      }
      const resolutionStatus =
        edge.type === 'call'
          ? edge.resolutionStatus || (edge.resolution && edge.resolution.status)
          : null;
      if (resolutionStatus) {
        metaParts.push(resolutionStatus);
      }
      const meta = metaParts.join(' · ');
      const filePath = this.escapeHtml(target.filePath || '');
      const nodeId = this.escapeHtml(edge.nodeId);
      const reason =
        edge.type === 'call'
          ? edge.resolutionReason || (edge.resolution && edge.resolution.reason) || ''
          : '';
      const reasonLine = reason ? `<span class="inspector-edge-meta">${this.escapeHtml(reason)}</span>` : '';
      return `
        <button class="inspector-edge-btn" data-node-id="${nodeId}">
          <span class="inspector-edge-label">${label}</span>
          <span class="inspector-edge-meta">${meta}</span>
          ${reasonLine}
          ${filePath ? `<span class="inspector-edge-path">${filePath}</span>` : ''}
        </button>
      `;
    }).join('');

    const extra = edges.length > limited.length
      ? `<div class="inspector-edge-more">+${edges.length - limited.length} more</div>`
      : '';

    return html + extra;
  }

  /**
   * Get language for syntax highlighting
   */
  getLanguage(node) {
    const langMap = {
      javascript: 'javascript',
      typescript: 'typescript',
      jsx: 'jsx',
      tsx: 'tsx',
      python: 'python',
      default: 'javascript'
    };
    
    return langMap[node.lang] || langMap.default;
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Update source code
   */
  updateSource(sourceCode) {
    this.sourceCode = sourceCode;
    
    const codeEl = this.container.querySelector('#inspectorCode code');
    if (codeEl) {
      codeEl.textContent = sourceCode;
      
      if (window.Prism && this.currentNode) {
        const lang = this.getLanguage(this.currentNode);
        codeEl.className = `language-${lang}`;
        Prism.highlightElement(codeEl);
      }
    }
  }

  /**
   * Highlight specific lines
   */
  highlightLines(startLine, endLine) {
    // TODO: Implement line highlighting
    // This would require line number rendering and CSS
  }

  attachEdgeButtonHandlers() {
    if (!this.panelEl) {
      return;
    }

    const buttons = this.panelEl.querySelectorAll('.inspector-edge-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const nodeId = btn.getAttribute('data-node-id');
        if (nodeId && typeof this.onNavigate === 'function') {
          this.onNavigate(nodeId);
        }
      });
    });
  }

  buildMetricBadges(metrics = {}) {
    if (!metrics || typeof metrics !== 'object') {
      return [];
    }
    const badges = [];
    Object.entries(metrics).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return;
      }
      if (typeof value === 'number') {
        badges.push(`<span class="metric-tag">${this.escapeHtml(key)}: ${this.formatNumber(value)}</span>`);
      } else if (typeof value === 'string') {
        badges.push(`<span class="metric-tag">${this.escapeHtml(key)}: ${this.escapeHtml(value)}</span>`);
      }
    });
    return badges;
  }

  renderCentralityRow(node) {
    const centrality = this.getCentralityDetails(node);
    if (!centrality) {
      return '';
    }

    const tags = [];
    if (Number.isFinite(centrality.pageRank)) {
      tags.push(`<span class="metric-tag">PageRank: ${this.formatNumber(centrality.pageRank, 3)}</span>`);
    }
    if (Number.isFinite(centrality.betweenness)) {
      tags.push(`<span class="metric-tag">Betweenness: ${this.formatNumber(centrality.betweenness, 3)}</span>`);
    }
    if (Number.isFinite(centrality.degree)) {
      const degreeValue = this.formatInteger(centrality.degree);
      const io = [];
      if (Number.isFinite(centrality.degreeIn)) {
        io.push(`in ${this.formatInteger(centrality.degreeIn)}`);
      }
      if (Number.isFinite(centrality.degreeOut)) {
        io.push(`out ${this.formatInteger(centrality.degreeOut)}`);
      }
      const ioLabel = io.length ? ` (${io.join(' · ')})` : '';
      tags.push(`<span class="metric-tag">Degree: ${degreeValue}${ioLabel}</span>`);
    }
    if (Number.isFinite(centrality.normalizedDegree)) {
      tags.push(`<span class="metric-tag">Norm Degree: ${this.formatPercent(centrality.normalizedDegree)}</span>`);
    }
    if (Number.isFinite(node?.centralityScore)) {
      tags.push(`<span class="metric-tag">Centrality Score: ${this.formatNumber(node.centralityScore, 3)}</span>`);
    }

    if (!tags.length) {
      return '';
    }

    return `<div class="info-row"><strong>Centrality:</strong> ${tags.join('')}</div>`;
  }

  getCentralityDetails(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    const details = node.centralityDetails && typeof node.centralityDetails === 'object'
      ? node.centralityDetails
      : node.metrics && typeof node.metrics.centrality === 'object'
        ? node.metrics.centrality
        : null;
    if (!details) {
      return null;
    }

    const pageRank = this.toFiniteNumber(details.pageRank ?? details.pagerank);
    const betweenness = this.toFiniteNumber(details.betweenness);

    let degree = null;
    let degreeIn = null;
    let degreeOut = null;
    let normalizedDegree = null;

    if (typeof details.degree === 'number') {
      degree = this.toFiniteNumber(details.degree);
    } else if (details.degree && typeof details.degree === 'object') {
      degree = this.toFiniteNumber(details.degree.total ?? details.degree.value);
      degreeIn = this.toFiniteNumber(details.degree.in);
      degreeOut = this.toFiniteNumber(details.degree.out);
      normalizedDegree = this.toFiniteNumber(details.degree.normalized);
    }

    if (normalizedDegree === null) {
      normalizedDegree = this.toFiniteNumber(details.normalizedDegree);
    }

    const hasData =
      Number.isFinite(pageRank) ||
      Number.isFinite(betweenness) ||
      Number.isFinite(degree) ||
      Number.isFinite(degreeIn) ||
      Number.isFinite(degreeOut) ||
      Number.isFinite(normalizedDegree);

    if (!hasData) {
      return null;
    }

    return {
      pageRank,
      betweenness,
      degree,
      degreeIn,
      degreeOut,
      normalizedDegree
    };
  }

  getCoreNumber(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    if (Number.isFinite(node.coreNumber)) {
      return node.coreNumber;
    }
    const metrics = node.metrics || {};
    if (Number.isFinite(metrics.coreNumber)) {
      return metrics.coreNumber;
    }
    const cores = metrics.cores;
    if (cores && typeof cores === 'object') {
      if (Number.isFinite(cores.coreNumber)) {
        return cores.coreNumber;
      }
      const entries = Object.values(cores).filter(Number.isFinite);
      if (entries.length) {
        return entries[0];
      }
    }
    return null;
  }

  getCommunity(node) {
    if (!node || typeof node !== 'object') {
      return null;
    }
    if (node.community !== undefined && node.community !== null) {
      return node.community;
    }
    const metrics = node.metrics || {};
    if (Number.isFinite(metrics.community)) {
      return metrics.community;
    }
    const communities = metrics.communities;
    if (communities && typeof communities === 'object') {
      if (communities.community !== undefined && communities.community !== null) {
        return communities.community;
      }
      const values = Object.values(communities).filter(value => value !== null && value !== undefined);
      if (values.length) {
        return values[0];
      }
    }
    return null;
  }

  formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return Number(value).toFixed(digits);
  }

  formatInteger(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return Math.round(Number(value)).toLocaleString();
  }

  formatPercent(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return `${(Number(value) * 100).toFixed(digits)}%`;
  }

  toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}

