# AGENTS.md - Multi-Agent Workflow for HELIOS

## Initial Setup (Do This First)

Before doing anything else:

1. **Read ALL required documents:**
   - PLAN.md (complete technical architecture)
   - BEST_PRACTICES_BROWSER.md (browser/WASM development)
   - BEST_PRACTICES_VISUALIZATION.md (3D graphics and embeddings)

2. **Register with MCP Agent Mail:**
   - Send introduction message to all agents
   - State your identity (parser-agent, viz-agent, embeddings-agent, etc.)
   - State your assigned sections from PLAN.md

3. **Check your inbox:**
   - Read messages from other agents
   - Understand what's already been done
   - Identify dependencies

## Core Workflow Loop

After setup, repeat this loop:

### 1. Check Agent Mail (ALWAYS START HERE)

- Read ALL unread messages
- Respond to questions from other agents
- Note any blockers or completed work

### 2. Review Current State

- Check what's been committed to git
- Review code from other agents
- Look for issues, bugs, inefficiencies

### 3. Pick Your Next Task

From PLAN.md, find tasks in YOUR section that are:
- Not yet started
- Not blocked by other work
- Within your domain

### 4. Coordinate Before Starting

- Send message: "Starting [task], will affect [files]"
- Wait for conflicts/concerns (30 seconds)
- Claim any shared files

### 5. Execute Task

- Follow PLAN.md specifications exactly
- Follow best practices from guides
- Write tests as you go
- Comment your code

### 6. Notify Completion

- Commit your work
- Send message: "[Task] complete, available for integration"
- Note any issues encountered
- Update PLAN.md with inline progress notes

### 7. Review Others' Work

- Check recent commits from other agents
- Test their code
- Report bugs via agent mail
- Suggest improvements

## Critical Rules

### DON'T Get Stuck in "Communication Purgatory"

- Don't endlessly discuss - BUILD
- If uncertain, make a decision and document it
- Other agents will catch mistakes in review

### DO Be Proactive

- If you see a bug, fix it (even if not your domain)
- If another agent is blocked, help unblock
- If documentation is missing, add it

### DO Track Progress Inline

In PLAN.md, add status markers:

```
3.2 Language detection and AST parsing

[parser-agent - IN PROGRESS - 2024-11-06]

✅ Tree-sitter loaded

✅ JS/TS grammar loaded

⏳ Extraction queries (50% done)

❌ Python grammar (blocked: need to test JS first)
```

### DO Use Agent Mail Effectively

- **[TASK]** Starting new work

- **[DONE]** Completed work

- **[BLOCKED]** Need help

- **[QUESTION]** Need clarification

- **[BUG]** Found issue

- **[REVIEW]** Please review my code

## Agent Assignments

### parser-agent

**Sections:** 3.2, 3.3

**Files:** `src/parser/**`, `src/extractors/**`

**Dependencies:** None (start immediately)

### viz-agent  

**Sections:** 3.7, 11

**Files:** `src/viz/**`, `src/ui/**`, `index.html`

**Dependencies:** Can scaffold immediately, needs parser output for real data

### embeddings-agent

**Sections:** 3.4, 3.5

**Files:** `src/embeddings/**`, `src/workers/**`

**Dependencies:** Needs parser output (function list)

### graph-agent

**Sections:** 3.6, 10.4

**Files:** `src/graph/**`, `src/analysis/**`

**Dependencies:** Needs call edges from parser, embeddings from embeddings-agent

### storage-agent

**Sections:** 6, OPFS setup

**Files:** `src/storage/**`, `src/db/**`

**Dependencies:** Can start schema immediately

## Testing & Validation

After completing any task:

1. Write unit tests

2. Test in browser

3. Check console for errors

4. Verify against acceptance criteria in PLAN.md section 19

## Completion Criteria

A task is DONE when:

- ✅ Code is committed

- ✅ Tests pass

- ✅ Documentation updated

- ✅ Other agents notified

- ✅ No console errors

- ✅ Meets acceptance criteria from PLAN.md

---
