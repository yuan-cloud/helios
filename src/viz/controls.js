/**
 * Visualization Controls and UI
 * 
 * Provides toggles, filters, and controls for the 3D graph visualization
 */

import { BACKENDS } from '../embeddings/backend.js';

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

    this.layoutStatusTimer = null;
    this.similarityStats = null;
    this.analysisSummary = null;
    this.similarityThreshold = 0;
    
    this.init();

    if (this.graphViz) {
      this.graphViz.onSimilarityStatsChange = (stats = {}, options = {}) => {
        this.updateSimilarityControls(stats, options);
      };
      this.graphViz.onPerformanceChange = (state = {}) => {
        this.updatePerformanceControls(state);
      };
    }
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
        <div class="controls-section hidden" id="hoverInfoSection">
          <h4 class="controls-title">Hover</h4>
          <div class="hover-info-primary">
            <div class="hover-info-name" id="hoverInfoName">No node hovered</div>
            <div class="hover-info-path" id="hoverInfoPath"></div>
          </div>
          <div class="hover-info-metrics" id="hoverInfoMetrics">
            <span class="hover-info-badge" id="hoverNeighborCount">0 neighbors</span>
            <span class="hover-info-badge" id="hoverCallOut">0 out</span>
            <span class="hover-info-badge" id="hoverCallIn">0 in</span>
            <span class="hover-info-badge" id="hoverSimilarity">0 sim</span>
            <span class="hover-info-badge" id="hoverResolvedEdges">0 resolved</span>
            <span class="hover-info-badge" id="hoverAmbiguousEdges">0 ambiguous</span>
            <span class="hover-info-badge" id="hoverUnresolvedEdges">0 unresolved</span>
            <span class="hover-info-badge" id="hoverCommunity">Community —</span>
            <span class="hover-info-badge" id="hoverPageRank">PR —</span>
            <span class="hover-info-badge" id="hoverBetweenness">BC —</span>
            <span class="hover-info-badge" id="hoverCore">Core —</span>
          </div>
          <div class="hover-info-neighbors" id="hoverNeighborList"></div>
          <div class="hover-similarity-section hidden" id="hoverSimilaritySection">
            <div class="hover-similarity-title">Top Similar Functions</div>
            <div class="hover-info-neighbors" id="hoverSimilarityList"></div>
          </div>
        </div>

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
          <label class="control-toggle">
            <input type="checkbox" id="toggleHighlightNeighbors" checked>
            <span>Highlight Neighborhood</span>
          </label>
          <div class="control-filter" id="similarityThresholdContainer">
            <label for="similarityThreshold">Min Similarity:</label>
            <input type="range" id="similarityThreshold" min="0" max="1" step="0.01" value="0">
            <div class="control-hint" id="similarityThresholdValue">≥ 0.00</div>
          </div>
        </div>
        
        <div class="controls-section">
          <h4 class="controls-title">Layout</h4>
          <button class="control-button" id="btnResetCamera">Reset Camera</button>
          <button class="control-button" id="btnFitToView">Fit to View</button>
          <button class="control-button" id="btnFreezePositions">Freeze Positions</button>
          <button class="control-button" id="btnResumeSimulation">Resume Simulation</button>
          <button class="control-button" id="btnSaveLayout">Save Layout</button>
          <button class="control-button" id="btnRestoreLayout">Restore Layout</button>
          <button class="control-button" id="btnResetLayout">Reset Layout</button>
          <div class="control-hint" id="layoutStatus" aria-live="polite" style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.35rem;"></div>
          <div class="controls-subsection">
            <label class="control-toggle">
              <input type="checkbox" id="toggleAutoPerformance" checked>
              <span>Auto Performance Tuning</span>
            </label>
            <label class="control-toggle">
              <input type="checkbox" id="toggleHighPerformance" disabled>
              <span>High Performance Mode</span>
            </label>
            <div class="control-hint" id="performanceStatus" aria-live="polite" style="font-size: 0.72rem; color: #cbd5f5;"></div>
          </div>
        </div>

        <div class="controls-section">
          <h4 class="controls-title">Embeddings</h4>
          <div class="control-hint" id="embeddingStatus" aria-live="polite" style="font-size: 0.8rem; color: #cbd5f5;"></div>
          <div class="control-hint" id="embeddingReuseStatus" aria-live="polite" style="font-size: 0.78rem; color: #a5b4fc;"></div>
          <div class="control-hint" id="similarityStatus" aria-live="polite" style="font-size: 0.78rem; color: #a5b4fc;"></div>
        </div>
        <div class="controls-section hidden" id="analysisSummarySection">
          <h4 class="controls-title">Graph Metrics</h4>
          <div class="control-hint" id="analysisSummaryCounts" aria-live="polite" style="font-size: 0.78rem; color: #cbd5f5;"></div>
          <div class="control-hint" id="analysisSummaryCommunities" style="font-size: 0.76rem; color: #a5b4fc;"></div>
          <div class="control-hint" id="analysisSummaryCentrality" style="font-size: 0.76rem; color: #a5b4fc;"></div>
          <div class="control-hint" id="analysisSummaryCores" style="font-size: 0.76rem; color: #cbd5f5;"></div>
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

    this.hoverInfoSection = this.container.querySelector('#hoverInfoSection');
    this.hoverInfoName = this.container.querySelector('#hoverInfoName');
    this.hoverInfoPath = this.container.querySelector('#hoverInfoPath');
    this.hoverNeighborCount = this.container.querySelector('#hoverNeighborCount');
    this.hoverCallOut = this.container.querySelector('#hoverCallOut');
    this.hoverCallIn = this.container.querySelector('#hoverCallIn');
    this.hoverSimilarity = this.container.querySelector('#hoverSimilarity');
    this.hoverNeighborList = this.container.querySelector('#hoverNeighborList');
    this.hoverResolvedEdges = this.container.querySelector('#hoverResolvedEdges');
    this.hoverAmbiguousEdges = this.container.querySelector('#hoverAmbiguousEdges');
    this.hoverUnresolvedEdges = this.container.querySelector('#hoverUnresolvedEdges');
    this.hoverCommunity = this.container.querySelector('#hoverCommunity');
    this.hoverPageRank = this.container.querySelector('#hoverPageRank');
    this.hoverBetweenness = this.container.querySelector('#hoverBetweenness');
    this.hoverCore = this.container.querySelector('#hoverCore');
    this.layoutStatusEl = this.container.querySelector('#layoutStatus');
    this.hoverSimilaritySection = this.container.querySelector('#hoverSimilaritySection');
    this.hoverSimilarityList = this.container.querySelector('#hoverSimilarityList');
    this.similarityThresholdInput = this.container.querySelector('#similarityThreshold');
    this.similarityThresholdValue = this.container.querySelector('#similarityThresholdValue');
    if (this.similarityThresholdInput) {
      this.similarityThresholdInput.disabled = true;
    }
    if (this.hoverSimilaritySection) {
      this.hoverSimilaritySection.style.marginTop = '0.75rem';
    }
    const similarityTitle = this.hoverSimilaritySection?.querySelector('.hover-similarity-title');
    if (similarityTitle) {
      similarityTitle.style.color = '#c7d2fe';
      similarityTitle.style.fontSize = '0.78rem';
      similarityTitle.style.fontWeight = '600';
      similarityTitle.style.marginBottom = '0.35rem';
    }

    this.setHoverInfo(null);
    this.setLayoutStatus('');
    this.updateSimilarityThresholdDisplay(this.similarityThreshold);
    this.performanceAutoToggle = this.container.querySelector('#toggleAutoPerformance');
    this.performanceModeToggle = this.container.querySelector('#toggleHighPerformance');
    this.performanceStatusEl = this.container.querySelector('#performanceStatus');
    this.embeddingStatusEl = this.container.querySelector('#embeddingStatus');
    this.embeddingReuseStatusEl = this.container.querySelector('#embeddingReuseStatus');
    this.similarityStatusEl = this.container.querySelector('#similarityStatus');
    this.analysisSummarySection = this.container.querySelector('#analysisSummarySection');
    this.analysisSummaryCountsEl = this.container.querySelector('#analysisSummaryCounts');
    this.analysisSummaryCommunitiesEl = this.container.querySelector('#analysisSummaryCommunities');
    this.analysisSummaryCentralityEl = this.container.querySelector('#analysisSummaryCentrality');
    this.analysisSummaryCoresEl = this.container.querySelector('#analysisSummaryCores');
    if (this.graphViz && typeof this.graphViz.getPerformanceState === 'function') {
      this.updatePerformanceControls(this.graphViz.getPerformanceState());
    } else {
      this.updatePerformanceControls();
    }
    this.setEmbeddingSummary();
    this.setAnalysisSummary();
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

    const toggleHighlightNeighbors = this.container.querySelector('#toggleHighlightNeighbors');
    if (toggleHighlightNeighbors) {
      const applyHighlightState = (checked) => {
        if (this.graphViz && typeof this.graphViz.setHighlightNeighbors === 'function') {
          this.graphViz.setHighlightNeighbors(checked);
        }
      };

      toggleHighlightNeighbors.addEventListener('change', (e) => {
        applyHighlightState(e.target.checked);
      });

      applyHighlightState(toggleHighlightNeighbors.checked);
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
          this.setLayoutStatus('Simulation resumed.', { tone: 'info' });
        }
      });
    }

    const btnSaveLayout = this.container.querySelector('#btnSaveLayout');
    if (btnSaveLayout) {
      btnSaveLayout.addEventListener('click', async () => {
        if (!this.graphViz) return;
        const ok = await this.graphViz.saveLayoutToStorage();
        const info = this.graphViz.getLastLayoutLoadResult
          ? this.graphViz.getLastLayoutLoadResult()
          : null;
        const tone = ok ? 'success' : 'error';
        const target =
          info?.status === 'saved'
            ? 'OPFS storage'
            : info?.status === 'saved-local'
              ? 'browser storage'
              : 'storage';
        this.setLayoutStatus(
          ok ? `Layout saved to ${target}.` : 'Unable to save layout.',
          { tone }
        );
      });
    }

    const btnRestoreLayout = this.container.querySelector('#btnRestoreLayout');
    if (btnRestoreLayout) {
      btnRestoreLayout.addEventListener('click', async () => {
        if (!this.graphViz) return;
        const restored = await this.graphViz.restoreLayoutFromStorage({ freeze: true });
        if (restored) {
          await this.graphViz.fitToView();
        }

        const info = this.graphViz.getLastLayoutLoadResult
          ? this.graphViz.getLastLayoutLoadResult()
          : null;

        let tone = 'info';
        let message = 'No saved layout available.';

        if (restored) {
          tone = 'success';
          message = 'Saved layout restored.';
        } else if (info?.status === 'mismatch') {
          tone = 'error';
          message = 'Saved layout found but incompatible with current graph.';
        } else if (info?.status === 'error') {
          tone = 'error';
          message = 'Unable to load saved layout.';
        } else if (await this.graphViz.hasStoredLayout()) {
          tone = 'error';
          message = 'Stored layout found but could not be applied.';
        }

        this.setLayoutStatus(message, { tone });
      });
    }

    const btnResetLayout = this.container.querySelector('#btnResetLayout');
    if (btnResetLayout) {
      btnResetLayout.addEventListener('click', async () => {
        if (!this.graphViz) return;
        const hadStored = await this.graphViz.hasStoredLayout();
        await this.graphViz.resetLayoutToDefault({ clearStored: true });
        await this.graphViz.fitToView();
        this.setLayoutStatus(
          hadStored ? 'Saved layout cleared. Simulation reset.' : 'Simulation reset to defaults.',
          { tone: 'info' }
        );
      });
    }

    const toggleAutoPerformance = this.container.querySelector('#toggleAutoPerformance');
    if (toggleAutoPerformance) {
      toggleAutoPerformance.addEventListener('change', (e) => {
        if (!this.graphViz) return;
        this.graphViz.setPerformanceAuto(e.target.checked);
      });
    }

    const toggleHighPerformance = this.container.querySelector('#toggleHighPerformance');
    if (toggleHighPerformance) {
      toggleHighPerformance.addEventListener('change', (e) => {
        if (!this.graphViz) return;
        const mode = e.target.checked ? 'performance' : 'balanced';
        this.graphViz.setPerformanceMode(mode, { reason: 'manual' });
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
  }

  setLayoutStatus(message, { tone = 'info', timeout = 3000 } = {}) {
    if (!this.layoutStatusEl) {
      return;
    }

    const palette = {
      info: '#94a3b8',
      success: '#34d399',
      error: '#f87171'
    };

    const color = palette[tone] || palette.info;
    this.layoutStatusEl.textContent = message || '';
    this.layoutStatusEl.style.color = color;

    if (this.layoutStatusTimer) {
      clearTimeout(this.layoutStatusTimer);
      this.layoutStatusTimer = null;
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

    if (this.similarityThresholdInput) {
      const handler = (event) => {
        this.handleSimilarityThresholdChange(event.target.value);
      };
      this.similarityThresholdInput.addEventListener('input', handler);
      this.similarityThresholdInput.addEventListener('change', handler);
    }
  }

  setLayoutStatus(message, { tone = 'info', timeout = 3000 } = {}) {
    if (!this.layoutStatusEl) {
      return;
    }

    const palette = {
      info: '#94a3b8',
      success: '#34d399',
      error: '#f87171'
    };

    const color = palette[tone] || palette.info;
    this.layoutStatusEl.textContent = message || '';
    this.layoutStatusEl.style.color = color;

    if (this.layoutStatusTimer) {
      clearTimeout(this.layoutStatusTimer);
      this.layoutStatusTimer = null;
    }

    if (message && timeout > 0) {
      this.layoutStatusTimer = setTimeout(() => {
        this.layoutStatusEl.textContent = '';
        this.layoutStatusTimer = null;
      }, timeout);
    }
  }

  setEmbeddingSummary(summary = null) {
    if (!summary) {
      if (this.embeddingStatusEl) {
        this.embeddingStatusEl.textContent = 'Embeddings will be generated on visualization.';
        this.embeddingStatusEl.style.color = '#cbd5f5';
      }
      if (this.embeddingReuseStatusEl) {
        this.embeddingReuseStatusEl.textContent = '';
      }
      if (this.similarityStatusEl) {
        this.similarityStatusEl.textContent = '';
      }
      return;
    }

    const {
      chunkCount = 0,
      metadata = {},
      reuse = null,
      cached = false,
      similarityEdges = null,
      functionsWithEmbeddings = null,
      error = null,
      detection = null
    } = summary;

    if (this.embeddingStatusEl) {
      if (error) {
        this.embeddingStatusEl.textContent = `Embeddings error: ${error.message || error}`;
        this.embeddingStatusEl.style.color = '#f87171';
      } else if (chunkCount === 0) {
        if (detection?.error) {
          this.embeddingStatusEl.textContent = `Embedding backend detection failed: ${detection.error}`;
          this.embeddingStatusEl.style.color = '#f87171';
        } else if (detection?.detected) {
          const backendValue = metadata.backend || detection.backend || BACKENDS.WASM;
          const backendLabel = backendValue ? backendValue.toUpperCase() : 'UNKNOWN';
          const descriptorParts = [];
          if (detection.webgpuAvailable) {
            descriptorParts.push('WebGPU available');
          } else {
            descriptorParts.push('WebGPU unavailable');
            if ((backendValue || '').toLowerCase() !== BACKENDS.WEBGPU) {
              descriptorParts.push('using WASM');
            }
          }
          descriptorParts.push(detection.forced ? 'forced selection' : 'auto-detected');
          const descriptor = descriptorParts.join(' · ');
          this.embeddingStatusEl.textContent = `Embedding backend: ${backendLabel} (${descriptor})`;
          this.embeddingStatusEl.style.color = '#cbd5f5';
        } else {
          this.embeddingStatusEl.textContent = 'Embeddings not available for this dataset.';
          this.embeddingStatusEl.style.color = '#cbd5f5';
        }
      } else {
        const backendLabel = metadata.backend ? metadata.backend.toUpperCase() : 'WASM';
        const dimLabel = metadata.dimension ? `${metadata.dimension}-dim` : 'unknown dim';
        const cachedLabel = cached ? 'cached' : 'fresh';
        this.embeddingStatusEl.textContent = `${chunkCount.toLocaleString()} embedding chunk${chunkCount === 1 ? '' : 's'} · ${dimLabel}, ${backendLabel} (${cachedLabel})`;
        this.embeddingStatusEl.style.color = '#cbd5f5';
      }
    }

    if (this.embeddingReuseStatusEl) {
      if (reuse && (Number.isFinite(reuse.reused) || Number.isFinite(reuse.embedded))) {
        const reusedCount = Number.isFinite(reuse.reused) ? reuse.reused : 0;
        const embeddedCount = Number.isFinite(reuse.embedded) ? reuse.embedded : 0;
        if (reusedCount === 0 && embeddedCount === 0) {
          this.embeddingReuseStatusEl.textContent = '';
        } else {
          const reusedLabel = `${reusedCount.toLocaleString()} reused`;
          const embeddedLabel = embeddedCount > 0 ? ` / ${embeddedCount.toLocaleString()} new` : '';
          this.embeddingReuseStatusEl.textContent = `Reuse summary: ${reusedLabel}${embeddedLabel}`;
        }
      } else {
        this.embeddingReuseStatusEl.textContent = '';
      }
    }

    if (this.similarityStatusEl) {
      if (similarityEdges === null && functionsWithEmbeddings === null) {
        this.similarityStatusEl.textContent = '';
      } else if (
        Number.isFinite(similarityEdges) &&
        Number.isFinite(functionsWithEmbeddings)
      ) {
        this.similarityStatusEl.textContent = `Similarity edges: ${similarityEdges.toLocaleString()} · Functions with embeddings: ${functionsWithEmbeddings.toLocaleString()}`;
      } else if (Number.isFinite(similarityEdges)) {
        this.similarityStatusEl.textContent = `Similarity edges: ${similarityEdges.toLocaleString()}`;
      } else if (Number.isFinite(functionsWithEmbeddings)) {
        this.similarityStatusEl.textContent = `Functions with embeddings: ${functionsWithEmbeddings.toLocaleString()}`;
      } else {
        this.similarityStatusEl.textContent = '';
      }
    }
  }

  setAnalysisSummary(summary = null) {
    this.analysisSummary = summary || null;
    if (!this.analysisSummarySection) {
      return;
    }

    if (!summary) {
      this.analysisSummarySection.classList.add('hidden');
      if (this.analysisSummaryCountsEl) this.analysisSummaryCountsEl.textContent = '';
      if (this.analysisSummaryCommunitiesEl) this.analysisSummaryCommunitiesEl.textContent = '';
      if (this.analysisSummaryCentralityEl) this.analysisSummaryCentralityEl.textContent = '';
      if (this.analysisSummaryCoresEl) this.analysisSummaryCoresEl.textContent = '';
      return;
    }

    this.analysisSummarySection.classList.remove('hidden');

    const counts = summary.counts || {};
    const nodeCount = Number.isFinite(counts.nodes) ? counts.nodes : 0;
    const callEdges = Number.isFinite(counts.callEdges) ? counts.callEdges : 0;
    const similarityEdges = Number.isFinite(counts.similarityEdges) ? counts.similarityEdges : 0;
    if (this.analysisSummaryCountsEl) {
      const nodeLabel = `${nodeCount.toLocaleString()} node${nodeCount === 1 ? '' : 's'}`;
      const callLabel = `${callEdges.toLocaleString()} call edge${callEdges === 1 ? '' : 's'}`;
      const similarityLabel = `${similarityEdges.toLocaleString()} similarity edge${similarityEdges === 1 ? '' : 's'}`;
      this.analysisSummaryCountsEl.textContent = `${nodeLabel} · ${callLabel} · ${similarityLabel}`;
    }

    const communities = summary.communities || {};
    if (this.analysisSummaryCommunitiesEl) {
      const totalCommunities = Number.isFinite(communities.total) ? communities.total : 0;
      const topCommunity = Array.isArray(communities.top) && communities.top.length ? communities.top[0] : null;
      const parts = [];
      parts.push(`${totalCommunities.toLocaleString()} communit${totalCommunities === 1 ? 'y' : 'ies'}`);
      if (topCommunity && topCommunity.community !== undefined) {
        const topLabel = `${topCommunity.community}`;
        const topCount = Number.isFinite(topCommunity.count) ? ` – ${topCommunity.count.toLocaleString()}` : '';
        parts.push(`largest ${topLabel}${topCount}`);
      }
      if (Number.isFinite(communities.modularity)) {
        parts.push(`modularity ${communities.modularity.toFixed(3)}`);
      }
      this.analysisSummaryCommunitiesEl.textContent = parts.join(' · ');
    }

    const centrality = summary.centrality || {};
    if (this.analysisSummaryCentralityEl) {
      const top = Array.isArray(centrality.top) ? centrality.top : [];
      const formatted = top.slice(0, 3).map(entry => {
        const label = entry.name || entry.id;
        const score = Number.isFinite(entry.score)
          ? entry.score.toFixed(2)
          : Number.isFinite(entry.pageRank)
            ? entry.pageRank.toFixed(3)
            : null;
        return score ? `${label} (${score})` : label;
      });
      this.analysisSummaryCentralityEl.textContent = formatted.length
        ? `Top central: ${formatted.join(', ')}`
        : 'Top central: —';
    }

    const cores = summary.cores || {};
    if (this.analysisSummaryCoresEl) {
      const parts = [];
      if (Number.isFinite(cores.degeneracy)) {
        parts.push(`degeneracy ${cores.degeneracy}`);
      }
      if (cores.top && Number.isFinite(cores.top.coreNumber)) {
        const count = Number.isFinite(cores.top.count) ? ` (${cores.top.count.toLocaleString()})` : '';
        parts.push(`max core ${cores.top.coreNumber}${count}`);
      }
      this.analysisSummaryCoresEl.textContent = parts.length ? parts.join(' · ') : 'Core data unavailable';
    }
  }

  updatePerformanceControls(state = null) {
    if (!state) {
      state = { mode: 'balanced', auto: true };
    }

    if (this.performanceAutoToggle) {
      this.performanceAutoToggle.checked = !!state.auto;
    }

    if (this.performanceModeToggle) {
      this.performanceModeToggle.checked = state.mode === 'performance';
      this.performanceModeToggle.disabled = !!state.auto;
    }

    if (this.performanceStatusEl) {
      const modeLabel = state.mode === 'performance' ? 'High performance' : 'Balanced';
      const autoLabel = state.auto ? 'auto' : 'manual';
      let statusText = `${modeLabel} (${autoLabel})`;
      if (Number.isFinite(state.lastSettleMs)) {
        const seconds = state.lastSettleMs / 1000;
        const formatted = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
        statusText += ` · settled in ${formatted}s`;
      }
      this.performanceStatusEl.textContent = statusText;
    }
  }

  updateSimilarityControls(stats = {}, options = {}) {
    this.similarityStats = stats;
    if (!this.similarityThresholdInput || !this.similarityThresholdValue) {
      return;
    }

    if (!stats || !stats.count) {
      this.similarityThresholdInput.disabled = true;
      this.similarityThresholdInput.value = 0;
      this.updateSimilarityThresholdDisplay(0, true);
      return;
    }

    const min = Number.isFinite(stats.min) ? stats.min : 0;
    const max = Number.isFinite(stats.max) ? stats.max : (min === 0 ? 1 : min);
    const range = Math.max(max - min, 0.0001);
    const step = Math.max(range / 100, 0.0001);
    const hasRange = max > min + 1e-6;

    this.similarityThresholdInput.disabled = !hasRange;
    this.similarityThresholdInput.min = min.toFixed(3);
    this.similarityThresholdInput.max = max.toFixed(3);
    this.similarityThresholdInput.step = step.toFixed(3);

    const provided = Number.isFinite(options?.minWeight) ? options.minWeight : min;
    this.similarityThreshold = this.clampThreshold(provided, min, max);
    this.similarityThresholdInput.value = this.similarityThreshold;
    this.updateSimilarityThresholdDisplay(this.similarityThreshold);
  }

  handleSimilarityThresholdChange(rawValue) {
    if (!this.similarityThresholdInput || !this.graphViz) {
      return;
    }
    const stats = this.similarityStats || {};
    const min = Number.isFinite(stats.min) ? stats.min : Number.parseFloat(this.similarityThresholdInput.min) || 0;
    const max = Number.isFinite(stats.max) ? stats.max : Number.parseFloat(this.similarityThresholdInput.max) || 1;
    let numericValue = Number.parseFloat(rawValue);
    if (!Number.isFinite(numericValue)) {
      numericValue = min;
    }
    numericValue = this.clampThreshold(numericValue, min, max);
    this.similarityThreshold = numericValue;
    this.similarityThresholdInput.value = this.similarityThreshold;
    this.updateSimilarityThresholdDisplay(numericValue);
    if (typeof this.graphViz.setSimilarityThreshold === 'function') {
      this.graphViz.setSimilarityThreshold(numericValue);
    }
  }

  updateSimilarityThresholdDisplay(value, noData = false) {
    if (!this.similarityThresholdValue) {
      return;
    }
    if (noData) {
      this.similarityThresholdValue.textContent = 'No similarity edges';
      return;
    }
    this.similarityThresholdValue.textContent = `≥ ${value.toFixed(2)}`;
  }

  clampThreshold(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

  setHoverInfo(info) {
    if (!this.hoverInfoSection) {
      return;
    }

    const formatDecimal = (value, digits = 2) =>
      Number.isFinite(value) ? value.toFixed(digits) : '—';

    if (!info || !info.node) {
      this.hoverInfoSection.classList.add('hidden');
      if (this.hoverNeighborList) {
        this.hoverNeighborList.innerHTML = '';
      }
      if (this.hoverSimilarityList) {
        this.hoverSimilarityList.innerHTML = '';
      }
      if (this.hoverSimilaritySection) {
        this.hoverSimilaritySection.classList.add('hidden');
      }
      if (this.hoverInfoName) this.hoverInfoName.textContent = 'No node hovered';
      if (this.hoverInfoPath) this.hoverInfoPath.textContent = '';
      if (this.hoverNeighborCount) this.hoverNeighborCount.textContent = '0 neighbors';
      if (this.hoverCallOut) this.hoverCallOut.textContent = '0 out';
      if (this.hoverCallIn) this.hoverCallIn.textContent = '0 in';
      if (this.hoverSimilarity) this.hoverSimilarity.textContent = '0 sim';
      if (this.hoverResolvedEdges) this.hoverResolvedEdges.textContent = '0 resolved';
      if (this.hoverAmbiguousEdges) this.hoverAmbiguousEdges.textContent = '0 ambiguous';
      if (this.hoverUnresolvedEdges) this.hoverUnresolvedEdges.textContent = '0 unresolved';
      if (this.hoverCommunity) this.hoverCommunity.textContent = 'Community —';
      if (this.hoverPageRank) this.hoverPageRank.textContent = 'PR —';
      if (this.hoverBetweenness) this.hoverBetweenness.textContent = 'BC —';
      if (this.hoverCore) this.hoverCore.textContent = 'Core —';
      return;
    }

    const { node, neighborCount = 0, neighbors = [], stats = {}, similarity = [] } = info;
    const resolutionStats = stats.resolution || {};

    this.hoverInfoSection.classList.remove('hidden');

    if (this.hoverInfoName) {
      this.hoverInfoName.textContent = node.fqName || node.name || '(anonymous)';
    }

    if (this.hoverInfoPath) {
      const langLabel = node.lang ? ` · ${node.lang}` : '';
      this.hoverInfoPath.textContent = `${node.filePath || '—'}${langLabel}`;
    }

    if (this.hoverNeighborCount) {
      this.hoverNeighborCount.textContent = `${neighborCount} neighbor${neighborCount === 1 ? '' : 's'}`;
    }
    if (this.hoverCallOut) {
      this.hoverCallOut.textContent = `${stats.callOutgoing || 0} out`;
    }
    if (this.hoverCallIn) {
      this.hoverCallIn.textContent = `${stats.callIncoming || 0} in`;
    }
    if (this.hoverSimilarity) {
      this.hoverSimilarity.textContent = `${stats.similarityEdges || 0} sim`;
    }
    if (this.hoverResolvedEdges) {
      this.hoverResolvedEdges.textContent = `${resolutionStats.resolved || 0} resolved`;
    }
    if (this.hoverAmbiguousEdges) {
      this.hoverAmbiguousEdges.textContent = `${resolutionStats.ambiguous || 0} ambiguous`;
    }
    if (this.hoverUnresolvedEdges) {
      this.hoverUnresolvedEdges.textContent = `${resolutionStats.unresolved || 0} unresolved`;
    }
    if (this.hoverCommunity) {
      const community = stats.community;
      this.hoverCommunity.textContent =
        community !== undefined && community !== null ? `Community ${community}` : 'Community —';
    }
    if (this.hoverPageRank) {
      const pageRank = stats.centrality && Number.isFinite(stats.centrality.pageRank)
        ? stats.centrality.pageRank
        : null;
      this.hoverPageRank.textContent = pageRank !== null ? `PR ${formatDecimal(pageRank, 3)}` : 'PR —';
    }
    if (this.hoverBetweenness) {
      const betweenness = stats.centrality && Number.isFinite(stats.centrality.betweenness)
        ? stats.centrality.betweenness
        : null;
      this.hoverBetweenness.textContent = betweenness !== null ? `BC ${formatDecimal(betweenness, 3)}` : 'BC —';
    }
    if (this.hoverCore) {
      const coreNumber = stats.coreNumber;
      this.hoverCore.textContent =
        Number.isFinite(coreNumber) ? `Core ${coreNumber}` : 'Core —';
    }

    if (this.hoverNeighborList) {
      this.hoverNeighborList.innerHTML = '';

      if (neighbors.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'hover-neighbor-empty';
        empty.textContent = 'No immediate neighbors';
        this.hoverNeighborList.appendChild(empty);
      } else {
        neighbors.forEach(neighbor => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'hover-neighbor-btn';
          button.textContent = neighbor.name || neighbor.id;
          button.title = neighbor.filePath || neighbor.id;
          button.addEventListener('click', () => {
            if (this.graphViz && typeof this.graphViz.focusNodeById === 'function') {
              this.graphViz.focusNodeById(neighbor.id);
            }
          });
          this.hoverNeighborList.appendChild(button);
        });

        if (neighborCount > neighbors.length) {
          const more = document.createElement('div');
          more.className = 'hover-neighbor-more';
          more.textContent = `+${neighborCount - neighbors.length} more`;
          this.hoverNeighborList.appendChild(more);
        }
      }
    }

    if (this.hoverSimilarityList && this.hoverSimilaritySection) {
      const similarityEntries = Array.isArray(similarity) ? similarity : [];
      this.hoverSimilarityList.innerHTML = '';
      if (similarityEntries.length === 0) {
        this.hoverSimilaritySection.classList.add('hidden');
      } else {
        this.hoverSimilaritySection.classList.remove('hidden');
        const maxItems = 5;
        similarityEntries.slice(0, maxItems).forEach(entry => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'hover-neighbor-btn';
          const label = entry.node?.fqName || entry.node?.name || entry.nodeId || '(unknown)';
          const weight = Number.isFinite(entry.weight) ? entry.weight : 0;
          button.textContent = `${label} (${weight.toFixed(2)})`;
          button.title = entry.node?.filePath || entry.nodeId || label;
          button.addEventListener('click', () => {
            if (this.graphViz && typeof this.graphViz.focusNodeById === 'function') {
              this.graphViz.focusNodeById(entry.nodeId);
            }
          });
          this.hoverSimilarityList.appendChild(button);
        });
        if (similarityEntries.length > maxItems) {
          const more = document.createElement('div');
          more.className = 'hover-neighbor-more';
          more.textContent = `+${similarityEntries.length - maxItems} more`;
          this.hoverSimilarityList.appendChild(more);
        }
      }
    }
  }
}

