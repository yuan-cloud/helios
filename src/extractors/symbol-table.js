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
   * @param {string} localName - Local name (may be aliased)
   * @param {string} from - Module path being imported from
   * @param {string} originalName - Original name in the source module
   */
  addImport(localName, from, originalName = null) {
    this.imports.set(localName, {
      from,
      originalName: originalName || localName,
      localName
    });
    
    // If importing a default export, map it
    if (!originalName) {
      // Default import - use module path as FQN
      this.addSymbol(localName, `${from}.${localName}`);
    } else {
      // Named import - use original name from source
      this.addSymbol(localName, `${from}.${originalName}`);
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
}

/**
 * Project-wide symbol table manager
 * Maintains symbol tables for all files and supports cross-file resolution
 */
export class SymbolTableManager {
  constructor() {
    // Map: filePath → SymbolTable
    this.tables = new Map();
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
      // For now, return the import path
      // Full cross-file resolution would require resolving the imported module
      return `${importInfo.from}.${importInfo.originalName}`;
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
  }
}

