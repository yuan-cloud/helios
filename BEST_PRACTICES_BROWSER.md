# BEST_PRACTICES_BROWSER.md - Browser/WASM Development Guide

## Browser WASM Development

### Loading WASM Modules

**Critical:** Always load WASM from the same origin or use proper CORS headers.

```javascript
// ✅ CORRECT: Load with proper error handling
const wasmModule = await WebAssembly.instantiateStreaming(
  fetch('module.wasm'),
  imports
).catch(err => {
  console.error('WASM load failed:', err);
  throw err;
});

// ❌ WRONG: No error handling, assumes success
const wasmModule = await WebAssembly.instantiateStreaming(fetch('module.wasm'));
```

**Gotchas:**
- WASM modules are compiled once but can be instantiated multiple times
- Memory limits: 4GB max (2GB on 32-bit), but browsers may enforce lower limits
- Always check `WebAssembly.validate()` before attempting to instantiate
- WASM threads require SharedArrayBuffer (needs COOP/COEP)

### Memory Management

```javascript
// ✅ CORRECT: Explicit memory management
const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
const view = new Uint8Array(memory.buffer);

// ❌ WRONG: Leaking memory by holding references
const data = new Uint8Array(wasmModule.exports.memory.buffer);
// This reference prevents GC, causing memory leaks
```

**Critical patterns:**
- Release references to WASM memory views when done
- Use `memory.grow()` carefully - it invalidates all existing views
- Monitor memory usage: `performance.memory.usedJSHeapSize` (Chrome only)

---

## ES Modules and Import Maps

### Import Maps Setup

```html
<!-- ✅ CORRECT: Import map before any module scripts -->
<script type="importmap">
{
  "imports": {
    "tree-sitter": "https://cdn.jsdelivr.net/npm/web-tree-sitter@latest/dist/index.js"
  }
}
</script>
<script type="module">
  import Parser from 'tree-sitter';
</script>
```

**Gotchas:**
- Import maps must come BEFORE any module scripts
- Use `es-module-shims` polyfill for older browsers
- CDN URLs should pin versions in production (use specific version, not `@latest`)

### Dynamic Imports

```javascript
// ✅ CORRECT: Error handling and fallback
async function loadGrammar(lang) {
  try {
    const grammar = await import(`./grammars/${lang}.js`);
    return grammar.default;
  } catch (err) {
    console.error(`Failed to load ${lang} grammar:`, err);
    return null;
  }
}

// ❌ WRONG: No error handling
const grammar = await import(`./grammars/${lang}.js`);
```

**Critical patterns:**
- Always wrap dynamic imports in try/catch
- Use static analysis-friendly patterns when possible
- Consider bundling for production if dynamic imports cause issues

---

## Web Workers and Performance

### Worker Creation

```javascript
// ✅ CORRECT: Proper worker lifecycle
class WorkerPool {
  constructor(size, workerScript) {
    this.workers = [];
    this.queue = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScript, { type: 'module' });
      worker.onmessage = this.handleMessage.bind(this);
      worker.onerror = this.handleError.bind(this);
      this.workers.push({ worker, busy: false });
    }
  }
  
  terminate() {
    this.workers.forEach(({ worker }) => worker.terminate());
  }
}
```

**Gotchas:**
- Workers must be terminated explicitly or they persist
- SharedArrayBuffer requires COOP/COEP headers
- Worker.postMessage() copies data by default (use Transferable objects for large data)
- Module workers need proper CORS headers

### Transferable Objects

```javascript
// ✅ CORRECT: Transfer ownership to avoid copy
const buffer = new ArrayBuffer(1024 * 1024);
worker.postMessage(buffer, [buffer]); // Transfers ownership

// ❌ WRONG: Copies entire buffer (slow!)
worker.postMessage(buffer);
```

**Performance tips:**
- Use `ImageBitmap`, `ArrayBuffer`, `MessagePort` as transferable
- Transfer ownership for data > 1MB
- Use SharedArrayBuffer for read-only shared data (requires COOP/COEP)

---

## File System Access API

### Directory Picker

```javascript
// ✅ CORRECT: Feature detection and fallback
async function selectDirectory() {
  if (!window.showDirectoryPicker) {
    // Fallback to webkitdirectory input
    return fallbackDirectoryPicker();
  }
  
  try {
    const handle = await window.showDirectoryPicker();
    return handle;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Directory picker error:', err);
    }
    return null;
  }
}
```

**Gotchas:**
- Only available in Chromium-based browsers (Chrome, Edge)
- Requires user gesture (click event)
- Permission persists per origin until user revokes
- Always handle `AbortError` (user cancelled)

### Reading Files Recursively

```javascript
// ✅ CORRECT: Async iteration with error handling
async function* walkDirectory(dirHandle, path = '') {
  for await (const entry of dirHandle.values()) {
    const fullPath = path ? `${path}/${entry.name}` : entry.name;
    
    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        yield { path: fullPath, file };
      } catch (err) {
        console.warn(`Failed to read ${fullPath}:`, err);
      }
    } else if (entry.kind === 'directory') {
      yield* walkDirectory(entry, fullPath);
    }
  }
}
```

**Critical patterns:**
- Use async generators for large directory trees
- Handle permission errors gracefully
- Skip system directories (`.git`, `node_modules`) early
- Process files in batches to avoid blocking UI

---

## Cross-Origin Isolation (COOP/COEP)

### Service Worker Setup

```javascript
// ✅ CORRECT: coi-serviceworker.js pattern
// Must be first script in <head>
if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/coi-serviceworker.js', {
      scope: '/',
      updateViaCache: 'none'
    }).then(() => {
      // Reload to activate COOP/COEP
      if (!sessionStorage.getItem('coi-activated')) {
        sessionStorage.setItem('coi-activated', 'true');
        window.location.reload();
      }
    });
  }
}
```

**Gotchas:**
- COOP/COEP headers block cross-origin resources (images, scripts, etc.)
- First load requires reload (document this to users)
- SharedArrayBuffer only works with COOP/COEP
- Service worker must be registered before any other scripts

### Checking Isolation

```javascript
// ✅ CORRECT: Verify cross-origin isolation
function isIsolated() {
  return typeof SharedArrayBuffer !== 'undefined' &&
         crossOriginIsolated === true;
}

if (!isIsolated()) {
  console.warn('Cross-origin isolation not enabled. Some features disabled.');
}
```

---

## IndexedDB and OPFS

### IndexedDB Patterns

```javascript
// ✅ CORRECT: Proper transaction handling
async function storeData(dbName, storeName, data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      
      const putRequest = store.put(data);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
      
      tx.oncomplete = () => db.close();
    };
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' });
      }
    };
  });
}
```

**Gotchas:**
- Transactions auto-commit when event loop is idle
- Always handle `onupgradeneeded` for schema changes
- Close DB connections explicitly
- Use version numbers for migrations

### OPFS (Origin Private File System)

```javascript
// ✅ CORRECT: OPFS async file access
async function writeToOPFS(filename, data) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort();
    throw err;
  }
}

// ✅ CORRECT: Sync access handle (for SQLite-WASM)
async function getSyncAccessHandle(filename) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  return await fileHandle.createSyncAccessHandle();
}
```

**Critical patterns:**
- OPFS is origin-private (not accessible to other origins)
- Sync access handles must be used in workers
- Always close/abort handles to prevent leaks
- OPFS persists across sessions (unlike memory)

---

## Error Handling in Browser Contexts

### Async Error Handling

```javascript
// ✅ CORRECT: Comprehensive error handling
async function processFile(file) {
  try {
    const text = await file.text();
    return parseFile(text);
  } catch (err) {
    if (err instanceof DOMException) {
      // Handle file read errors
      console.error('File read failed:', err.message);
    } else if (err instanceof SyntaxError) {
      // Handle parse errors
      console.error('Parse failed:', err.message);
    } else {
      // Unknown error
      console.error('Unexpected error:', err);
      throw err;
    }
    return null;
  }
}
```

### Worker Error Handling

```javascript
// ✅ CORRECT: Worker error propagation
worker.onerror = (event) => {
  console.error('Worker error:', event.message, event.filename, event.lineno);
  // Don't let worker errors crash main thread
};

worker.onmessageerror = (event) => {
  console.error('Message serialization error:', event);
};
```

### Unhandled Promise Rejections

```javascript
// ✅ CORRECT: Global error handlers
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault(); // Prevent console error
  // Log to error tracking service
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // Don't throw - just log
});
```

**Critical patterns:**
- Always handle errors in async operations
- Use specific error types when possible
- Don't let worker errors crash main thread
- Log errors but don't expose sensitive data
- Use error boundaries in UI components

---

## Performance Monitoring

```javascript
// ✅ CORRECT: Performance API usage
function measureOperation(name, fn) {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  console.log(`${name} took ${end - start}ms`);
  return result;
}

// For async operations
async function measureAsync(name, fn) {
  performance.mark(`${name}-start`);
  const result = await fn();
  performance.mark(`${name}-end`);
  performance.measure(name, `${name}-start`, `${name}-end`);
  return result;
}
```

**Gotchas:**
- `performance.now()` is high-resolution but not wall-clock time
- Use `requestIdleCallback()` for non-critical work
- Monitor memory: `performance.memory` (Chrome only)
- Use PerformanceObserver for long tasks detection

---

## Critical Checklist

- [ ] WASM modules loaded with error handling
- [ ] Workers properly terminated
- [ ] Transferable objects used for large data
- [ ] COOP/COEP enabled for SharedArrayBuffer
- [ ] File System API with fallbacks
- [ ] IndexedDB transactions handled correctly
- [ ] OPFS handles closed/aborted
- [ ] Global error handlers registered
- [ ] Performance monitoring in place
- [ ] Memory leaks checked (DevTools)

