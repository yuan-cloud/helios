# Professional Improvements for HELIOS

Based on PLAN.md specifications and BEST_PRACTICES_*.md guides, here are the improvements needed to make HELIOS production-ready.

## Issue: "Clear Stored Data" Requirement

**Problem**: Application only works correctly after clearing stored data, indicating:
1. Stale cache/data causing conflicts
2. Missing cache invalidation strategy
3. No migration path for old data formats
4. Schema version mismatches not handled gracefully

## Recommended Improvements

### 1. Storage Management & Cache Invalidation

#### A. Data Versioning & Cache Invalidation

**Current State**: 
- Schema versioning exists (`HELIOS_SCHEMA_VERSION = 2`)
- Layout snapshots have version (`LAYOUT_SNAPSHOT_VERSION = 1`)
- Resume snapshots have version (`SNAPSHOT_VERSION = 1`)

**Needed**:
- Application-level version tracking
- Automatic cache invalidation on version mismatch
- Migration utilities for old data formats

```javascript
// Add to storage/client.js
export const HELIOS_APP_VERSION = "1.0.0"; // Update on breaking changes

// Check on initialization
async function checkDataCompatibility() {
  const storedVersion = await getMetadata('app.version');
  if (storedVersion && storedVersion !== HELIOS_APP_VERSION) {
    console.warn(`Data version mismatch: ${storedVersion} vs ${HELIOS_APP_VERSION}`);
    // Option 1: Auto-migrate
    // Option 2: Prompt user to clear or migrate
    // Option 3: Clear incompatible data automatically
    return { compatible: false, storedVersion, currentVersion: HELIOS_APP_VERSION };
  }
  return { compatible: true };
}
```

#### B. Cache Invalidation Strategy

```javascript
// Add cache key generation based on data fingerprint
function generateCacheKey(functionFingerprint, embeddingModel, schemaVersion) {
  return `${functionFingerprint}-${embeddingModel}-v${schemaVersion}`;
}

// On load, check cache validity
async function loadWithCacheInvalidation(functionFingerprint) {
  const cacheKey = generateCacheKey(functionFingerprint, embeddingModelId, HELIOS_SCHEMA_VERSION);
  const cached = await loadCachedEmbeddings(cacheKey);
  
  if (cached && cached.version === HELIOS_SCHEMA_VERSION) {
    return cached.data;
  }
  
  // Cache miss or version mismatch - regenerate
  return null;
}
```

### 2. Error Handling & Diagnostics (PLAN.md §4)

#### A. Diagnostics Panel

Following BEST_PRACTICES_BROWSER.md pattern:

```javascript
// Add to index.html
function createDiagnosticsPanel() {
  return {
    crossOriginIsolated: crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    opfsAvailable: 'storage' in navigator && 'getDirectory' in navigator.storage,
    storagePersistent: storagePersistent,
    schemaVersion: HELIOS_SCHEMA_VERSION,
    appVersion: HELIOS_APP_VERSION,
    storageQuota: await navigator.storage?.estimate?.(),
    // ... more diagnostics
  };
}
```

#### B. Comprehensive Error Handling

```javascript
// Add structured error handling per BEST_PRACTICES_BROWSER.md
class HeliosError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();
  }
}

// Error categories
const ERROR_CODES = {
  STORAGE_INIT_FAILED: 'STORAGE_INIT_FAILED',
  SCHEMA_VERSION_MISMATCH: 'SCHEMA_VERSION_MISMATCH',
  CACHE_INVALID: 'CACHE_INVALID',
  PARSER_ERROR: 'PARSER_ERROR',
  EMBEDDING_ERROR: 'EMBEDDING_ERROR',
  VISUALIZATION_ERROR: 'VISUALIZATION_ERROR',
};

// Global error handler with user-friendly messages
window.addEventListener('error', (event) => {
  const error = event.error;
  if (error instanceof HeliosError) {
    showUserFriendlyError(error);
    // Log to error tracking service
    logError(error);
  }
});
```

### 3. UX Flow Improvements (PLAN.md §4)

#### A. Progress Indicators

**Current**: Basic progress bars exist
**Needed**: Detailed instrumentation per PLAN.md §4:

```javascript
// Enhanced progress tracking
const progressState = {
  phase: 'idle', // 'scanning' | 'parsing' | 'extracting' | 'embedding' | 'analyzing' | 'visualizing'
  currentStep: 0,
  totalSteps: 0,
  details: {},
  cancellable: true,
  cancellableCallback: null,
};

// Update UI with detailed progress
function updateProgress(state) {
  progressText.textContent = formatPhaseLabel(state.phase);
  progressDetail.textContent = formatDetails(state.details);
  progressFill.style.width = `${(state.currentStep / state.totalSteps) * 100}%`;
  
  // Example details:
  // "Parsing... 42/150 files (28%) - JavaScript: 23, TypeScript: 19"
  // "Embedding... 150/500 chunks (30%) - WebGPU: 45 chunks/s"
}
```

#### B. Privacy Notice

```html
<!-- Add to hero container -->
<div class="privacy-notice" style="margin-top: 1rem; font-size: 0.85rem; color: #94a3b8; text-align: center;">
  <span>🔒 Your code never leaves your device. All processing happens in your browser.</span>
</div>
```

#### C. Cancellation Support

```javascript
// Make operations cancellable
let cancellationToken = { cancelled: false };

async function parseSourceFiles() {
  cancellationToken = { cancelled: false };
  
  for (const file of files) {
    if (cancellationToken.cancelled) {
      throw new HeliosError('Operation cancelled by user', 'OPERATION_CANCELLED');
    }
    // ... process file
  }
}

// Add cancel button
cancelBtn.addEventListener('click', () => {
  cancellationToken.cancelled = true;
});
```

### 4. Storage Best Practices

#### A. Storage Quota Management

```javascript
// Check quota before storing large data
async function checkStorageQuota(requiredBytes) {
  const estimate = await navigator.storage.estimate();
  const available = estimate.quota - estimate.usage;
  
  if (available < requiredBytes) {
    // Warn user or auto-cleanup old data
    const shouldCleanup = await promptUser('Storage quota low. Clear old data?');
    if (shouldCleanup) {
      await cleanupOldData();
    }
  }
}

// Auto-cleanup old snapshots
async function cleanupOldData(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
  const oldSnapshots = await getSnapshotsOlderThan(maxAge);
  for (const snapshot of oldSnapshots) {
    await deleteSnapshot(snapshot.id);
  }
}
```

#### B. Graceful Degradation

```javascript
// Handle storage failures gracefully
async function ensureStorageClient() {
  try {
    // ... existing code
  } catch (err) {
    console.warn('Storage unavailable, using memory mode:', err);
    
    // Show user-friendly message
    setStorageStatus(
      'Storage unavailable. Data will not persist between sessions.',
      'warning'
    );
    
    // Continue in memory mode
    return false; // But app still works
  }
}
```

### 5. Performance Monitoring (BEST_PRACTICES_VISUALIZATION.md)

#### A. Performance Metrics

```javascript
// Add performance monitoring
const performanceMetrics = {
  parseTime: null,
  embeddingTime: null,
  graphBuildTime: null,
  visualizationInitTime: null,
  memoryUsage: null,
};

// Track and display metrics
function trackPerformance(operation, fn) {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  performanceMetrics[operation] = end - start;
  return result;
}

// Display in UI
function showPerformanceMetrics() {
  const metrics = Object.entries(performanceMetrics)
    .filter(([_, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value.toFixed(2)}ms`)
    .join(', ');
  
  console.log('Performance:', metrics);
  // Or show in diagnostics panel
}
```

#### B. Memory Leak Prevention

```javascript
// Proper resource disposal per BEST_PRACTICES_VISUALIZATION.md
function disposeAll() {
  // Dispose graph visualization
  if (graphViz) {
    graphViz.dispose();
    graphViz = null;
  }
  
  // Dispose parser
  if (parserManager) {
    parserManager.dispose();
  }
  
  // Clear large arrays
  allFunctions = [];
  allCalls = [];
  embeddingVectors = [];
  
  // Force garbage collection hint
  if (global.gc) {
    global.gc();
  }
}
```

### 6. Code Quality & Maintainability

#### A. Error Boundaries

```javascript
// Add error boundary for visualization
function withErrorBoundary(fn, errorMessage) {
  try {
    return fn();
  } catch (err) {
    console.error(errorMessage, err);
    showUserFriendlyError(new HeliosError(
      errorMessage,
      'VISUALIZATION_ERROR',
      { originalError: err.message }
    ));
    // Fallback: return to safe state
    resetToSafeState();
    throw err;
  }
}

// Use everywhere
await withErrorBoundary(
  () => initializeVisualization(),
  'Failed to initialize visualization'
);
```

#### B. Validation & Type Checking

```javascript
// Add payload validation per PLAN.md
import { validateParserPayload } from './tools/validate-parser-output.mjs';

function validateDataBeforeStorage(data) {
  const validation = validateParserPayload(data);
  if (!validation.valid) {
    throw new HeliosError(
      'Data validation failed',
      'VALIDATION_ERROR',
      { errors: validation.errors }
    );
  }
  return true;
}
```

### 7. User Documentation

#### A. In-App Help

```html
<!-- Add help button -->
<button class="help-btn" id="helpBtn" title="Help & Documentation">
  ?
</button>

<!-- Help modal -->
<div class="help-modal hidden" id="helpModal">
  <h3>HELIOS Help</h3>
  <div class="help-section">
    <h4>Getting Started</h4>
    <p>Select a repository folder to analyze your codebase...</p>
  </div>
  <div class="help-section">
    <h4>Troubleshooting</h4>
    <p>If visualization doesn't work, try:</p>
    <ol>
      <li>Clear stored data</li>
      <li>Check browser console for errors</li>
      <li>Verify COOP/COEP headers are enabled</li>
    </ol>
  </div>
</div>
```

#### B. Storage Diagnostics UI

```javascript
// Add to controls panel
function addStorageDiagnostics() {
  const diagnostics = createDiagnosticsPanel();
  
  const html = `
    <div class="controls-section">
      <h4 class="controls-title">Storage Diagnostics</h4>
      <div class="diagnostic-item">
        <span>Cross-Origin Isolation:</span>
        <span class="${diagnostics.crossOriginIsolated ? 'success' : 'error'}">
          ${diagnostics.crossOriginIsolated ? '✅ Enabled' : '❌ Disabled'}
        </span>
      </div>
      <div class="diagnostic-item">
        <span>Storage Mode:</span>
        <span>${diagnostics.storagePersistent ? 'OPFS Persistent' : 'Memory Only'}</span>
      </div>
      <div class="diagnostic-item">
        <span>Schema Version:</span>
        <span>${diagnostics.schemaVersion}</span>
      </div>
      <!-- ... more diagnostics -->
    </div>
  `;
  
  controlsContainer.innerHTML += html;
}
```

## Implementation Priority

### Phase 1: Critical Fixes (Do First)
1. ✅ **Data versioning & cache invalidation** - Fixes "clear stored data" requirement
2. ✅ **Schema version checking on load** - Prevents stale data issues
3. ✅ **Graceful storage failure handling** - App works even without storage

### Phase 2: User Experience (Next)
4. ✅ **Diagnostics panel** - Users can see what's wrong
5. ✅ **Enhanced progress indicators** - Better feedback per PLAN.md §4
6. ✅ **Privacy notice** - Required per PLAN.md §4
7. ✅ **Cancellation support** - Better UX for long operations

### Phase 3: Professional Polish
8. ✅ **Performance monitoring** - Track metrics
9. ✅ **Memory leak prevention** - Proper disposal
10. ✅ **Error boundaries** - Graceful error handling
11. ✅ **In-app help** - User documentation
12. ✅ **Storage quota management** - Handle low storage

## Testing Checklist

- [ ] App works with fresh storage (first run)
- [ ] App works with existing storage (resume)
- [ ] App handles schema version mismatches gracefully
- [ ] App degrades gracefully when storage unavailable
- [ ] Cancellation works during all phases
- [ ] Progress indicators show accurate information
- [ ] Diagnostics panel shows correct information
- [ ] Performance metrics are tracked
- [ ] Memory leaks are prevented (test with DevTools)
- [ ] Error messages are user-friendly

## Notes

- Most of these align with existing PLAN.md specifications
- Best practices come from BEST_PRACTICES_BROWSER.md and BEST_PRACTICES_VISUALIZATION.md
- The "clear stored data" issue suggests we need better cache invalidation and version checking
- All improvements maintain the "client-side only" constraint

