import { Parser } from 'web-tree-sitter';

/**
 * Main TreeSitter module for HELIOS
 * Loads web-tree-sitter and manages grammar instances
 * Following PLAN.md section 3.2 specifications
 */

// Grammar WASM URLs (served locally via same origin)
const GRAMMAR_URLS = {
  javascript: '/grammars/tree-sitter-javascript.wasm',
  typescript: '/grammars/tree-sitter-typescript.wasm',
  python: '/grammars/tree-sitter-python.wasm'
};

// Language detection by file extension
const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python'
};

class TreeSitterManager {
  constructor() {
    this.Parser = null;
    this.languages = new Map();
    this.initialized = false;
  }

  /**
   * Initialize the TreeSitter (load web-tree-sitter WASM)
   * Should be called once before parsing
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      if (!this.Parser) {
        this.Parser = Parser;
      }

      await this.Parser.init();
      this.initialized = true;
      console.log('[TreeSitter] Initialized web-tree-sitter');
    } catch (err) {
      console.error('[TreeSitter] Failed to initialize:', err);
      throw new Error(`TreeSitter initialization failed: ${err.message}`);
    }
  }

  /**
   * Detect language from file path
   * @param {string} filePath - Path to the file
   * @returns {string|null} - Language name or null if unknown
   */
  detectLanguage(filePath) {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return LANGUAGE_MAP[ext] || null;
  }

  /**
   * Load a grammar WASM file (lazy loading)
   * @param {string} language - Language name (javascript, typescript, python)
   * @returns {Promise<Language>} - Tree-sitter Language object
   */
  async loadLanguage(language) {
    if (this.languages.has(language)) {
      return this.languages.get(language);
    }

    if (!this.initialized) {
      await this.initialize();
    }

    const url = GRAMMAR_URLS[language];
    if (!url) {
      throw new Error(`Unknown language: ${language}`);
    }

    try {
      console.log(`[TreeSitter] Loading ${language} grammar from ${url}`);
      const Language = await this.Parser.Language.load(url);
      
      this.languages.set(language, Language);
      console.log(`[TreeSitter] Loaded ${language} grammar`);
      
      return Language;
    } catch (err) {
      console.error(`[TreeSitter] Failed to load ${language} grammar:`, err);
      throw new Error(`Grammar load failed for ${language}: ${err.message}`);
    }
  }

  /**
   * Parse source code and return AST
   * @param {string} source - Source code to parse
   * @param {string} language - Language name (auto-detected if not provided)
   * @param {string} filePath - File path for language detection
   * @returns {Promise<Tree>} - Tree-sitter Tree object
   */
  async parse(source, language = null, filePath = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Auto-detect language if not provided
    if (!language && filePath) {
      language = this.detectLanguage(filePath);
    }

    if (!language) {
      throw new Error('Language not specified and could not be detected');
    }

    // Load language grammar if needed
    const Language = await this.loadLanguage(language);
    const parser = new this.Parser();
    parser.setLanguage(Language);

    // Parse source code
    const tree = parser.parse(source);
    return tree;
  }

  /**
   * Clean up resources (delete trees, clear caches)
   */
   cleanup() {
    // Delete any cached trees
    this.languages.clear();
    this.Parser = null;
    this.initialized = false;
  }
}

// Export singleton instance
export const parserManager = new TreeSitterManager();

