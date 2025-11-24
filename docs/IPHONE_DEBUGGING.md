# iPhone Debugging Guide - Step by Step

## Method 1: Safari Web Inspector (Requires Mac + USB Cable)

### Step 1: Enable Web Inspector on iPhone

1. On your iPhone, go to **Settings** → **Safari** → **Advanced**
2. Turn ON **"Web Inspector"**
3. Keep Settings open

### Step 2: Connect iPhone to Mac

1. Connect your iPhone to your Mac using a USB cable
2. Unlock your iPhone
3. If asked, tap **"Trust This Computer"** on your iPhone

### Step 3: Open Safari on Mac

1. On your Mac, open **Safari** (not Chrome)
2. Go to **Safari** menu → **Preferences** (or press `Cmd + ,`)
3. Click the **"Advanced"** tab
4. Check the box: **"Show Develop menu in menu bar"**
5. Close Preferences

### Step 4: View Console

1. On your iPhone, open **Safari** and go to your HELIOS site
2. On your Mac, in Safari menu bar, click **"Develop"**
3. You should see your iPhone name in the menu
4. Hover over your iPhone name → you'll see your site
5. Click on your site name
6. **Safari DevTools will open** showing the console!

**You can now see all console logs, errors, and debug your site!**

---

## Method 2: Chrome on iPhone (Also Requires Mac)

### Step 1: Enable Web Inspector (Same as Safari)

1. On iPhone: **Settings** → **Safari** → **Advanced** → Turn ON **"Web Inspector"**
2. Connect iPhone to Mac via USB
3. Trust the computer if asked

### Step 2: Use Chrome DevTools

1. On Mac, open **Chrome**
2. Go to `chrome://inspect` in the address bar
3. Your iPhone should appear under "Remote devices"
4. Click **"Inspect"** next to your site
5. Chrome DevTools will open!

**Note:** Chrome on iPhone uses Safari's WebKit engine, so you need to enable Web Inspector in Safari settings even when using Chrome.

---

## Method 3: On-Screen Console (No Mac Required!)

If you don't have a Mac, the app has a built-in mobile console:

### How to See It:

1. **Open the HELIOS site on your iPhone** (Safari or Chrome)
2. **Look for a button** in the **bottom-right corner** that says **"📱 Console"**
3. **Tap the button** - a console panel will slide up from the bottom
4. You'll see all logs, errors, and warnings!

### If You Don't See the Button:

The button should appear automatically on mobile devices. If you don't see it:

1. **Hard refresh** the page (pull down to refresh)
2. **Check the bottom-right corner** - it might be behind other elements
3. **Try scrolling** - make sure you're at the top of the page
4. **Check console logs** - you should see `[Mobile Console]` messages

### What You'll See:

- **Green text** = Regular logs (`console.log`)
- **Red text** = Errors (`console.error`)
- **Yellow text** = Warnings (`console.warn`)

---

## Method 4: Add Console Button Manually (Temporary Fix)

If the console button isn't showing, you can add it manually:

1. Open the site on your iPhone
2. In the address bar, type: `javascript:` then paste this:

```javascript
(function(){
  const btn = document.createElement('button');
  btn.textContent = '📱 Console';
  btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:10000;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:5px;';
  btn.onclick = () => {
    const console = document.getElementById('mobileConsole');
    if(console) console.style.display = console.style.display === 'none' ? 'block' : 'none';
  };
  document.body.appendChild(btn);
  alert('Console button added!');
})();
```

3. Tap "Go" - this will add the console button

---

## Quick Test: Check if Console is Working

1. Open the site on your iPhone
2. Look for these messages in the console (if using Method 1 or 2):
   - `[Mobile Console] Mobile device detected...`
   - `[Mobile Console] On-screen console initialized...`
   - `[Mobile Console] TEST ERROR - If you see this, console is working!`

3. If you see these messages, the console is working!

---

## Troubleshooting

### "I don't see the Develop menu in Safari"
- Make sure you enabled it: Safari → Preferences → Advanced → "Show Develop menu"

### "My iPhone doesn't appear in Develop menu"
- Make sure Web Inspector is enabled on iPhone
- Make sure iPhone is unlocked
- Try unplugging and replugging the USB cable
- Make sure you trust the computer on iPhone

### "I don't see the console button on my iPhone"
- Hard refresh the page (pull down)
- Check bottom-right corner
- Try scrolling to make sure you're at the top
- The button only appears on mobile devices (iPhone/iPad)

### "Console is empty"
- Try interacting with the page (click buttons, select repo)
- Errors and logs appear as you use the app
- Look for messages starting with `[HELIOS]`, `[Repo Selection]`, `[Visualization]`

---

## What to Look For

When debugging, check for:

1. **Errors starting with `[HELIOS]`** - Application errors
2. **Errors starting with `[Repo Selection]`** - Repository processing issues
3. **Errors starting with `[Visualization]`** - Visualization problems
4. **Errors starting with `[ZIP]`** - ZIP file processing issues
5. **"Failed to resolve module"** - Module loading problems
6. **"User activation lost"** - Button click issues
7. **"Graphology module not available"** - Worker initialization issues

---

## Recommended: Use Safari Web Inspector (Method 1)

**Best option if you have a Mac:**
- Full DevTools with console, network, elements, etc.
- Real-time debugging
- Can set breakpoints
- Can inspect elements
- Most powerful debugging tool

**If you don't have a Mac:**
- Use the on-screen console (Method 3)
- It should appear automatically on mobile
- Tap "📱 Console" button to view logs

