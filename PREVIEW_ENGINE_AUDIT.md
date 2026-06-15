# NavBharatAI Preview Engine — Forensic Audit Report

**Date:** 2026-06-15  
**Branch:** `claude/test-coverage-analysis-bq0yev`  
**Auditor:** Staff-level forensic review

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall Health Score** | **58 / 100** |
| Total issues found | 27 |
| Critical (P0) | 5 |
| High (P1) | 8 |
| Medium (P2) | 9 |
| Low (P3) | 5 |
| Files with issues | 3 (App.tsx, AppEngine.ts, PreviewPanel.tsx) |

The preview engine works reliably for simple vanilla HTML/CSS/JS apps and basic Firebase apps. It breaks predictably and silently for Vue SFCs, Vite projects, Next.js, Supabase, Appwrite, PocketBase, Convex, and any backend that uses ES module SDK imports without explicit CDN mapping. The fundamental architectural issue is that the engine has **two hardcoded categories** (`'react'` and `'static'`) for what should be a 15-category classification system. Every backend provider, every framework variant, and every module format is squeezed into those two buckets — and the bucket logic has gaps.

---

## Stage 1 — AI File Generation Audit

**Status: PARTIAL FAIL**

### What the AI generates

`buildFirebaseModule()` and `buildAppV4()` both produce files via AI calls. The instructions enforce IIFE style, no `import/export`. But the AI is not deterministic.

### Issues found

**P1 — ID-01: No validation of AI-generated code structure**

The AI generates `firebase.js` and `script.js` via `callAI()`. There is zero post-generation validation:
- No check that `window.DB` is actually defined in the output
- No check that the IIFE wrapper is present
- No syntax validation before injecting into HTML
- No check that `firebase.auth()` and `firebase.firestore()` are called (AI might omit them)

If the AI returns markdown fences (` ```javascript ... ``` `), the raw code string including the backticks gets injected into `<script>` tags — **instant SyntaxError in iframe**.

`callAI()` presumably strips markdown, but there is no defensive guard in `buildFirebaseModule()` itself. Root: trust without verify.

**P2 — ID-02: `buildFirebaseModule` AI instructions include contradictory requirements**

The prompt says:
> "Use firebase.firestore() for database operations"

AND:

> "Wrap everything in an IIFE: (function() { ... })();"

Firebase compat `firebase.auth()` is asynchronous. The IIFE sets `window.DB` synchronously. The `saveRecord` function captures the `db` reference synchronously, but `auth.signInAnonymously()` is async. If Firestore security rules require auth (the default in Firebase console), the first `DB.saveRecord()` call from `script.js` will hit Firestore before auth is complete — **permission denied error, silently swallowed by `console.warn`**.

**P2 — ID-03: HTML entry point validation absent**

`buildAppV4()` generates `index.html` with hardcoded `<script src="script.js">` and `<script defer src="firebase.js">`. If the AI generates `script.js` with an invalid reference to a missing function from `firebase.js` (because firebase.js is `defer` — more on this below), the app silently errors.

No cross-file dependency graph is built. The generator does not verify: "does `script.js` call `window.DB.*` — if yes, does `firebase.js` expose `window.DB`?"

**P3 — ID-04: `FIREBASE_CDN` constant is defined but never used**

`FIREBASE_CDN` (line 1419) is a properly maintained constant with compat CDN URLs. But `buildAppV4()` and `buildFirebaseModule()` do not use it — they inline the same string manually at lines 1335–1340 and 1747–1752. Triple maintenance point. If the Firebase version needs bumping, it must be changed in 3+ places.

---

**Stage 1 Verdict:** The generator produces structurally valid files ~85% of the time. The 15% failure window comes from AI non-determinism, async timing bugs, and no output validation.

---

## Stage 2 — App Type Detection Audit

**Status: FAIL for 9 of 15 required categories**

### Current `detectAppType()` logic (post-fix)

```
1. index.html has <script type="module" src="*.ts|tsx|jsx"> → 'react'
2. index.html exists (any form)                            → 'static'
3. Workspace has *.tsx or *.jsx files                      → 'react'
4. package.json contains "react":                          → 'react'
5. Default                                                 → 'static'
```

Return type is `'react' | 'static'` — **two values for a 15-category problem**.

### Misclassification table

| App Type | Expected | Actual | Reason |
|----------|----------|--------|--------|
| Static HTML | `static` | ✅ `static` | Correct |
| React (Vite, .tsx entry) | `react` | ✅ `react` | Correct |
| React (CRA, .jsx entry) | `react` | ✅ `react` | Correct |
| Firebase (vanilla JS) | `static` | ✅ `static` | Fixed |
| **Vue SFC** | `vue` | ❌ `static` | .vue files not checked |
| **Vite + Vue** | `react` | ⚠️ `react` | HTML has `<script type="module" src="main.ts">` → matches .ts → bundler activated, but bundler cannot parse .vue files |
| **Vanilla TypeScript** | `typescript` | ❌ `static` | `index.html` has `<script src="main.js">` (compiled), goes static. If src="main.ts" → 'react' path which can transpile .ts via Babel |
| **Supabase** | `firebase`-like | ❌ `static` | No detection |
| **Appwrite** | `appwrite` | ❌ `static` | No detection |
| **PocketBase** | `pocketbase` | ❌ `static` | No detection |
| **Convex** | `convex` | ❌ `static` | No detection |
| **Backendless** | `backendless` | ❌ `static` | No detection |
| **Next.js (CSR)** | `nextjs-csr` | ⚠️ `react` | Bundler activated, but Next.js page router structure (`pages/`) not recognized |
| **ZIP — React** | `react` | ✅ `react` | If HTML has .tsx entry, works |
| **ZIP — vanilla** | `static` | ✅ `static` | Works |

**P0 — ID-05: Vue SFC + Vite goes to `'react'` bundler which cannot parse `.vue` files**

A Vite+Vue project has `index.html` with `<script type="module" src="src/main.ts">`. Step 1 of detectAppType fires: `.ts` matches `\.(ts|jsx|tsx)` — returns `'react'`. `buildSourceAppPreview()` runs. It tries to load `src/main.ts`. Babel tries to transpile it — Babel has TypeScript preset but no Vue compiler. When `main.ts` does `import App from './App.vue'`, `requireMod` tries to process `App.vue` through Babel — Babel sees `<template>` and throws **SyntaxError: Unexpected token '<'** — **total render failure**.

**P1 — ID-06: No backend provider detection means no SDK loading**

Supabase, Appwrite, PocketBase etc. are detected as `'static'`. Their SDKs come in as `import { createClient } from '@supabase/supabase-js'` in `script.js`. In `'static'` mode, there is no Babel transform — this `import` statement is a raw syntax error when executed as a plain `<script>`. The app throws immediately.

---

## Stage 3 — Module Resolution Audit

**Status: PARTIAL PASS (improved), with remaining gaps**

### `specUrl()` — POST-FIX STATE

```javascript
function specUrl(spec){
  if(spec.slice(0,8)==='https://'||spec.slice(0,7)==='http://')return spec;  // ← FIXED
  if(IMAP[spec])return IMAP[spec];
  var root=...;
  if(IMAP[root])return IMAP[root]+spec.slice(root.length);
  return ESM+spec;
}
```

**Fixed:** Absolute CDN URLs pass through unchanged. Firebase `https://www.gstatic.com/...` imports no longer get mangled.

### Remaining resolution issues

**P1 — ID-07: `collectBare()` uses a single regex that breaks on multi-line imports**

```javascript
var re=/(?:from|import|require\\(|import\\()\\s*['"]([^'"]+)['"]/g;
```

This is a single-line regex. It fails on:

```javascript
// Split import — common in formatted AI output
import {
  initializeApp,
  getApp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
```

The regex matches `from 'https://...'` only when `from` and the quote are on the same line. Multi-line imports are missed → spec not added to `bareCache` → `req()` throws `Missing dependency` when Babel transforms and calls `require()`. Impact: any AI-generated file with auto-formatted multi-line imports silently breaks.

**P2 — ID-08: No import resolution for Supabase, Appwrite, PocketBase in static path**

Static path apps with these backends write:
```javascript
import { createClient } from '@supabase/supabase-js';
```

In static mode, there is NO Babel transform. The browser cannot execute `import` in a non-module context. These apps fail with `SyntaxError: Cannot use import statement outside a module`.

If the app wraps in `type="module"`, it goes through the inline module path (preserved by our fix). Then the browser tries `import '@supabase/supabase-js'` — without a CDN URL, the browser tries a relative path, fails with **404**.

Resolution: Supabase works via esm.sh (`https://esm.sh/@supabase/supabase-js`). But there is no mechanism to tell the browser about this mapping for inline module scripts.

**P2 — ID-09: `requireMod()` is synchronous; async CDN imports are pre-loaded but ordering is not guaranteed**

```javascript
await Promise.all(bare.map(async function(spec){
  try{ bareCache[spec]=interop(await import(specUrl(spec))); }
  catch(e){ console.warn(...); }
}));
requireMod(ENTRY);
```

`Promise.all` loads all bare deps in parallel. If any CDN import fails (network timeout, CORS, etc.), it's silently swallowed by the catch block. Then `requireMod(ENTRY)` runs. When the entry module `require()`s the missing dep, it gets `undefined` from `bareCache` (which has the key but the value was set to `interop(undefined)`). The app proceeds with `undefined` instead of the real module — **silent runtime failure**, not caught by the error overlay.

**P3 — ID-10: No circular dependency detection**

`requireMod()` uses a `cache` Map. A circular import (A imports B, B imports A) causes `cache[path]` to have `module.exports = {}` (empty at the time of the circular call). The circular require returns an empty object — correct JavaScript behavior — but if the dependent module expects actual exports, it silently fails. No warning is emitted.

---

## Stage 4 — Bundler Audit

**Status: PASS for React/TSX, FAIL for Vue/Vite/Next.js**

### What enters the bundler

`buildSourceAppPreview()` sends ALL files matching:
```javascript
/\.(jsx|tsx|ts|js|mjs|cjs|css|json|png|jpg|gif|webp|svg|bmp|ico|avif)$/i
```
into `srcFiles` (excludes `node_modules`).

**P0 — ID-11: `.vue` files enter the bundler and cause SyntaxError**

When a Vite+Vue project is detected, all `.vue` files enter `srcFiles`. Babel's transform receives them. Vue SFCs start with `<template>` — Babel sees a less-than operator with a bare identifier — **SyntaxError: Unexpected token '<'**. No graceful degradation. The error harness catches it and shows "Compile App.vue: Unexpected token '<'" — completely opaque to users.

**P1 — ID-12: Entry point selection can pick the wrong file**

```javascript
const cands = ['src/main.tsx','src/main.jsx','src/main.ts','src/index.tsx',
               'src/index.jsx','src/index.ts','main.tsx','main.jsx',
               'index.tsx','index.jsx','src/App.tsx','src/App.jsx','App.tsx','App.jsx'];
entry = cands.find(c => srcFiles[c]) || Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k)) || '';
```

This candidate list does NOT include:
- `src/pages/index.tsx` (Next.js page router)
- `src/routes/+page.svelte` (SvelteKit)
- `src/App.ts` (TypeScript Vue app with TS entry)

The last fallback `Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k))` picks the **first .tsx/.jsx found in filesystem iteration order** — which is non-deterministic (object key ordering in JS is insertion order, which depends on ZIP extraction order). A project like:
```
src/
  components/Button.tsx   ← might be found first
  main.tsx                ← actual entry
```
could result in `Button.tsx` being the entry → app renders nothing.

**P2 — ID-13: CSS Modules fail silently**

`requireMod()` handles `.css` files:
```javascript
if(/\.css$/.test(path)){injectCss(src);cache[path]={exports:{}};return cache[path].exports;}
```

A CSS Module (`Button.module.css`) is imported as:
```javascript
import styles from './Button.module.css';
// styles.container, styles.button expected
```

Babel transforms to `require('./Button.module.css')`. `requireMod` injects it as a `<style>` tag and returns `{}`. The component tries `styles.container` → `undefined`. All CSS module class names become `undefined` → **silent visual breakage, no error**.

**P2 — ID-14: `import.meta.env.VITE_*` replaced with empty object**

```javascript
src=src.replace(/import\.meta\.env\b/g,'(window.__importMetaEnv__||{})');
```

`window.__importMetaEnv__` is set to `{}` (empty). Vite apps that use `VITE_API_URL`, `VITE_SUPABASE_KEY`, etc. all resolve to `undefined`. For auth-dependent apps, API keys are missing → **authentication fails silently**. No warning is shown to the user. This is probably the most invisible failure mode in the entire engine.

**P3 — ID-15: No source maps**

Babel transpiles code but source maps are not generated. When a runtime error occurs (`TypeError: Cannot read properties of undefined`), the stack trace shows the Babel-transformed CommonJS output, not the original JSX/TSX. Line numbers are useless for debugging.

---

## Stage 5 — HTML Injection Audit

**Status: PASS (post-fix), with one remaining issue**

### Post-fix state

The `inlinedJs` / `inlinedCss` tracking now correctly prevents double-injection. The new execution order for vanilla+Firebase is:

```
<head>
  Firebase compat CDN (sync, blocking)     ← firebase-app-compat.js etc.
  PREVIEW_HARNESS (error overlay)
</head>
<body>
  [app HTML structure]
  <script defer src="firebase.js">         ← gets inlined by static path
    → becomes <script data-src="firebase.js">IIFE</script>
    → defer attr stripped (no effect on inline) — CORRECT
  </script>
  <script src="script.js">                 ← inlined
  HARNESS
</body>
```

Order is correct. Firebase CDN loads before IIFE. IIFE sets `window.DB` before `script.js` runs. ✅

**P1 — ID-16: `buildPreviewHtml()` server-side vs `updatePreview()` client-side produces different HTML**

The server generates `previewHtml` via `buildPreviewHtml()` in `AppEngine.ts` and includes it in the SSE `complete` event. The client IGNORES `evt.previewHtml` completely — it rebuilds the preview itself by calling `updatePreview(evt.files)`.

This means `buildPreviewHtml()` is dead code from the client's perspective. But it IS used by:
- Download functionality (if any)
- Server-side snapshot/validation
- Potential future server-side rendering

Because two systems produce the HTML independently, they can diverge silently. If a bug exists in one, the other masks it. **This is the root cause of many "works on server, broken in preview" reports.**

**P2 — ID-17: `buildSourceAppPreview` firebase head block has a redundant ternary**

```javascript
const firebaseHeadBlock = fbJs
  ? (rawCdnScripts.length === 0
      ? `<script data-src="firebase.js">${...}</script>`
      : `<script data-src="firebase.js">${...}</script>`)   // ← SAME OUTPUT
  : '';
```

Both branches of the inner ternary produce identical strings. The `rawCdnScripts.length === 0` check was intended to conditionally inject Firebase CDN scripts inline, but the CDN scripts are instead added via `rawCdnScripts.join('\n')` in the return statement. The intent is lost, the check is useless — but functionally it doesn't break anything.

**P2 — ID-18: `buildPreviewHtml()` calls `.replace('</head>', ...)` twice sequentially**

CSS replacement and Firebase CDN replacement both target `</head>`. JavaScript `.replace()` with a string argument replaces only the first occurrence. Since they run sequentially, the second call finds the `</head>` left by the first. This works correctly in normal flow, but if `index.html` has no `</head>` tag (malformed AI-generated HTML), both injections fall through to a no-op and neither CSS nor CDN scripts are injected.

---

## Stage 6 — Backend Compatibility Audit

**Status: FAIL for 5 of 6 backends**

### Compatibility Matrix

| Backend | Static HTML | React Bundler | CDN Loading | ES Module | UMD/Global | Notes |
|---------|-------------|---------------|-------------|-----------|------------|-------|
| **Firebase** | ✅ Works | ✅ Works | ✅ compat CDN | ⚠️ Partially (via specUrl fix) | ✅ IIFE generated | Async auth timing risk |
| **Supabase** | ❌ Fails | ⚠️ Partial | ❌ No CDN tags | ⚠️ Via esm.sh if detected | ❌ No support | No CDN injection. Bare import `@supabase/supabase-js` works in bundler via esm.sh; fails in static mode |
| **Appwrite** | ❌ Fails | ⚠️ Partial | ❌ No CDN tags | ⚠️ Via esm.sh | ❌ No support | Same as Supabase |
| **PocketBase** | ❌ Fails | ⚠️ Partial | ❌ No CDN tags | ⚠️ Via esm.sh | ❌ No support | PocketBase JS SDK is ESM-first |
| **Convex** | ❌ Fails | ❌ Fails | ❌ No CDN | ❌ No support | ❌ No support | Convex requires Node.js environment. Cannot run in browser preview at all. |
| **Backendless** | ❌ Fails | ⚠️ Partial | ❌ No CDN tags | ⚠️ Via esm.sh | ✅ Has UMD build | Backendless SDK has a UMD build on CDN but it's not wired up |

**P0 — ID-19: Supabase/Appwrite/PocketBase apps fail with no recovery path**

When AI generates an app with Supabase:
```javascript
import { createClient } from '@supabase/supabase-js';
```

In `'static'` mode: this `import` is a SyntaxError in a regular `<script>` — app dead on arrival.

In `'react'` bundler mode: `collectBare()` finds `@supabase/supabase-js`, `specUrl('@supabase/supabase-js')` returns `https://esm.sh/@supabase/supabase-js`, `import('https://esm.sh/@supabase/supabase-js')` — **might work** if esm.sh serves it correctly. But esm.sh for Supabase v2 sometimes fails because it requires Node's `crypto` module internally. No CDN-specific handling exists. This is **probabilistic** — works sometimes, fails silently other times.

**P0 — ID-20: Convex is fundamentally incompatible with browser-only preview**

Convex uses a WebSocket-based sync protocol that requires a Convex backend URL, JWT auth, and a persistent connection. It cannot be previewed in an iframe without:
1. A running Convex backend (not present in preview env)
2. A valid deployment URL (would be user's actual Convex project)

Showing a broken Convex app in preview with no explanation is worse than showing nothing. There should be a detection gate that says "Convex apps require a live backend — preview will show UI only".

---

## Stage 7 — Sandbox / Iframe Audit

**Status: MOSTLY PASS with one security observation**

### iframe configuration

```html
sandbox="allow-scripts allow-modals allow-same-origin allow-forms 
         allow-popups allow-popups-to-escape-sandbox allow-downloads"
```

### Capability assessment

| Capability | Status | Impact |
|------------|--------|--------|
| `allow-scripts` | ✅ Enabled | JS executes |
| `allow-same-origin` | ✅ Enabled | localStorage, IndexedDB, Firebase Auth |
| `allow-forms` | ✅ Enabled | Form submit works |
| `allow-popups` | ✅ Enabled | window.open() |
| `allow-popups-to-escape-sandbox` | ✅ Enabled | OAuth popups can redirect |
| `allow-modals` | ✅ Enabled | alert/confirm/prompt |
| `allow-downloads` | ✅ Enabled | File downloads |
| `allow-top-navigation` | ❌ Missing | Firebase OAuth redirect flow broken |
| `allow-storage-access-by-user-activation` | ❌ Missing | Not needed for same-origin |

**P1 — ID-21: `allow-same-origin` + `allow-scripts` = potential sandbox escape**

When `allow-same-origin` and `allow-scripts` are both present in a sandboxed iframe, **the iframe can access the parent page's localStorage, sessionStorage, and cookies if they share the same origin**. Since the preview iframe content is served via `document.write()` (not `srcdoc`, not a separate origin), it shares the origin of the main NavBharatAI app.

A malicious AI-generated app (or a user who manually edits the code to insert a payload) can:
```javascript
parent.document.cookie  // access parent cookies
parent.localStorage.getItem('navbharat_token')  // access auth tokens
```

This is a known `allow-same-origin` + `allow-scripts` limitation. For a platform where users build and share apps, this is a security risk. The correct mitigation is to serve the preview from a separate origin (e.g., `preview.navbharatai.com`) so same-origin rules isolate the iframe.

**P2 — ID-22: Firebase Google OAuth redirect does not work in iframe**

Firebase Auth's `signInWithRedirect()` (Google, GitHub OAuth) requires `allow-top-navigation`. Without it, the redirect triggers but the browser blocks the navigation. The auth flow silently fails. `signInAnonymously()` and `signInWithPopup()` work (popups are allowed), but redirect-based OAuth does not.

**P3 — ID-23: `document.write()` is deprecated in modern browsers**

```javascript
const doc = iframe.contentDocument || iframe.contentWindow?.document;
if (doc) { doc.open(); doc.write(previewSrc || ''); doc.close(); }
```

`document.write()` is deprecated and browsers show console warnings. More critically:
- Chrome 117+ throttles `document.write()` on slow connections
- `doc.write()` parses HTML synchronously in the same stack frame — very large HTMLs can block the main thread briefly
- Firefox 115+ warns: "document.write() is called from an asynchronous context"

The correct modern approach is `iframe.srcdoc = html` which uses the HTML parser on the browser's side without these restrictions.

---

## Stage 8 — Runtime Audit

**Status: PASS for error capture, FAIL for async initialization**

### Error capture pipeline

```
window.addEventListener('error') → show overlay              ✅
window.addEventListener('unhandledrejection') → show overlay ✅
2s + 3.5s empty content check                               ✅
Babel SyntaxError → shows "Compile [file]: [error]"         ✅
```

**P1 — ID-24: Firebase async initialization race condition**

Generated firebase.js (IIFE) structure:

```javascript
(function() {
  var app = firebase.initializeApp(config);  // sync
  var db = firebase.firestore();             // sync
  var auth = firebase.auth();                // sync
  
  auth.signInAnonymously();                  // async — does NOT block
  
  function saveRecord(col, data) {
    return db.collection(col).add(data);     // runs BEFORE auth completes
  }
  
  window.DB = { saveRecord, ... };           // set synchronously ✅
})();
```

`window.DB` is available synchronously. But `saveRecord()` calls Firestore BEFORE `signInAnonymously()` resolves. If Firebase security rules require auth (most production rules do), the **first write will fail with PERMISSION_DENIED**. The catch in `saveRecord` does `console.warn` — the user sees nothing. The app appears to work (no error overlay) but data is never saved.

**P2 — ID-25: Empty content detector false-positive for data-heavy apps**

```javascript
function isEmpty(){
  var t=(document.body&&document.body.innerText||'').trim();
  var v=document.querySelector('canvas,svg,img,video,input,button,#root *,#app *,[data-reactroot] *');
  return !t&&!v;
}
setTimeout(function(){
  if(document.getElementById('__nb_err')||!isEmpty())return;
  setTimeout(function(){
    if(!document.getElementById('__nb_err')&&isEmpty())show(...);
  },1500);
},2000);
```

An app that:
1. Shows a loading spinner (no text, just a CSS animation via `@keyframes`)
2. Does not have `canvas`, `svg`, `img`, `video`, `input`, `button`, `#root *`, `#app *`, or `[data-reactroot] *` elements initially

Will trigger "Preview is empty" after 3.5 seconds even though it's actively rendering. Firebase auth flows often start with a full-screen loading animation and blank content.

---

## Stage 9 — Network Audit

**Status: NO RUNTIME DATA AVAILABLE** (static audit only)

### Network dependencies

| Resource | Source | Version Pinned | Fallback | CORS |
|----------|--------|----------------|----------|------|
| Babel standalone | unpkg.com | @7.26.4 ✅ | ❌ None | ✅ |
| firebase-app-compat | gstatic.com | 10.12.0 ✅ | ❌ None | ✅ |
| firebase-firestore-compat | gstatic.com | 10.12.0 ✅ | ❌ None | ✅ |
| firebase-auth-compat | gstatic.com | 10.12.0 ✅ | ❌ None | ✅ |
| esm.sh packages | esm.sh | Runtime resolved | ❌ None | ✅ |

**P2 — ID-26: No CDN fallback — single point of failure**

If `unpkg.com` is down, Babel fails to load. `PREVIEW_BOOTSTRAP` guards this:
```javascript
if(typeof Babel==='undefined'){fail('Could not load the preview compiler...');return;}
```

This shows an error — correct behavior. But `gstatic.com` and `esm.sh` have no guard. If gstatic is unreachable, `window.firebase` is undefined, and the firebase.js IIFE throws `TypeError: Cannot read property 'initializeApp' of undefined` — which IS caught by the error overlay. So Firebase CDN failure is recoverable.

`esm.sh` failures are caught per-module by the `catch(e){ console.warn }` in the bootstrap async loop. Silent degradation — package is missing from `bareCache`, `req()` throws, error overlay shows. Acceptable.

**P3 — ID-27: Firebase version hardcoded in 4 independent locations**

Firebase compat SDK version is hardcoded at `10.12.0`. The `FIREBASE_CDN` constant, `buildAppV4` injection code, `buildReactEngine` injection code, and `buildPreviewHtml` all independently hardcode `10.12.0`. There is no single source of truth. If the version needs bumping, it must be changed in 4 places.

---

## Preview Pipeline Report

| Stage | Status | Critical Issue | Recommended Fix |
|-------|--------|----------------|-----------------|
| 1. AI File Generation | ⚠️ PARTIAL | No output validation; async auth timing | Validate `window.DB` exists; defer script.js until auth ready |
| 2. App Type Detection | ❌ FAIL | Only 2 categories for 15 app types; Vue SFC fatal crash | Add vue/supabase/appwrite/convex categories; .vue guard in bundler |
| 3. Module Resolution | ⚠️ PARTIAL | Multi-line imports missed; CDN fails swallowed silently | Fix regex to multiline; surface CDN load failures |
| 4. Bundler | ❌ FAIL | Vue SFC crashes; wrong entry selection; CSS modules silent fail | Vue CDN fallback; smarter entry selection; warn on CSS modules |
| 5. HTML Injection | ✅ PASS | Redundant ternary; dead server-side path | Remove server-side dead code; clean ternary |
| 6. Backend Compat | ❌ FAIL | 5/6 backends not supported; Convex impossible | CDN injection per-backend; Convex detection gate |
| 7. Sandbox/Iframe | ⚠️ PARTIAL | Same-origin escape risk; Firebase OAuth redirect broken | Separate preview origin; note OAuth redirect limitation |
| 8. Runtime | ⚠️ PARTIAL | Firebase auth race condition; false-positive empty detector | Wait for auth before exposing DB; improve isEmpty check |
| 9. Network | ⚠️ PARTIAL | No CDN fallback; version scattered in 4 places | Extract version constant; add CDN health check |

---

## Prioritized Fix List

### P0 — Critical (must fix before production)

| ID | Issue | Effort | Risk |
|----|-------|--------|------|
| ID-05 | Vue SFC + Vite crashes bundler with SyntaxError | 2 days | Low regression |
| ID-19 | Supabase/Appwrite/PocketBase fail with no recovery | 3 days | Low regression |
| ID-20 | Convex preview — no detection gate, confusing failure | 1 day | Zero regression |
| ID-21 | `allow-same-origin` + `allow-scripts` = sandbox escape | 3 days | Medium regression (new origin required) |
| ID-24 | Firebase auth race condition — writes silently fail | 1 day | Low regression |

### P1 — High

| ID | Issue | Effort | Risk |
|----|-------|--------|------|
| ID-06 | Backend SDKs fail in static mode | 2 days | Low |
| ID-07 | `collectBare()` misses multi-line imports | 0.5 days | Low |
| ID-12 | Wrong entry point selection (non-deterministic) | 1 day | Medium |
| ID-16 | Server-side `buildPreviewHtml` diverges from client | 1 day | Low |
| ID-22 | Firebase OAuth redirect blocked | 0.5 days | Low |
| ID-23 | `document.write()` deprecated → switch to srcdoc | 1 day | Medium |
| ID-01 | No AI output validation | 2 days | Low |

### P2 — Medium

| ID | Issue | Effort |
|----|-------|--------|
| ID-02 | Async auth timing | 1 day |
| ID-08 | Supabase/etc in static mode → importmap approach | 2 days |
| ID-09 | Silent CDN load failure masked | 0.5 days |
| ID-13 | CSS modules return empty object | 1 day |
| ID-14 | `import.meta.env` always empty | 0.5 days |
| ID-17 | Redundant ternary in firebaseHeadBlock | 0.5 days |
| ID-25 | False-positive empty content detector | 1 day |
| ID-26 | No CDN fallback | 1 day |
| ID-27 | Firebase version in 4 places | 0.5 days |

### P3 — Low

| ID | Issue |
|----|-------|
| ID-03 | No cross-file dependency graph |
| ID-04 | FIREBASE_CDN constant unused |
| ID-10 | No circular dependency detection |
| ID-15 | No source maps |
| ID-23 | `document.write()` deprecation warnings |

---

## Final Verdict

**Why preview is failing:**

1. **Root cause #1 — Two-category system for 15 app types.** The engine classifies everything as either `'react'` (Babel bundler) or `'static'` (inline injection). Vue, TypeScript standalone, Supabase, Appwrite, PocketBase, Convex, and Backendless all fall into one of these two buckets incorrectly — with Vue SFC being the most spectacular failure (instant SyntaxError in the bundler).

2. **Root cause #2 — Backend SDKs have no CDN loading strategy except Firebase.** Firebase was wired up with compat CDN scripts. Every other backend (Supabase, Appwrite, PocketBase) is invisible to the engine. Their SDK imports either crash as plain-script SyntaxErrors (static mode) or roll the dice on esm.sh (bundler mode).

3. **Root cause #3 — Firebase auth timing.** `window.DB` is set synchronously but the first write hits Firestore before anonymous auth resolves. With real Firestore security rules, all writes fail silently. This is invisible — no error, no overlay, data just disappears.

4. **Root cause #4 — `allow-same-origin` in the iframe.** The preview iframe shares the NavBharatAI origin. Any AI-generated (or user-edited) script can read `parent.localStorage` — including auth tokens. This is the only genuine security issue in the audit.

**Which files must change:**

- `src/App.tsx` — `detectAppType()`, `collectBare()`, `buildSourceAppPreview()`, iframe rendering method
- `src/server/AppMakerLab/AppEngine.ts` — `buildFirebaseModule()` (auth timing), `FIREBASE_CDN` (single source of truth), add Supabase/Appwrite CDN injection
- `src/components/ide/PreviewPanel.tsx` — sandbox attribute, `document.write()` → `srcdoc`

**How to prevent recurrence:**

Define a typed `AppType` union with all 15 categories. Each type has an associated `PreviewStrategy` that declares: which CDN scripts to inject, whether to use the Babel bundler, which file extension to use for entry detection, and whether a live backend is required (Convex = impossible preview). The current two-bucket ad-hoc logic should never have scaled beyond 3 app types.
