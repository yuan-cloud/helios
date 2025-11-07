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
          <div class="inspector-code-container">
            <pre class="inspector-code" id="inspectorCode"><code></code></pre>
          </div>
        </div>
      </div>
    `;
    
    // Store panel element for visibility toggling
    this.panelEl = this.container.querySelector('.inspector-panel');

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
  show(node, sourceCode = null) {
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
    
    if (node.metrics && Object.keys(node.metrics).length > 0) {
      const metricsHtml = Object.entries(node.metrics)
        .map(([k, v]) => `<span class="metric-tag">${k}: ${v}</span>`)
        .join('');
      parts.push(`<div class="info-row"><strong>Metrics:</strong> ${metricsHtml}</div>`);
    }
    
    if (node.community !== undefined) {
      parts.push(`<div class="info-row"><strong>Community:</strong> ${node.community}</div>`);
    }
    
    if (node.centrality !== undefined) {
      parts.push(`<div class="info-row"><strong>Centrality:</strong> ${node.centrality.toFixed(3)}</div>`);
    }
    
    if (node.doc) {
      parts.push(`<div class="info-row"><strong>Documentation:</strong> <em>${this.escapeHtml(node.doc)}</em></div>`);
    }
    
    return parts.join('');
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
}

