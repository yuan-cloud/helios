# Clean Git Commits Guide

## Where Files Are Saved

When you say "keep all", files are saved in your **HELIOS project directory**:

```
/Users/yuanliu/Desktop/helios/
├── README.md                          # Project overview (modified)
├── DEPLOY_QUICKSTART.md               # Quick deployment guide (new)
├── PORTFOLIO_READINESS_SUMMARY.md     # Portfolio summary (new)
├── docs/
│   ├── DEPLOYMENT.md                  # Full deployment guide (new)
│   ├── DEPLOYMENT_READINESS.md        # Deployment checklist (new)
│   └── MCP_AGENT_MAIL_SHARING.md     # MCP Agent Mail doc (new)
└── src/viz/graph-viz.js              # Visualization code (modified)
```

All files are saved **locally** in your project. They're not committed to Git until you run `git add` and `git commit`.

## Clean Commit Strategy

### Principle: One Logical Change Per Commit

Each commit should represent a **single, complete change** that:
- Makes sense on its own
- Can be reviewed independently
- Has a clear, descriptive message

### Bad Commits ❌

```bash
# Too vague
git commit -m "updates"

# Multiple unrelated changes
git commit -m "fix bugs and add features"

# No context
git commit -m "changes"
```

### Good Commits ✅

```bash
# Single, clear purpose
git commit -m "Add deployment documentation for Cloudflare Pages"

# Descriptive with context
git commit -m "Fix visualization export: enable preserveDrawingBuffer for PNG capture"

# Follows conventional format
git commit -m "docs: Add MCP Agent Mail coordination guide"
```

## Recommended Commit Order

### Step 1: Documentation (Separate Commits)

```bash
# Commit README update
git add README.md
git commit -m "docs: Update README with professional project overview

- Add comprehensive feature list
- Document tech stack
- Add quick start guide
- Include use cases and privacy notes"

# Commit deployment docs
git add docs/DEPLOYMENT.md docs/DEPLOYMENT_READINESS.md DEPLOY_QUICKSTART.md
git commit -m "docs: Add deployment guides and readiness checklist

- Cloudflare Pages deployment guide (as per PLAN.md)
- GitHub Pages alternative
- Pre-deployment checklist
- Post-deployment verification steps"

# Commit MCP Agent Mail doc
git add docs/MCP_AGENT_MAIL_SHARING.md
git commit -m "docs: Add MCP Agent Mail coordination guide

- Explain multi-agent development process
- Document file reservation system
- Include real examples from HELIOS development
- Shareable format for employers"

# Commit portfolio summary
git add PORTFOLIO_READINESS_SUMMARY.md
git commit -m "docs: Add portfolio readiness assessment

- Deployment readiness checklist
- Employer presentation guide
- Key differentiators and highlights"
```

### Step 2: Code Changes (If Any)

```bash
# If you have code changes, commit separately
git add src/viz/graph-viz.js
git commit -m "fix: Improve graph visualization export reliability

- Add preserveDrawingBuffer check
- Improve error handling for PNG export
- Better fallback for html2canvas"
```

### Step 3: Review Before Pushing

```bash
# Review your commits
git log --oneline -5

# Should see something like:
# abc1234 docs: Add MCP Agent Mail coordination guide
# def5678 docs: Add deployment guides and readiness checklist
# ghi9012 docs: Update README with professional project overview
```

## Commit Message Format

### Conventional Commits (Recommended)

```
<type>: <subject>

<body (optional)>

<footer (optional)>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**

```bash
# Feature
git commit -m "feat: Add WebGPU acceleration for embeddings

- Detect WebGPU availability
- Fallback to WASM if unavailable
- Show backend in UI"

# Bug fix
git commit -m "fix: Resolve module specifier errors for graphology dependencies

- Add missing import map entries
- Use esm.run CDN for dependencies
- Fix obliterator subpath mapping"

# Documentation
git commit -m "docs: Add deployment guide for Cloudflare Pages

- Step-by-step deployment instructions
- Troubleshooting section
- Pre-deployment checklist"
```

## Step-by-Step: Clean Commits for Your Current Changes

### Current Status

```bash
# Check what's changed
git status
```

You have:
- `README.md` (modified)
- `src/viz/graph-viz.js` (modified)
- `docs/DEPLOYMENT.md` (new)
- `docs/DEPLOYMENT_READINESS.md` (new)
- `docs/MCP_AGENT_MAIL_SHARING.md` (new)
- `DEPLOY_QUICKSTART.md` (new)
- `PORTFOLIO_READINESS_SUMMARY.md` (new)

### Recommended Commit Sequence

```bash
# 1. Documentation: README update
git add README.md
git commit -m "docs: Update README with professional project overview

- Comprehensive feature list and tech stack
- Quick start guide and use cases
- Privacy and security highlights
- Portfolio-ready presentation"

# 2. Documentation: Deployment guides
git add docs/DEPLOYMENT.md docs/DEPLOYMENT_READINESS.md DEPLOY_QUICKSTART.md
git commit -m "docs: Add comprehensive deployment documentation

- Cloudflare Pages deployment (as per PLAN.md)
- GitHub Pages alternative
- Pre-deployment readiness checklist
- Quick start guide for deployment"

# 3. Documentation: MCP Agent Mail guide
git add docs/MCP_AGENT_MAIL_SHARING.md
git commit -m "docs: Add MCP Agent Mail coordination guide

- Explain multi-agent development process
- Document file reservation system
- Include real examples from HELIOS
- Shareable format for portfolio presentation"

# 4. Documentation: Portfolio assessment
git add PORTFOLIO_READINESS_SUMMARY.md
git commit -m "docs: Add portfolio readiness assessment

- Deployment readiness checklist
- Employer presentation guide
- Key differentiators and highlights"

# 5. Code: Visualization improvements (if needed)
git add src/viz/graph-viz.js
git commit -m "fix: Improve graph visualization export reliability

- Better error handling for PNG export
- Improved fallback mechanisms"
```

## Best Practices

### 1. Commit Often, Push When Ready

```bash
# Good: Small, logical commits
git commit -m "docs: Add deployment guide"
git commit -m "fix: Resolve export issue"

# Bad: One giant commit
git commit -m "update everything"
```

### 2. Write Clear Messages

```bash
# Good: Specific and clear
git commit -m "fix: Resolve module resolution for graphology-utils"

# Bad: Vague
git commit -m "fix stuff"
```

### 3. Review Before Pushing

```bash
# Review commits
git log --oneline -10

# Review changes
git diff origin/main

# Push when ready
git push origin main
```

### 4. Use Branches for Features

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make commits
git commit -m "feat: Add new feature"

# Merge when ready
git checkout main
git merge feature/new-feature
```

## Quick Reference

### Check Status
```bash
git status
```

### Stage Files
```bash
git add <file>              # Single file
git add docs/               # Directory
git add .                   # All changes (use carefully)
```

### Commit
```bash
git commit -m "type: Clear message"
```

### Review
```bash
git log --oneline -10       # Recent commits
git diff                    # Unstaged changes
git diff --staged           # Staged changes
```

### Push
```bash
git push origin main
```

## Example: Complete Workflow

```bash
# 1. Check status
git status

# 2. Stage documentation files
git add README.md docs/DEPLOYMENT.md docs/DEPLOYMENT_READINESS.md

# 3. Commit with clear message
git commit -m "docs: Add deployment documentation and update README"

# 4. Review commit
git log --oneline -1

# 5. Stage next logical group
git add docs/MCP_AGENT_MAIL_SHARING.md

# 6. Commit separately
git commit -m "docs: Add MCP Agent Mail coordination guide"

# 7. Review all commits
git log --oneline -5

# 8. Push when ready
git push origin main
```

## Common Mistakes to Avoid

❌ **Committing everything at once**
```bash
git add .
git commit -m "updates"
```

✅ **Logical, separate commits**
```bash
git add docs/
git commit -m "docs: Add deployment guides"
git add src/
git commit -m "fix: Resolve visualization issues"
```

❌ **Vague commit messages**
```bash
git commit -m "fix"
```

✅ **Descriptive messages**
```bash
git commit -m "fix: Resolve PNG export failure in graph visualization"
```

❌ **Mixing documentation and code**
```bash
git add README.md src/viz/graph-viz.js
git commit -m "updates"
```

✅ **Separate concerns**
```bash
git add README.md
git commit -m "docs: Update README"
git add src/viz/graph-viz.js
git commit -m "fix: Improve visualization export"
```

---

**Remember**: Clean commits make your project history readable, reviewable, and professional. Each commit should tell a story.

