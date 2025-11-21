# 🚨 CRITICAL: Security Audit Before Public Release

## ⚠️ SENSITIVE FILES FOUND

**DO NOT PUSH THESE TO GITHUB:**

### 1. **BEARER TOKENS EXPOSED** 🔴 CRITICAL
- `mcp_agent_mail/cursor.mcp.json` - Contains hardcoded bearer token
- `mcp_agent_mail/.mcp.json` - Contains bearer token
- `mcp_agent_mail/codex.mcp.json` - Token reference
- `mcp_agent_mail/gemini.mcp.json` - Token reference

**Risk:** Anyone with these tokens can access your MCP Agent Mail server.

### 2. **PRIVATE SIGNING KEY** 🔴 CRITICAL
- `mcp_agent_mail/signing-77c6e768.key` - Private Ed25519 key

**Risk:** If exposed, attackers could sign malicious bundles.

### 3. **DATABASE FILES** 🟡 HIGH
- `mcp_agent_mail/storage.sqlite3` - Contains actual message data (1.8MB)
- `mcp_agent_mail/storage.sqlite3-shm` - Database temp file
- `mcp_agent_mail/storage.sqlite3-wal` - Database temp file

**Risk:** Contains all agent messages, file reservations, project data.

### 4. **ENVIRONMENT FILES** 🟡 HIGH
- `mcp_agent_mail/.env` - Environment variables

**Risk:** May contain API keys, tokens, configuration.

### 5. **LOG FILES** 🟡 MEDIUM
- `mcp_agent_mail/logs/server_20251106_225345.log` - Server logs

**Risk:** May contain sensitive information, errors, tokens.

## ✅ IMMEDIATE ACTIONS REQUIRED

### Step 1: Update .gitignore

Add these to your `.gitignore`:

```gitignore
# MCP Agent Mail - Sensitive Files
mcp_agent_mail/.env
mcp_agent_mail/.mcp.json
mcp_agent_mail/*.mcp.json
mcp_agent_mail/storage.sqlite3*
mcp_agent_mail/logs/
mcp_agent_mail/signing-*.key
mcp_agent_mail/.venv/
mcp_agent_mail/.claude/
mcp_agent_mail/backup_config_files/

# But keep these (they're safe):
# mcp_agent_mail/README.md
# mcp_agent_mail/src/
# mcp_agent_mail/docs/
# mcp_agent_mail/scripts/
```

### Step 2: Remove Sensitive Files from Git History

If these files were already committed:

```bash
# Remove from Git tracking (but keep local files)
git rm --cached mcp_agent_mail/.env
git rm --cached mcp_agent_mail/.mcp.json
git rm --cached mcp_agent_mail/cursor.mcp.json
git rm --cached mcp_agent_mail/codex.mcp.json
git rm --cached mcp_agent_mail/gemini.mcp.json
git rm --cached mcp_agent_mail/storage.sqlite3*
git rm --cached mcp_agent_mail/logs/*
git rm --cached mcp_agent_mail/signing-*.key

# Commit the removal
git commit -m "security: Remove sensitive files from repository"
```

### Step 3: Create Template Files

Create safe template versions:

```bash
# Create template config files
cp mcp_agent_mail/cursor.mcp.json mcp_agent_mail/cursor.mcp.json.example
# Edit to remove token: "Bearer ${MCP_AGENT_MAIL_TOKEN}"

cp mcp_agent_mail/.mcp.json mcp_agent_mail/.mcp.json.example
# Edit to remove token
```

### Step 4: Rotate Exposed Tokens

**If tokens were already pushed to GitHub:**
1. Generate new tokens in MCP Agent Mail
2. Update local config files
3. Consider the old tokens compromised

## 📋 Pre-Push Checklist

Before pushing to GitHub, verify:

- [ ] No bearer tokens in any JSON files
- [ ] No `.env` files committed
- [ ] No private keys (`.key` files) committed
- [ ] No database files (`.sqlite3`, `.db`) committed
- [ ] No log files committed
- [ ] `.gitignore` updated and working
- [ ] All sensitive files removed from Git history
- [ ] Template files created for configs

## 🎯 What SHOULD Be Public

### ✅ Safe to Include:
- Source code (`src/`)
- Documentation (`docs/`, `README.md`)
- Configuration templates (`.example` files)
- Tests (`tests/`)
- Public assets (`public/`, `grammars/`)
- Build scripts (without secrets)

### ❌ Never Include:
- API keys, tokens, secrets
- Private keys
- Database files
- Environment files (`.env`)
- Log files
- Personal configuration
- Backup files

## 📝 Best Practices

### 1. Use Environment Variables
```bash
# .env (gitignored)
MCP_AGENT_MAIL_TOKEN=your_token_here

# config.json (committed)
{
  "token": "${MCP_AGENT_MAIL_TOKEN}"
}
```

### 2. Use Template Files
```bash
# config.json.example (committed)
{
  "token": "YOUR_TOKEN_HERE"
}

# config.json (gitignored)
# Users copy .example and fill in their token
```

### 3. Use Git Secrets Scanner
```bash
# Install git-secrets
brew install git-secrets

# Scan before commit
git secrets --scan
```

### 4. Use GitHub Secret Scanning
GitHub automatically scans for exposed secrets, but prevention is better.

## 🔍 How to Check What Will Be Pushed

```bash
# See what files are staged
git diff --cached --name-only

# See what will be committed
git status

# Check for sensitive patterns
git diff --cached | grep -i "token\|secret\|key\|password"

# Verify .gitignore is working
git check-ignore -v mcp_agent_mail/.env
```

## 🚨 If You Already Pushed Secrets

1. **Immediately rotate** all exposed tokens/keys
2. **Remove from Git history** (requires force push - coordinate with team)
3. **Consider the secrets compromised**
4. **Review GitHub security alerts**

---

**Remember:** Once secrets are in Git history, they're there forever (even if you delete them later). Always check before pushing!

