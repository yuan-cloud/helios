/**
 * Visualization Controls and UI
 * 
 * Provides toggles, filters, and controls for the 3D graph visualization
 */

/**
 * VisualizationControls - UI controls for graph visualization
 */
export class VisualizationControls {
  constructor(container, graphViz, options = {}) {
    this.container = container;
    this.graphViz = graphViz;
    this.options = {
      showFilters: true,
      showExport: true,
      ...options
    };
    
    this.filters = {
      module: null,
      folder: null,
      language: null,
      minSize: 0,
      maxSize: Infinity
    };
    
    this.init();
  }

  /**
   * Initialize controls UI
   */
  init() {
    if (!this.container) {
      throw new Error('Container element required');
    }

    this.container.innerHTML = `
      <div class="viz-controls-panel">
        <div class="controls-section">
          <h4 class="controls-title">Edges</h4>
          <label class="control-toggle">
            <input type="checkbox" id="toggleCallEdges" checked>
            <span>Call Edges</span>
          </label>
          <label class="control-toggle">
            <input type="checkbox" id="toggleSimilarityEdges" checked>
            <span>Similarity Edges</span>
          </label>
        </div>
        
        <div class="controls-section">
          <h4 class="controls-title">Layout</h4>
          <button class="control-button" id="btnResetCamera">Reset Camera</button>
          <button class="control-button" id="btnFitToView">Fit to View</button>
          <button class="control-button" id="btnFreezePositions">Freeze Positions</button>
          <button class="control-button" id="btnResumeSimulation">Resume Simulation</button>
        </div>
        
        ${this.options.showFilters ? `
        <div class="controls-section">
          <h4 class="controls-title">Filters</h4>
          <div class="control-filter">
            <label>Module/Folder:</label>
            <input type="text" id="filterModule" placeholder="e.g., src/utils">
          </div>
          <div class="control-filter">
            <label>Language:</label>
            <select id="filterLanguage">
              <option value="">All</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
            </select>
          </div>
          <div class="control-filter">
            <label>Min Size (LOC):</label>
            <input type="number" id="filterMinSize" min="0" value="0">
          </div>
          <div class="control-filter">
            <label>Max Size (LOC):</label>
            <input type="number" id="filterMaxSize" min="0" placeholder="No limit">
          </div>
          <button class="control-button" id="btnApplyFilters">Apply Filters</button>
          <button class="control-button" id="btnClearFilters">Clear Filters</button>
        </div>
        ` : ''}
        
        ${this.options.showExport ? `
        <div class="controls-section">
          <h4 class="controls-title">Export</h4>
          <button class="control-button" id="btnExportPNG">Export PNG</button>
          <button class="control-button" id="btnExportJSON">Export JSON</button>
        </div>
        ` : ''}
      </div>
    `;

    this.attachEventHandlers();
  }

  /**
   * Attach event handlers to controls
   */
  attachEventHandlers() {
    // Edge toggles
    const toggleCallEdges = this.container.querySelector('#toggleCallEdges');
    if (toggleCallEdges) {
      toggleCallEdges.addEventListener('change', (e) => {
        if (this.graphViz) {
          this.graphViz.toggleCallEdges(e.target.checked);
        }
      });
    }

    const toggleSimilarityEdges = this.container.querySelector('#toggleSimilarityEdges');
    if (toggleSimilarityEdges) {
      toggleSimilarityEdges.addEventListener('change', (e) => {
        if (this.graphViz) {
          this.graphViz.toggleSimilarityEdges(e.target.checked);
        }
      });
    }

    // Layout controls
    const btnResetCamera = this.container.querySelector('#btnResetCamera');
    if (btnResetCamera) {
      btnResetCamera.addEventListener('click', () => {
        if (this.graphViz) {
          this.graphViz.resetCamera();
        }
      });
    }

    const btnFitToView = this.container.querySelector('#btnFitToView');
    if (btnFitToView) {
      btnFitToView.addEventListener('click', () => {
        if (this.graphViz) {
          this.graphViz.fitToView();
        }
      });
    }

    const btnFreezePositions = this.container.querySelector('#btnFreezePositions');
    if (btnFreezePositions) {
      btnFreezePositions.addEventListener('click', () => {
        if (this.graphViz) {
          this.graphViz.freezePositions(true);
        }
      });
    }

    const btnResumeSimulation = this.container.querySelector('#btnResumeSimulation');
    if (btnResumeSimulation) {
      btnResumeSimulation.addEventListener('click', () => {
        if (this.graphViz) {
          this.graphViz.freezePositions(false);
          this.graphViz.pauseSimulation(false);
        }
      });
    }

    // Filters
    if (this.options.showFilters) {
      const btnApplyFilters = this.container.querySelector('#btnApplyFilters');
      if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', () => {
          this.applyFilters();
        });
      }

      const btnClearFilters = this.container.querySelector('#btnClearFilters');
      if (btnClearFilters) {
        btnClearFilters.addEventListener('click', () => {
          this.clearFilters();
        });
      }
    }

    // Export
    if (this.options.showExport) {
      const btnExportPNG = this.container.querySelector('#btnExportPNG');
      if (btnExportPNG) {
        btnExportPNG.addEventListener('click', async () => {
          await this.exportPNG();
        });
      }

      const btnExportJSON = this.container.querySelector('#btnExportJSON');
      if (btnExportJSON) {
        btnExportJSON.addEventListener('click', () => {
          this.exportJSON();
        });
      }
    }
  }

  /**
   * Apply filters to graph
   */
  applyFilters() {
    const filterModule = this.container.querySelector('#filterModule');
    const filterLanguage = this.container.querySelector('#filterLanguage');
    const filterMinSize = this.container.querySelector('#filterMinSize');
    const filterMaxSize = this.container.querySelector('#filterMaxSize');

    this.filters = {
      module: filterModule?.value || null,
      folder: filterModule?.value || null, // Same as module for now
      language: filterLanguage?.value || null,
      minSize: parseInt(filterMinSize?.value || '0', 10),
      maxSize: filterMaxSize?.value ? parseInt(filterMaxSize.value, 10) : Infinity
    };

    // Notify graph visualization to apply filters
    if (this.graphViz && this.graphViz.onFilterChange) {
      this.graphViz.onFilterChange(this.filters);
    }
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    const filterModule = this.container.querySelector('#filterModule');
    const filterLanguage = this.container.querySelector('#filterLanguage');
    const filterMinSize = this.container.querySelector('#filterMinSize');
    const filterMaxSize = this.container.querySelector('#filterMaxSize');

    if (filterModule) filterModule.value = '';
    if (filterLanguage) filterLanguage.value = '';
    if (filterMinSize) filterMinSize.value = '0';
    if (filterMaxSize) filterMaxSize.value = '';

    this.filters = {
      module: null,
      folder: null,
      language: null,
      minSize: 0,
      maxSize: Infinity
    };

    if (this.graphViz && this.graphViz.onFilterChange) {
      this.graphViz.onFilterChange(this.filters);
    }
  }

  /**
   * Export graph as PNG
   */
  async exportPNG() {
    if (!this.graphViz) return;

    try {
      const dataUrl = await this.graphViz.exportPNG();
      if (dataUrl) {
        // Create download link
        const link = document.createElement('a');
        link.download = `helios-graph-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error('Failed to export PNG:', err);
      alert('Failed to export PNG. See console for details.');
    }
  }

  /**
   * Export graph data as JSON
   */
  exportJSON() {
    if (!this.graphViz) return;

    try {
      const json = this.graphViz.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.download = `helios-graph-${Date.now()}.json`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export JSON:', err);
      alert('Failed to export JSON. See console for details.');
    }
  }

  /**
   * Get current filter values
   */
  getFilters() {
    return { ...this.filters };
  }
}

