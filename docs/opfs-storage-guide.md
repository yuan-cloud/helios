# OPFS Storage Guide - Technical Deep Dive

**For Advanced Users**

## What is "Saved Locally"?

HELIOS uses **OPFS (Origin Private File System)** - a browser API that gives web apps a real file system on your computer, similar to a native app.

### Key Concepts

1. **Origin Private**: Each website gets its own isolated file system
   - `http://localhost:8000` has its own OPFS
   - `https://example.com` has a different OPFS
   - They can't access each other's files

2. **Persistent**: Files survive browser restarts
   - Unlike `localStorage` which can be cleared
   - Unlike `sessionStorage` which clears on tab close
   - OPFS files persist until explicitly deleted

3. **Real File System**: Not just key-value storage
   - Actual files and directories
   - Can store binary data (SQLite databases, images, etc.)
   - Can be accessed programmatically

## Where Are Files Actually Stored?

### Browser-Specific Locations

**Chrome/Edge (Chromium):**
```
Windows: C:\Users\<username>\AppData\Local\Google\Chrome\User Data\Default\File System\
macOS: ~/Library/Application Support/Google/Chrome/Default/File System/
Linux: ~/.config/google-chrome/Default/File System/
```

**Firefox:**
```
Windows: C:\Users\<username>\AppData\Roaming\Mozilla\Firefox\Profiles\<profile>\storage\default\
macOS: ~/Library/Application Support/Firefox/Profiles/<profile>/storage/default/
Linux: ~/.mozilla/firefox/<profile>/storage/default/
```

**Safari:**
```
macOS: ~/Library/WebKit/<domain>/
```

### Finding Your HELIOS Database

The database file is named `helios.sqlite3` and is stored in:
```
<Browser OPFS Root>/<origin-hash>/opfs/helios.sqlite3
```

The `origin-hash` is a hash of your origin (e.g., `http://localhost:8000`).

### How to Find It Programmatically

Open browser DevTools Console and run:

```javascript
// Get OPFS root directory
const root = await navigator.storage.getDirectory();

// List files (this is async, so you need to iterate)
for await (const entry of root.values()) {
  console.log(entry.name, entry.kind);
  
  if (entry.kind === 'directory') {
    // Explore subdirectories
    for await (const subEntry of entry.values()) {
      console.log('  ', subEntry.name);
    }
  }
}
```

## Database Structure

HELIOS uses SQLite with this schema:

### Main Tables

1. **`kv`** - Key-value store for metadata
   - `key`: TEXT PRIMARY KEY
   - `value`: TEXT (JSON strings)
   - Stores: resume snapshots, analysis snapshots, retention config

2. **`files`** - Tracked source files
   - `file_id`, `path`, `lang`, `sha1`, `bytes`

3. **`functions`** - Extracted functions
   - `fn_id`, `file_id`, `name`, `fqName`, `startLine`, `endLine`, etc.

4. **`calls`** - Function call relationships
   - `call_id`, `caller_fn_id`, `callee_fn_id`, `start`, `end`, etc.

5. **`layout_snapshots`** - Saved graph layouts
   - `snapshot_id`, `graph_key`, `graph_hash`, `layout_json`, `created_at`, `updated_at`

6. **`embeddings`** - Function embeddings (vectors)
   - `embedding_id`, `fn_id`, `vector_json`, `model_id`, `dimension`

### Key-Value Store Contents

Important keys in the `kv` table:

- `"resume::<session-id>"` - Resume session data
- `"analysis.snapshot.v1"` - Latest analysis snapshot
- `"retention.maxAgeHours"` - Retention policy config
- `"schema.version"` - Database schema version
- `"app.version"` - Application version

## What Advanced Users Can Do

### 1. Access the Database Directly

**Using Browser DevTools:**

```javascript
// In browser console
const root = await navigator.storage.getDirectory();
const opfsDir = await root.getDirectoryHandle('opfs');
const dbFile = await opfsDir.getFileHandle('helios.sqlite3');
const file = await dbFile.getFile();
const arrayBuffer = await file.arrayBuffer();

// Now you have the SQLite database as ArrayBuffer
// You can save it, inspect it, etc.
```

**Using SQLite Tools:**

1. Export the database (see method below)
2. Open with `sqlite3` CLI, DB Browser for SQLite, or any SQLite tool
3. Query directly:

```sql
-- See all saved layouts
SELECT graph_key, created_at, updated_at 
FROM layout_snapshots 
ORDER BY updated_at DESC;

-- See resume sessions
SELECT key, value 
FROM kv 
WHERE key LIKE 'resume::%';

-- See analysis snapshot
SELECT value 
FROM kv 
WHERE key = 'analysis.snapshot.v1';
```

### 2. Backup Your Data

**Method 1: Export via Browser Console**

```javascript
// Get database file
const root = await navigator.storage.getDirectory();
const opfsDir = await root.getDirectoryHandle('opfs');
const dbFile = await opfsDir.getFileHandle('helios.sqlite3');
const file = await dbFile.getFile();

// Create download link
const blob = await file.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'helios-backup.sqlite3';
a.click();
URL.revokeObjectURL(url);
```

**Method 2: Copy from File System**

Navigate to the browser's OPFS directory (see paths above) and copy `helios.sqlite3`.

### 3. Restore from Backup

```javascript
// In browser console
const input = document.createElement('input');
input.type = 'file';
input.accept = '.sqlite3';
input.onchange = async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  
  // Get OPFS directory
  const root = await navigator.storage.getDirectory();
  const opfsDir = await root.getDirectoryHandle('opfs', { create: true });
  
  // Write database file
  const dbFile = await opfsDir.getFileHandle('helios.sqlite3', { create: true });
  const writable = await dbFile.createWritable();
  await writable.write(arrayBuffer);
  await writable.close();
  
  console.log('Database restored! Refresh the page.');
};
input.click();
```

### 4. Inspect Database Contents

**Using SQLite CLI:**

```bash
# After exporting database
sqlite3 helios.sqlite3

# See all tables
.tables

# See schema
.schema

# Query layouts
SELECT graph_key, json_extract(layout_json, '$[0]') as first_node 
FROM layout_snapshots 
LIMIT 1;

# See resume data
SELECT key, json_extract(value, '$.savedAt') as saved_at
FROM kv 
WHERE key LIKE 'resume::%';
```

### 5. Manual Data Manipulation

**Clear Specific Data:**

```sql
-- Delete all layouts
DELETE FROM layout_snapshots;

-- Delete all resume sessions
DELETE FROM kv WHERE key LIKE 'resume::%';

-- Delete analysis snapshot
DELETE FROM kv WHERE key = 'analysis.snapshot.v1';

-- Delete all embeddings
DELETE FROM embeddings;
```

**Modify Retention Policy:**

```sql
-- Set retention to 48 hours
UPDATE kv SET value = '48' WHERE key = 'retention.maxAgeHours';

-- Or insert if doesn't exist
INSERT OR REPLACE INTO kv (key, value) VALUES ('retention.maxAgeHours', '48');
```

### 6. Export Specific Data

**Export Layouts as JSON:**

```sql
-- Get all layouts
SELECT graph_key, layout_json, created_at 
FROM layout_snapshots;

-- Export to JSON file (using sqlite3 CLI)
.mode json
.output layouts.json
SELECT graph_key, layout_json, created_at FROM layout_snapshots;
```

**Export Functions:**

```sql
-- Export all functions with metadata
SELECT 
  f.name,
  f.fqName,
  f.filePath,
  f.startLine,
  f.endLine,
  f.loc
FROM functions f
ORDER BY f.filePath, f.startLine;
```

### 7. Debug Storage Issues

**Check Storage Quota:**

```javascript
// In browser console
const estimate = await navigator.storage.estimate();
console.log('Used:', estimate.usage);
console.log('Quota:', estimate.quota);
console.log('Usage %:', (estimate.usage / estimate.quota * 100).toFixed(2));
```

**List All OPFS Files:**

```javascript
async function listOPFSFiles(dirHandle, path = '') {
  for await (const entry of dirHandle.values()) {
    const fullPath = path + '/' + entry.name;
    if (entry.kind === 'directory') {
      console.log('📁', fullPath);
      const subDir = await dirHandle.getDirectoryHandle(entry.name);
      await listOPFSFiles(subDir, fullPath);
    } else {
      console.log('📄', fullPath);
      const file = await entry.getFile();
      console.log('   Size:', file.size, 'bytes');
    }
  }
}

const root = await navigator.storage.getDirectory();
await listOPFSFiles(root);
```

**Check Database Integrity:**

```sql
-- In SQLite
PRAGMA integrity_check;

-- Check foreign key constraints
PRAGMA foreign_key_check;
```

### 8. Performance Optimization

**Vacuum Database (reclaim space):**

```sql
VACUUM;
```

**Analyze Tables (update statistics):**

```sql
ANALYZE;
```

**Check Database Size:**

```sql
-- Get database page count and size
PRAGMA page_count;
PRAGMA page_size;
-- Total size = page_count * page_size
```

## Security & Privacy

### What This Means

1. **Isolated**: Each origin (website) has its own OPFS
   - `localhost:8000` can't access `example.com`'s OPFS
   - Even different ports are separate origins

2. **Local Only**: Files never leave your computer
   - No network requests
   - No server uploads
   - Completely offline-capable

3. **Browser Managed**: Browser controls access
   - Can't access OPFS from regular file system
   - Requires browser APIs
   - Protected by same-origin policy

### Clearing Data

**Via Browser:**
- Chrome: Settings → Privacy → Clear browsing data → Cached images and files
- Firefox: Settings → Privacy → Clear Data → Cached Web Content
- Safari: Develop → Empty Caches

**Via HELIOS:**
- Click "Reset App" button (with confirmation)

**Via Code:**
```javascript
// Clear all OPFS data for this origin
const root = await navigator.storage.getDirectory();
for await (const entry of root.values()) {
  if (entry.kind === 'directory') {
    await root.removeEntry(entry.name, { recursive: true });
  } else {
    await root.removeEntry(entry.name);
  }
}
```

## Advanced Use Cases

### 1. Migrate Between Browsers

1. Export database from Browser A (using method above)
2. Import into Browser B (using restore method)
3. All your layouts and sessions transfer

### 2. Sync Across Devices

1. Export database
2. Copy to cloud storage (Dropbox, iCloud, etc.)
3. Import on other device
4. (Manual process - no automatic sync)

### 3. Version Control Your Layouts

```sql
-- Export layouts with version info
SELECT 
  graph_key,
  graph_hash,
  layout_json,
  created_at,
  updated_at
FROM layout_snapshots
ORDER BY updated_at DESC;
```

Save this as JSON and commit to git for version control.

### 4. Batch Operations

```sql
-- Delete layouts older than 7 days
DELETE FROM layout_snapshots 
WHERE updated_at < datetime('now', '-7 days');

-- Update all layout timestamps
UPDATE layout_snapshots 
SET updated_at = datetime('now');
```

### 5. Data Analysis

```sql
-- Analyze storage usage
SELECT 
  'layouts' as type,
  COUNT(*) as count,
  SUM(LENGTH(layout_json)) as total_bytes
FROM layout_snapshots
UNION ALL
SELECT 
  'resume_sessions',
  COUNT(*),
  SUM(LENGTH(value))
FROM kv
WHERE key LIKE 'resume::%';
```

## Troubleshooting

### Database Corrupted

```sql
-- Check integrity
PRAGMA integrity_check;

-- If corrupted, try to recover
.dump > backup.sql
-- Then restore from backup
```

### Storage Full

```javascript
// Check quota
const estimate = await navigator.storage.estimate();
if (estimate.usage / estimate.quota > 0.9) {
  console.warn('Storage nearly full!');
  // Clear old data or increase quota
}
```

### Can't Access OPFS

1. Check COOP/COEP headers are set (see `coi-serviceworker.js`)
2. Check browser supports OPFS (Chrome 86+, Firefox 111+, Safari 15.2+)
3. Check `navigator.storage.getDirectory()` is available

## Summary

**"Saved locally" means:**
- Files stored in browser's OPFS directory on your hard drive
- Accessible via browser APIs, not regular file system
- Persists across browser sessions
- Isolated per origin (website)
- Can be backed up, exported, and restored
- Full SQLite database with all your data

**Advanced users can:**
- Access database directly via browser APIs
- Export/import for backup/restore
- Query and modify data with SQL
- Debug storage issues
- Optimize performance
- Migrate between browsers/devices

