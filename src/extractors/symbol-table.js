/**
 * Symbol table management for per-file name resolution
 * Following PLAN.md section 3.2: "Keep per-file symbol tables: { localName → fullyQualifiedName }"
 */

/**
 * Per-file symbol table
 * Maps local names to fully qualified names and tracks exports/imports
 */
export class SymbolTable {
  constructor(filePath) {
    this.filePath = filePath;
    // Map: localName → fullyQualifiedName
    this.symbols = new Map();
    // Exported symbols: name → export info
    this.exports = new Map();
    // Imported symbols: localName → { from: modulePath, originalName }
    this.imports = new Map();
    // Functions defined in this file (used for auto-export + metadata)
    this.functions = new Map();
    // Optional module identifier associated with the file
    this.moduleId = null;
  }

  /**
   * Add a local symbol
   * @param {string} localName - Local name in the file
   * @param {string} fullyQualifiedName - Fully qualified name (e.g., "module.function")
   */
  addSymbol(localName, fullyQualifiedName) {
    this.symbols.set(localName, fullyQualifiedName);
  }

  /**
   * Register a function definition (for lookup + optional auto-export)
   * @param {Object} func - Function metadata from extractor
   * @param {Object} options - { autoExport?: boolean }
   */
  registerFunction(func, options = {}) {
    if (!func || !func.name) {
      return;
    }

    const localName = func.name;
    const fqName = func.fqName || func.name;

    this.functions.set(localName, {
      ...func,
      fqName
    });

    this.addSymbol(localName, fqName);

    if (options.autoExport) {
      this.addExport(localName, {
        isDefault: false,
        kind: 'function',
        symbolId: func.id || null
      });
    }
  }

  /**
   * Get fully qualified name for a local name
   * @param {string} localName - Local name to resolve
   * @returns {string|null} - Fully qualified name or null if not found
   */
  resolve(localName) {
    return this.symbols.get(localName) || null;
  }

  /**
   * Add an export
   * @param {string} name - Exported name
   * @param {Object} info - Export information (type, isDefault, etc.)
   */
  addExport(name, info = {}) {
    this.exports.set(name, {
      name,
      filePath: this.filePath,
      ...info
    });
  }

  /**
   * Add an import
   * Supports legacy signature (localName, from, originalName)
   * or a richer metadata object per PLAN §3.3.
   */
  addImport(localName, fromOrInfo, originalName = null) {
    if (!localName) {
      return;
    }

    let info;
    if (typeof fromOrInfo === 'object' && fromOrInfo !== null) {
      info = {
        from: fromOrInfo.from || '',
        originalName: fromOrInfo.originalName || localName,
        isDefault: !!fromOrInfo.isDefault,
        moduleId: fromOrInfo.moduleId || null,
        resolvedFilePath: fromOrInfo.resolvedFilePath || null,
        localName
      };
    } else {
      info = {
        from: fromOrInfo,
        originalName: originalName || localName,
        isDefault: !originalName,
        moduleId: null,
        resolvedFilePath: null,
        localName
      };
    }

    this.imports.set(localName, info);

    const namespace = info.moduleId || info.from || '';
    const resolvedName = info.originalName || localName;

    if (namespace) {
      this.addSymbol(localName, `${namespace}.${resolvedName}`);
    }
  }

  /**
   * Get all exports
   * @returns {Array} - Array of export objects
   */
  getExports() {
    return Array.from(this.exports.values());
  }

  /**
   * Get all imports
   * @returns {Array} - Array of import objects
   */
  getImports() {
    return Array.from(this.imports.values());
  }

  /**
   * Check if a name is exported
   * @param {string} name - Name to check
   * @returns {boolean}
   */
  isExported(name) {
    return this.exports.has(name);
  }

  /**
   * Check if a name is imported
   * @param {string} name - Name to check
   * @returns {boolean}
   */
  isImported(name) {
    return this.imports.has(name);
  }

  /**
   * Associate table with a module identifier
   */
  setModuleId(moduleId) {
    this.moduleId = moduleId;
  }

  /**
   * Retrieve associated module id
   */
  getModuleId() {
    return this.moduleId;
  }

  /**
   * Retrieve export metadata (if present)
   */
  getExport(name) {
    return this.exports.get(name) || null;
  }

  /**
   * Retrieve import metadata
   */
  getImportInfo(localName) {
    return this.imports.get(localName) || null;
  }
}

/**
 * Project-wide symbol table manager
 * Maintains symbol tables for all files and supports cross-file resolution
 */
export class SymbolTableManager {
  constructor() {
    // Map: filePath → SymbolTable
    this.tables = new Map();
    // Map: moduleId → Set<filePath>
    this.moduleToFiles = new Map();
  }

  /**
   * Get or create symbol table for a file
   * @param {string} filePath - Path to the file
   * @returns {SymbolTable} - Symbol table for the file
   */
  getTable(filePath) {
    if (!this.tables.has(filePath)) {
      this.tables.set(filePath, new SymbolTable(filePath));
    }
    return this.tables.get(filePath);
  }

  /**
   * Resolve a symbol across files
   * First checks local file, then checks imports
   * @param {string} filePath - File where the symbol is referenced
   * @param {string} localName - Local name to resolve
   * @returns {string|null} - Fully qualified name or null if not found
   */
  resolve(filePath, localName) {
    const table = this.tables.get(filePath);
    if (!table) {
      return null;
    }

    // Try local resolution first
    const local = table.resolve(localName);
    if (local) {
      return local;
    }

    // Check if it's an import
    const importInfo = table.imports.get(localName);
    if (importInfo) {
      const moduleId = importInfo.moduleId || importInfo.from;
      const symbol = importInfo.originalName || localName;

      if (moduleId) {
        const resolvedExport = this.findExportedSymbol(moduleId, symbol);
        if (resolvedExport) {
          return resolvedExport.fullyQualifiedName || `${moduleId}.${symbol}`;
        }
      }

      if (importInfo.from) {
        return `${importInfo.from}.${symbol}`;
      }
    }

    return null;
  }

  /**
   * Register module → filePath relationship
   */
  registerModule(filePath, moduleId) {
    if (!filePath || !moduleId) {
      return;
    }

    if (!this.moduleToFiles.has(moduleId)) {
      this.moduleToFiles.set(moduleId, new Set());
    }
    this.moduleToFiles.get(moduleId).add(filePath);
  }

  /**
   * Get file paths associated with a module id
   */
  getModuleFilePaths(moduleId) {
    if (!moduleId || !this.moduleToFiles.has(moduleId)) {
      return [];
    }
    return Array.from(this.moduleToFiles.get(moduleId));
  }

  /**
   * Attempt to locate an exported symbol by module id + name
   */
  findExportedSymbol(moduleId, symbolName) {
    if (!moduleId || !symbolName) {
      return null;
    }

    const files = this.getModuleFilePaths(moduleId);
    for (const filePath of files) {
      const table = this.tables.get(filePath);
      if (!table) continue;
      const exportInfo = table.getExport(symbolName);
      if (exportInfo) {
        return {
          ...exportInfo,
          moduleId,
          fullyQualifiedName: `${moduleId}.${symbolName}`
        };
      }
    }

    return null;
  }

  /**
   * Get all symbol tables
   * @returns {Map} - Map of filePath → SymbolTable
   */
  getAllTables() {
    return this.tables;
  }

  /**
   * Clear all symbol tables
   */
  clear() {
    this.tables.clear();
    this.moduleToFiles.clear();
  }
}

