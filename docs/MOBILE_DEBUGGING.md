# Mobile Debugging Guide - How to Check Console Errors

## Chrome Mobile (Android)

### Method 1: Chrome DevTools (Easiest)

1. **On your computer**, open Chrome
2. Go to `chrome://inspect` in the address bar
3. **On your phone**, open Chrome and navigate to your site
4. Your phone should appear in the "Remote devices" list
5. Click **"Inspect"** next to your site
6. The DevTools will open on your computer showing the mobile console!

**Requirements:**
- Phone and computer must be on the same WiFi network
- USB debugging enabled (Android Settings → Developer Options → USB Debugging)
- Or use "Discover USB devices" in Chrome DevTools

### Method 2: USB Debugging

1. Connect phone to computer via USB
2. Enable USB debugging on phone (Settings → Developer Options)
3. Open Chrome on computer → `chrome://inspect`
4. Your phone will appear, click "Inspect"

---

## Chrome Mobile (iOS)

### Method 1: Remote Debugging (Requires Mac)

1. **On your Mac**, open Safari
2. Enable "Develop" menu: Safari → Preferences → Advanced → "Show Develop menu"
3. Connect iPhone to Mac via USB
4. On iPhone: Settings → Safari → Advanced → Enable "Web Inspector"
5. **On iPhone**, open Chrome and navigate to your site
6. **On Mac**, Safari → Develop → [Your iPhone] → [Your Site]
7. Safari DevTools will open showing the console!

### Method 2: Chrome DevTools (Alternative)

1. Connect iPhone to Mac via USB
2. Open Chrome on Mac → `chrome://inspect`
3. Your iPhone should appear (if Web Inspector is enabled)
4. Click "Inspect"

---

## Safari Mobile (iOS)

### Method 1: Safari Web Inspector (Requires Mac)

1. **On your Mac**, open Safari
2. Enable "Develop" menu: Safari → Preferences → Advanced → "Show Develop menu"
3. Connect iPhone to Mac via USB
4. On iPhone: Settings → Safari → Advanced → Enable "Web Inspector"
5. **On iPhone**, open Safari and navigate to your site
6. **On Mac**, Safari → Develop → [Your iPhone] → [Your Site]
7. Safari DevTools will open showing the console!

### Method 2: Eruda Console (On-Device)

If you can't use a Mac, you can add a mobile console directly to the page:

1. Add this to your HTML temporarily:
```html
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script>eruda.init();</script>
```

2. This adds a floating console button on the page
3. Tap it to see console logs directly on your phone

---

## Quick Test: Add On-Screen Console

If remote debugging is too complicated, you can add a simple on-screen console to your page:

```javascript
// Add this to index.html temporarily for mobile debugging
const mobileConsole = document.createElement('div');
mobileConsole.id = 'mobileConsole';
mobileConsole.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 200px;
    overflow-y: auto;
    background: rgba(0,0,0,0.9);
    color: #0f0;
    font-family: monospace;
    font-size: 10px;
    padding: 10px;
    z-index: 10000;
    display: none;
`;
document.body.appendChild(mobileConsole);

// Override console.log to show on screen
const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) {
    originalLog.apply(console, args);
    const msg = args.join(' ');
    mobileConsole.innerHTML += '<div style="color:#0f0">[LOG] ' + msg + '</div>';
    mobileConsole.scrollTop = mobileConsole.scrollHeight;
};
console.error = function(...args) {
    originalError.apply(console, args);
    const msg = args.join(' ');
    mobileConsole.innerHTML += '<div style="color:#f00">[ERROR] ' + msg + '</div>';
    mobileConsole.scrollHeight = mobileConsole.scrollHeight;
};

// Add toggle button
const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Console';
toggleBtn.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 10001;
    padding: 10px;
    background: #333;
    color: #fff;
    border: none;
    border-radius: 5px;
`;
toggleBtn.onclick = () => {
    mobileConsole.style.display = mobileConsole.style.display === 'none' ? 'block' : 'none';
};
document.body.appendChild(toggleBtn);
```

---

## Recommended: Use Chrome DevTools Remote Debugging

**For Android:**
1. Connect via USB or WiFi
2. Go to `chrome://inspect` on desktop Chrome
3. Click "Inspect" on your mobile site
4. Full DevTools with console, network, elements, etc.

**For iOS:**
1. Connect iPhone to Mac via USB
2. Enable Web Inspector on iPhone
3. Use Safari on Mac → Develop menu
4. Or use Chrome DevTools if available

---

## Troubleshooting Mobile Issues

Once you have console access, look for:

1. **Errors starting with `[HELIOS]`** - These are our custom logs
2. **Errors starting with `[Repo Selection]`** - Repository processing logs
3. **Errors starting with `[Visualization]`** - Visualization initialization logs
4. **Errors starting with `[ZIP]`** - ZIP file processing logs
5. **Module resolution errors** - "Failed to resolve module specifier"
6. **Worker errors** - Errors from Web Workers

Common mobile issues to check:
- `NotAllowedError` - User activation lost
- `TypeError` - Module loading issues
- `ReferenceError` - Missing functions/variables
- Network errors - Failed to load resources

