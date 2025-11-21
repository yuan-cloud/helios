# Quick Security Check - Step by Step

## Where to Run This

**Terminal Window:**
- Open Terminal (or your terminal app)
- Navigate to: `/Users/yuanliu/Desktop/helios`
- You don't need to open any specific file - just run commands in terminal

## Step 1: Navigate to Project Directory

```bash
cd /Users/yuanliu/Desktop/helios
```

## Step 2: Check if Sensitive Files Are Ignored

Run these commands one by one:

```bash
# Check if .env is ignored
git check-ignore mcp_agent_mail/.env

# Check if .mcp.json is ignored  
git check-ignore mcp_agent_mail/.mcp.json

# Check if database is ignored
git check-ignore mcp_agent_mail/storage.sqlite3

# Check if config with token is ignored
git check-ignore mcp_agent_mail/cursor.mcp.json
```

**What you want to see:**
- ✅ If a command returns a file path (like `mcp_agent_mail/.env`), that file is **IGNORED** (good!)
- ❌ If a command returns nothing, that file is **NOT IGNORED** (bad - needs fixing)

## Step 3: Check What Will Be Pushed

```bash
# See current status
git status

# See what files are staged to commit
git diff --cached --name-only

# Check for secrets in staged files
git diff --cached | grep -i "token\|secret\|key\|password" || echo "✅ No secrets found in staged files"
```

## Step 4: Verify .gitignore File

```bash
# View .gitignore to see what's excluded
cat .gitignore | grep -A 5 "mcp_agent_mail"
```

You should see entries like:
```
mcp_agent_mail/.env
mcp_agent_mail/.mcp.json
mcp_agent_mail/storage.sqlite3*
mcp_agent_mail/cursor.mcp.json
```

## If mcp_agent_mail is a Submodule

If you get "fatal: Pathspec is in submodule", then `mcp_agent_mail` is a Git submodule.

**Good news:** Submodules are separate repos, so sensitive files in the submodule won't be in your main repo.

**But check:**
```bash
# See submodule status
git submodule status

# Check if submodule is pointing to a public repo
cd mcp_agent_mail
git remote -v
cd ..
```

If the submodule points to a public GitHub repo, sensitive files there are already exposed (but not in your main repo).

## Quick Test Script

Copy and paste this entire block into your terminal:

```bash
cd /Users/yuanliu/Desktop/helios

echo "=== Security Check ==="
echo ""
echo "1. Checking if sensitive files are ignored:"
git check-ignore mcp_agent_mail/.env && echo "  ✅ .env is ignored" || echo "  ❌ .env is NOT ignored"
git check-ignore mcp_agent_mail/.mcp.json && echo "  ✅ .mcp.json is ignored" || echo "  ❌ .mcp.json is NOT ignored"
git check-ignore mcp_agent_mail/storage.sqlite3 && echo "  ✅ storage.sqlite3 is ignored" || echo "  ❌ storage.sqlite3 is NOT ignored"
git check-ignore mcp_agent_mail/cursor.mcp.json && echo "  ✅ cursor.mcp.json is ignored" || echo "  ❌ cursor.mcp.json is NOT ignored"

echo ""
echo "2. Checking what will be committed:"
git status --short

echo ""
echo "3. Checking for secrets in staged files:"
git diff --cached | grep -i "token\|secret\|key\|password" && echo "  ⚠️  SECRETS FOUND!" || echo "  ✅ No secrets found"

echo ""
echo "=== Check Complete ==="
```

## What to Do Based on Results

### If Files Are Ignored (✅)
- You're good! Proceed with commits.

### If Files Are NOT Ignored (❌)
- The `.gitignore` isn't working
- May need to remove files from Git tracking:
  ```bash
  git rm --cached mcp_agent_mail/.env
  git rm --cached mcp_agent_mail/.mcp.json
  # etc.
  ```

### If It's a Submodule
- Sensitive files in submodule won't be in your main repo
- But check if submodule repo is public (may already be exposed)

---

**TL;DR:**
1. Open Terminal
2. Run: `cd /Users/yuanliu/Desktop/helios`
3. Run the "Quick Test Script" above
4. Check the results

