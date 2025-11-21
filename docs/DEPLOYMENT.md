# HELIOS Deployment Guide

## Overview

HELIOS is a **static web application** that runs entirely in the browser. It requires:
- No backend server
- No build step (uses ES modules + import maps)
- Static file hosting (GitHub Pages, Cloudflare Pages, Netlify, etc.)
- Cross-Origin Isolation (COOP/COEP) enabled via service worker

## Quick Start: Deploy to Cloudflare Pages (Recommended)

**Why Cloudflare Pages?** (As specified in PLAN.md §7)
- ✅ Faster global CDN for WASM assets
- ✅ Better performance for WebGPU/WebAssembly workloads
- ✅ Automatic HTTPS and edge caching
- ✅ Works perfectly with COOP/COEP service worker
- ✅ Free tier is generous for static sites

### Step 1: Push to GitHub

Your repository is already configured with a remote:
```
origin: https://github.com/yuan-cloud/helios
```

**First, commit any pending changes:**

```bash
# Check what needs to be committed
git status

# Add and commit changes
git add .
git commit -m "Prepare for deployment"

# Push to GitHub (you have 341 commits ahead)
git push origin main
```

### Step 2: Deploy to Cloudflare Pages

1. **Go to Cloudflare Dashboard:**
   - Visit: https://dash.cloudflare.com/
   - Sign up/login (free account)

2. **Create Pages Project:**
   - Click **Workers & Pages** → **Create application**
   - Select **Pages** → **Connect to Git**
   - Authorize GitHub and select repository: `yuan-cloud/helios`
   - Click **Begin setup**

3. **Build Settings:**
   - **Project name**: `helios` (or your preferred name)
   - **Production branch**: `main`
   - **Framework preset**: **None** (static site)
   - **Build command**: (leave empty - no build needed)
   - **Build output directory**: `/` (root)
   - Click **Save and Deploy**

4. **Deploy:**
   - Cloudflare will automatically deploy
   - Your site will be available at: `https://helios.pages.dev` (or custom name)
   - **Future updates**: Every push to `main` auto-deploys

**Note:** First deployment takes 2-3 minutes. Subsequent deployments are faster.

### Step 3: Verify Deployment

1. Visit your GitHub Pages URL
2. Open browser DevTools → Console
3. Check for:
   - ✅ "Cross-Origin Isolation: Enabled" (required for SharedArrayBuffer)
   - ✅ "Storage ready" message
   - ❌ No CORS errors
   - ❌ No module resolution errors

### Step 4: Test Core Features

- [ ] Load demo dataset
- [ ] Select a repository folder
- [ ] Visualization renders correctly
- [ ] Storage persists (OPFS)
- [ ] Export PNG works

---

## Alternative Deployment Options

### Option 1: GitHub Pages (Simpler, but slower)

**Steps:**

1. Go to your repository: https://github.com/yuan-cloud/helios
2. Click **Settings** → **Pages**
3. Under **Source**, select:
   - **Branch**: `main`
   - **Folder**: `/ (root)`
4. Click **Save**

Your site will be available at: `https://yuan-cloud.github.io/helios/`

**Note:** GitHub Pages is simpler but has slower CDN than Cloudflare.

### Option 2: Netlify

1. Go to [Netlify](https://app.netlify.com/)
2. **Add new site** → **Import an existing project**
3. Connect GitHub repository
4. **Build settings:**
   - Build command: (empty)
   - Publish directory: `/`
5. Deploy

### Option 3: Vercel

1. Go to [Vercel](https://vercel.com/)
2. **Add New Project** → Import from GitHub
3. **Framework Preset**: Other
4. **Root Directory**: `.`
5. Deploy

---

## Important: Cross-Origin Isolation (COOP/COEP)

HELIOS **requires** Cross-Origin Isolation to enable:
- SharedArrayBuffer (for SQLite-WASM threads)
- WebAssembly threads (for performance)

### How It Works

The `coi-serviceworker.js` file automatically adds the required headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

**First Load Behavior:**
- The service worker will cause a **one-time reload** on first visit
- This is normal and required for COOP/COEP activation
- Subsequent visits will load normally

### Verification

Check in browser console:
```javascript
console.log('Cross-Origin Isolation:', crossOriginIsolated);
// Should output: Cross-Origin Isolation: true
```

If `false`, the app will fall back to slower single-threaded mode.

---

## File Structure for Deployment

Ensure these files are in your repository root:

```
helios/
├── index.html              # Main entry point
├── coi-serviceworker.js    # Required for COOP/COEP
├── package.json            # Dependencies (for local dev)
├── README.md
├── PLAN.md
├── public/                 # Static assets
│   ├── sqlite/            # SQLite-WASM files
│   └── vendor/            # Local vendor dependencies
├── grammars/              # Tree-sitter WASM grammars
├── src/                   # Application source code
└── docs/                  # Documentation
```

**Important:** All files in `public/`, `grammars/`, and `src/` must be served as static files.

---

## Custom Domain Setup

### GitHub Pages

1. In repository **Settings** → **Pages**
2. Under **Custom domain**, enter your domain (e.g., `helios.yourdomain.com`)
3. Follow DNS configuration instructions
4. GitHub will provide SSL certificate automatically

### Cloudflare Pages

1. In Cloudflare Pages project settings
2. Go to **Custom domains**
3. Add your domain
4. Update DNS records as instructed

---

## Troubleshooting

### Issue: "Failed to resolve module specifier"

**Cause:** Import map dependencies not loading from CDN.

**Fix:**
1. Check browser console for specific module errors
2. Verify CDN URLs in `index.html` import map are accessible
3. Consider using local vendor files (see `docs/dependency-packaging.md`)

### Issue: "Storage worker unavailable"

**Cause:** OPFS not available or service worker not registered.

**Fix:**
1. Ensure site is served over HTTPS (required for OPFS)
2. Check service worker registration in DevTools → Application → Service Workers
3. Verify `coi-serviceworker.js` is in root directory

### Issue: Visualization not rendering

**Cause:** Three.js or 3d-force-graph not loading.

**Fix:**
1. Check import map in `index.html` for correct CDN URLs
2. Verify `public/vendor/` files are deployed (if using local copies)
3. Check browser console for WebGL/WebGPU errors

### Issue: Slow performance

**Possible causes:**
1. Cross-Origin Isolation not enabled (check `crossOriginIsolated`)
2. WebGPU not available (falls back to WASM)
3. Large repository (consider "Quick Map" mode)

**Solutions:**
- Verify COOP/COEP headers are present (DevTools → Network → Headers)
- Check browser supports WebGPU: `navigator.gpu !== undefined`
- Use browser DevTools Performance tab to identify bottlenecks

---

## Pre-Deployment Checklist

Before deploying, ensure:

- [ ] All code is committed and pushed to GitHub
- [ ] `coi-serviceworker.js` is in repository root
- [ ] `index.html` has correct import map entries
- [ ] All vendor files in `public/vendor/` are committed (if using local copies)
- [ ] Test locally with a simple HTTP server:
  ```bash
  python3 -m http.server 8000
  # Visit http://localhost:8000
  ```
- [ ] No console errors in browser DevTools
- [ ] Cross-Origin Isolation is enabled (`crossOriginIsolated === true`)
- [ ] Storage status shows "Storage ready (OPFS persistent)"
- [ ] Demo dataset loads successfully
- [ ] Visualization renders and is interactive

---

## Post-Deployment Monitoring

### What to Check

1. **First Visit:**
   - Service worker installs and reloads page (expected)
   - Cross-Origin Isolation enabled
   - No CORS errors

2. **Functionality:**
   - File picker works (directory selection)
   - Parsing completes without errors
   - Embeddings generate successfully
   - Visualization renders
   - Storage persists between sessions

3. **Performance:**
   - Initial load time < 5 seconds
   - Parsing 1k functions < 30 seconds
   - Visualization FPS > 30

### Browser Compatibility

HELIOS works best on:
- ✅ Chrome/Edge 113+ (full WebGPU support)
- ✅ Safari 16.4+ (WebGPU support)
- ✅ Firefox 141+ (WebGPU support)
- ⚠️ Older browsers: Falls back to WASM (slower but functional)

---

## Continuous Deployment

### GitHub Actions (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to GitHub Pages
        uses: actions/deploy-pages@v1
```

**Note:** GitHub Pages can also auto-deploy from the `main` branch without Actions.

---

## Security Considerations

### What HELIOS Does:
- ✅ All processing happens client-side
- ✅ No code is uploaded to servers
- ✅ Data stored locally in browser (OPFS)
- ✅ No analytics or tracking

### What to Document:
- Privacy policy explaining local-only processing
- Browser requirements (HTTPS, modern browser)
- Data retention policy (24 hours by default, configurable)

---

## Next Steps

1. **Push your code to GitHub:**
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push origin main
   ```

2. **Enable GitHub Pages** (Settings → Pages)

3. **Test your deployment** at `https://yuan-cloud.github.io/helios/`

4. **Share your site!** 🚀

---

## Need Help?

- Check `PLAN.md` for technical architecture
- See `docs/storage.md` for storage details
- Review `docs/dependency-packaging.md` for dependency management
- Check browser console for specific error messages

