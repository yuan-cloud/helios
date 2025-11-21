# Quick Start: Deploy HELIOS to Cloudflare Pages

**Recommended by PLAN.md** - Cloudflare Pages provides faster CDN for WASM assets and better performance.

## Current Status

✅ **GitHub repository already configured:**
- Remote: `https://github.com/yuan-cloud/helios`
- Branch: `main`
- You have 341 commits ready to push

## Step-by-Step Deployment

### Step 1: Commit Any Pending Changes

You have uncommitted changes in `src/viz/graph-viz.js`. Let's commit them:

```bash
# Review what changed
git diff src/viz/graph-viz.js

# If changes look good, commit them
git add src/viz/graph-viz.js
git commit -m "Update graph visualization"

# Or commit everything
git add .
git commit -m "Prepare for deployment"
```

### Step 2: Push to GitHub

```bash
# Push all commits to GitHub
git push origin main
```

This will upload your 341 commits to GitHub.

### Step 3: Deploy to Cloudflare Pages

1. **Go to Cloudflare Dashboard:**
   - Visit: https://dash.cloudflare.com/
   - Sign up or log in (free account)

2. **Create Pages Project:**
   - Click **Workers & Pages** → **Create application**
   - Select **Pages** → **Connect to Git**
   - Authorize GitHub access
   - Select repository: `yuan-cloud/helios`
   - Click **Begin setup**

3. **Configure Build:**
   - **Project name**: `helios` (or your choice)
   - **Production branch**: `main`
   - **Framework preset**: **None** (static site)
   - **Build command**: (leave empty)
   - **Build output directory**: `/` (root)
   - Click **Save and Deploy**

4. **Wait for Deployment:**
   - First deployment takes 2-3 minutes
   - Your site will be live at: `https://helios.pages.dev` (or your custom name)

### Step 4: Verify Deployment

- Visit your Cloudflare Pages URL
- Open browser DevTools → Console
- Check for:
  - ✅ "Cross-Origin Isolation: Enabled"
  - ✅ "Storage ready" message
  - ✅ No CORS errors

## That's It! 🎉

Your HELIOS app is now live on Cloudflare Pages with global CDN!

## Auto-Deployment

**Future updates:** Every push to `main` branch automatically deploys to Cloudflare Pages.

## Next Steps (Optional)

### Custom Domain
- In Cloudflare Pages project settings
- Go to **Custom domains**
- Add your domain and follow DNS instructions

### Alternative: GitHub Pages
If you prefer GitHub Pages (simpler but slower):
- See `docs/DEPLOYMENT.md` for GitHub Pages setup

## Troubleshooting

**If something doesn't work:**
1. Check browser console for errors
2. Verify `coi-serviceworker.js` is in the root
3. Ensure site loads over HTTPS (GitHub Pages provides this automatically)
4. See `docs/DEPLOYMENT.md` for detailed troubleshooting

