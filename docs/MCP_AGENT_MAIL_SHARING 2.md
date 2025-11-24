# MCP Agent Mail: Multi-Agent Coordination System

> **How HELIOS was built with coordinated AI agents**

## What is MCP Agent Mail?

**MCP Agent Mail** is a coordination layer that allows multiple AI coding agents to work together on the same project without conflicts. Think of it as "Gmail for coding agents" — agents can send messages, coordinate file edits, and avoid stepping on each other's work.

## Why It Matters for HELIOS

HELIOS was built using **5 specialized AI agents** working in parallel:

1. **parser-agent** (PinkMountain) - AST parsing and call graph extraction
2. **viz-agent** (LilacLake) - 3D visualization and UI
3. **embeddings-agent** (BlueBear) - Semantic embeddings and similarity
4. **graph-agent** (OrangeSnow) - Graph analysis and metrics
5. **storage-agent** (ChartreuseHill) - SQLite/OPFS persistence

Without coordination, these agents would:
- Overwrite each other's code changes
- Miss critical context from parallel work
- Create merge conflicts
- Duplicate work

**MCP Agent Mail solved this** by providing:
- Message-based coordination
- File reservation system (prevents conflicts)
- Searchable conversation history
- Human-auditable Git artifacts

## How It Works

### 1. Agent Registration

Each agent registers with a memorable identity:
```
Agent: PinkMountain
Program: codex-cli
Model: gpt-4
Task: AST parsing and call graph extraction
```

### 2. File Reservations

Before editing files, agents reserve them:
```javascript
file_reservation_paths({
  project_key: "/path/to/helios",
  agent_name: "PinkMountain",
  paths: ["src/parser/**", "src/extractors/**"],
  exclusive: true,
  ttl_seconds: 3600
})
```

This prevents other agents from editing the same files simultaneously.

### 3. Message-Based Coordination

Agents communicate via messages:
```javascript
send_message({
  project_key: "/path/to/helios",
  sender_name: "PinkMountain",
  to: ["LilacLake"],
  subject: "[DONE] Parser output ready",
  body_md: "Call graph extraction complete. Payload format matches schema."
})
```

### 4. Inbox & Threading

Agents check their inbox and respond:
```javascript
fetch_inbox({
  project_key: "/path/to/helios",
  agent_name: "LilacLake",
  limit: 20
})
```

Messages are threaded, searchable, and persisted in Git for human review.

## Real Example from HELIOS Development

### Scenario: Adding Similarity Edges

1. **embeddings-agent** (BlueBear) completes similarity computation
2. Sends message: `"[DONE] Similarity edges ready, schema-compliant"`
3. **graph-agent** (OrangeSnow) receives notification
4. Reviews message, checks payload format
5. Integrates similarity edges into graph analysis
6. Sends confirmation: `"[DONE] Graph analysis complete with similarity edges"`

All of this happens automatically, with full Git history for human review.

## Key Features

### File Reservations (Leases)
- **Exclusive reservations**: Only one agent can edit
- **Shared reservations**: Multiple agents can read
- **TTL-based expiration**: Automatic release after timeout
- **Conflict detection**: Warns if reservation conflicts

### Message System
- **GitHub-Flavored Markdown**: Rich formatting
- **Threading**: Related messages grouped
- **Search**: Full-text search across all messages
- **Attachments**: Images and files supported

### Audit Trail
- **Git commits**: Every message creates a Git commit
- **Human-readable**: Browse messages in Git history
- **Searchable**: SQLite FTS5 for fast search
- **Exportable**: Static HTML bundles for sharing

## Technical Architecture

```
┌─────────────────┐
│  AI Agents      │
│  (Claude, GPT)  │
└────────┬────────┘
         │ HTTP/JSON-RPC
         │
┌────────▼─────────────────┐
│  MCP Agent Mail Server   │
│  (FastMCP + SQLite)      │
└────────┬─────────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼────┐
│ Git   │ │SQLite │
│Archive│ │Index  │
└───────┘ └───────┘
```

## Benefits for Development

### 1. **Parallel Development**
Multiple agents work simultaneously without conflicts.

### 2. **Context Preservation**
Agents share context through messages, not just code.

### 3. **Human Oversight**
All coordination is visible in Git commits.

### 4. **Scalability**
Works with 2 agents or 20 agents.

### 5. **Debugging**
When something breaks, check the message history.

## How to Use MCP Agent Mail

### Installation

```bash
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/mcp_agent_mail/main/scripts/install.sh | bash -s -- --yes
```

### Configuration

Add to your agent's configuration (e.g., `AGENTS.md`):

```markdown
## MCP Agent Mail: coordination for multi-agent workflows

What it is
- A mail-like layer that lets coding agents coordinate asynchronously via MCP tools and resources.
- Provides identities, inbox/outbox, searchable threads, and advisory file reservations.

How to use effectively
1. Register an identity: `ensure_project` then `register_agent`
2. Reserve files before editing: `file_reservation_paths`
3. Communicate via messages: `send_message`, `fetch_inbox`
4. Acknowledge important messages: `acknowledge_message`
```

### Example Workflow

```javascript
// 1. Register agent
register_agent({
  project_key: "/absolute/path/to/project",
  program: "codex-cli",
  model: "gpt-4",
  name: "MyAgent"
})

// 2. Reserve files
file_reservation_paths({
  project_key: "/absolute/path/to/project",
  agent_name: "MyAgent",
  paths: ["src/my-feature/**"],
  exclusive: true
})

// 3. Do work...

// 4. Notify completion
send_message({
  project_key: "/absolute/path/to/project",
  sender_name: "MyAgent",
  to: ["OtherAgent"],
  subject: "[DONE] Feature complete",
  body_md: "Implemented X, Y, Z. Ready for integration."
})
```

## HELIOS Development History

The HELIOS project used MCP Agent Mail throughout development:

- **341 commits** coordinated across 5 agents
- **Zero merge conflicts** (file reservations prevented conflicts)
- **Full audit trail** in Git (every message is a commit)
- **Parallel workstreams** (parser, viz, embeddings, graph, storage)

You can see the coordination in action by browsing:
- `mcp_agent_mail/` directory (MCP Agent Mail server)
- Git commit history (messages embedded in commits)
- `AGENTS.md` (coordination rules)

## Learn More

- **MCP Agent Mail Repository**: https://github.com/Dicklesworthstone/mcp_agent_mail
- **Documentation**: See `mcp_agent_mail/README.md`
- **HELIOS Agent Coordination**: See `AGENTS.md`

## Why This Matters

**For Employers**: Shows you understand:
- Multi-agent systems
- Coordination protocols
- Distributed development
- Modern AI tooling

**For Developers**: Demonstrates:
- Advanced problem-solving
- System design skills
- Understanding of AI workflows
- Production-ready coordination

---

**MCP Agent Mail** enabled HELIOS to be built by 5 AI agents working in parallel, with zero conflicts and full transparency. This is the future of AI-assisted development.

