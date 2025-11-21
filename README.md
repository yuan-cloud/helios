# HELIOS 🌌

> **See the gravity of your code** — Interactive 3D visualization of codebase structure using AST parsing, semantic embeddings, and graph analysis.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://yuan-cloud.github.io/helios/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

HELIOS is a **client-side only** web application that visualizes codebases as interactive 3D force-directed graphs. It runs entirely in your browser—no server, no data uploads, complete privacy.

## ✨ Features

### 🎯 Core Capabilities

- **🌳 AST Parsing**: Language-aware parsing using Tree-sitter (WASM) for JavaScript/TypeScript and Python
- **🔗 Call Graph Extraction**: Static analysis to identify function calls and dependencies
- **🧠 Semantic Similarity**: AI-powered embeddings (Transformers.js) to find semantically related functions
- **📊 Graph Analysis**: Centrality metrics, community detection (Louvain), and network analysis
- **💾 Persistent Storage**: SQLite-WASM with OPFS for local data persistence
- **🎨 3D Visualization**: Interactive force-directed graph with Three.js and 3d-force-graph
- **⚡ WebGPU Acceleration**: Automatic WebGPU detection for faster embeddings (with WASM fallback)

### 🚀 Technical Highlights

- **Zero Backend**: Everything runs client-side—perfect for privacy-sensitive codebases
- **WebAssembly**: Tree-sitter, SQLite, and ONNX Runtime compiled to WASM
- **Cross-Origin Isolation**: Service worker enables SharedArrayBuffer and WASM threads
- **Modern Web APIs**: File System Access API, OPFS, WebGPU, Web Workers
- **No Build Step**: Pure ES modules with import maps—deploy as-is

## 🎬 Quick Start

### Try the Demo

1. Visit the [live demo](https://yuan-cloud.github.io/helios/)
2. Click **"Load Demo"** to see a sample codebase visualization
3. Or **"Select Repository"** to analyze your own code

### Local Development

```bash
# Clone the repository
git clone https://github.com/yuan-cloud/helios.git
cd helios

# Install dependencies (optional - for local vendor files)
npm install

# Serve locally
python3 -m http.server 8000
# Visit http://localhost:8000
```

**Note**: For full functionality (OPFS, WebGPU), serve over HTTPS or use `localhost`.

## 📖 How It Works

1. **Select Repository**: Choose a local folder using the File System Access API
2. **Parse**: Tree-sitter extracts functions, imports, and call sites from your code
3. **Embed**: Transformers.js generates semantic embeddings for each function
4. **Analyze**: Graphology computes network metrics (centrality, communities)
5. **Visualize**: Interactive 3D graph shows code structure and relationships

### Architecture

```
┌─────────────────┐
│   User Selects  │
│   Repository    │
└────────┬────────┘
         │
    ┌────▼─────┐
    │  Parser  │ → Functions, Calls, Imports
    │ (WASM)   │
    └────┬─────┘
         │
    ┌────▼────────┐
    │ Embeddings  │ → Semantic Vectors
    │ (WebGPU)    │
    └────┬────────┘
         │
    ┌────▼─────┐
    │  Graph   │ → Centrality, Communities
    │ Analysis │
    └────┬─────┘
         │
    ┌────▼──────────┐
    │ Visualization │ → 3D Interactive Graph
    │  (Three.js)   │
    └───────────────┘
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| **Parsing** | web-tree-sitter (WASM) |
| **Embeddings** | Transformers.js + ONNX Runtime Web |
| **Graph Analysis** | Graphology + Louvain communities |
| **Storage** | SQLite-WASM + OPFS |
| **Visualization** | Three.js + 3d-force-graph |
| **UI Framework** | Alpine.js + Tailwind CSS |
| **Hosting** | Static (Cloudflare Pages / GitHub Pages) |

## 📚 Documentation

- **[PLAN.md](PLAN.md)** - Complete technical specification
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Deployment guide
- **[docs/storage.md](docs/storage.md)** - Storage architecture
- **[docs/parser.md](docs/parser.md)** - Parser implementation details
- **[docs/ux-analysis-new-user.md](docs/ux-analysis-new-user.md)** - UX design decisions

## 🎯 Use Cases

- **Code Exploration**: Understand large codebases through visual navigation
- **Refactoring Planning**: Identify tightly coupled modules and dependencies
- **Onboarding**: Help new team members understand codebase structure
- **Architecture Review**: Visualize system design and identify patterns
- **Research**: Analyze code organization and semantic relationships

## 🔒 Privacy & Security

- ✅ **100% Client-Side**: No code is uploaded to any server
- ✅ **Local Storage**: All data stored in browser (OPFS)
- ✅ **No Analytics**: Zero tracking or telemetry
- ✅ **Open Source**: Full source code available for audit

## 🌟 Key Differentiators

1. **Privacy-First**: Unlike cloud-based tools, HELIOS never sends your code anywhere
2. **No Build Required**: Pure ES modules—works immediately after deployment
3. **Modern Web Standards**: Leverages latest browser APIs (WebGPU, OPFS, SharedArrayBuffer)
4. **Extensible**: Easy to add new languages via Tree-sitter grammars
5. **Performance**: WebGPU acceleration for embeddings, WASM for parsing

## 🚧 Current Status

**MVP Complete** ✅

- [x] AST parsing (JS/TS, Python)
- [x] Call graph extraction
- [x] Semantic embeddings
- [x] Graph analysis
- [x] 3D visualization
- [x] OPFS persistence
- [x] WebGPU support

**Roadmap** 🗺️

- [ ] Additional languages (Go, Rust, Java)
- [ ] Stack graphs for better name resolution
- [ ] HNSW approximate nearest neighbor search
- [ ] UMAP layout seeding
- [ ] Project snapshot export/import

## 🤝 Contributing

Contributions welcome! See [PLAN.md](PLAN.md) for architecture details and [AGENTS.md](AGENTS.md) for development workflow.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

### MCP Agent Mail

HELIOS was built using **[MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)** — a coordination system that enabled 5 AI agents to work together seamlessly.

**Created by:** [@Dicklesworthstone](https://github.com/Dicklesworthstone)

Without MCP Agent Mail, coordinating multiple AI agents would have been impossible. The system provided file reservations, message coordination, and a complete audit trail — enabling **341 commits with zero merge conflicts**.

**Learn more:** See [docs/MCP_AGENT_MAIL_SHARING.md](docs/MCP_AGENT_MAIL_SHARING.md) for details on how it works.

### Libraries & Tools

Built with:
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [Graphology](https://graphology.github.io/)
- [3d-force-graph](https://github.com/vasturiano/3d-force-graph)
- [SQLite-WASM](https://sqlite.org/wasm)

---

**Made with ❤️ for developers who want to see their code in a new dimension.**
