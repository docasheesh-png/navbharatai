import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installDomTranslateGuard } from './lib/domTranslateGuard';
import { clampFontScale, FONT_SCALE_STORAGE_KEY } from './lib/a11y';
import { installZoomLock } from './lib/zoomLock';

// FIRST, before React touches the DOM: make removeChild/insertBefore resilient so Google Translate (Chrome's
// "Translate to Hindi", very common on this India-facing app) can't crash React with "Failed to execute
// 'insertBefore' on 'Node' … not a child of this node". Keeps translation working instead of disabling it.
installDomTranslateGuard();

// NO PINCH-ZOOM (admin 2026-08-24: "do unglio se jaise webpage zoom karte hai woh zoom app me nahi
// hona chahiye"). Installed here rather than in the native-shell block below on purpose: the CSS and
// meta-tag layers of this already apply everywhere, and every other native-feel fix in index.css
// (tap-highlight, pull-to-refresh, rubber-band) is global too — gating only this one to Capacitor
// would leave the installed PWA behaving differently from the store build for no reason anyone could
// state. On desktop it is inert: `gesturestart` is a touch/trackpad-pinch event, and ctrl+wheel and
// the browser's own zoom are deliberately untouched. See src/lib/zoomLock.ts.
installZoomLock(typeof document !== 'undefined' ? document : null);
import { BuildProvider } from './components/ide/BuildContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { offlineQueue, installOfflineQueueFlush } from './lib/offlineQueue';
import { SW_UPDATE_MIN_INTERVAL_MS, shouldCheckForUpdate } from './swUpdateCheck';
import { ConsentBanner } from './components/ConsentBanner';
import { InviteAcceptGate } from './components/InviteAcceptGate';
import { SharePortal } from './components/SharePortal';
import { MobileEngagementGate } from './components/MobileEngagementGate';
import { hasAnalyticsConsent, CONSENT_EVENT } from './lib/consent';
import { isChunkLoadError, shouldReloadForStaleChunk } from './lib/chunkReload';
import { installNativeApiRewrite, isNativeShell } from './lib/apiBase';
import { initMetaPixel, fetchPixelIdFromServer } from './lib/metaPixel';
import { installNativeShellPolish, loadNativeShellContext } from './lib/nativeShell';

// Top-level crash fallback — guarantees the app NEVER shows a full white page.
// Any uncaught render error anywhere in the tree lands here with a recovery option.
const RootFallback = (
  <div style={{
    position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface-base)', fontFamily: 'system-ui, sans-serif', padding: 24,
  }}>
    <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', background: 'var(--surface-card)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 20, padding: 28 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <h2 style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 12 }}>Something interrupted the app</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>Your work is safe. Reload to continue where you left off.</p>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: 18, padding: '10px 20px', background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer' }}
      >
        Reload App
      </button>
    </div>
  </div>
);

if (import.meta.env.PROD) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

// Accessibility preferences (P-DESIGN.3) — apply the saved motion + font-scale choices as early as
// possible so there's no flash before React mounts. Motion is a tri-state ('animated' default |
// 'reduced' | 'system'); the legacy 'navbharat_reduce_motion' boolean is honoured for older clients.
// Animations remain ON by default — 'system' only reduces motion when the OS explicitly asks for it.
try {
  const mode = localStorage.getItem('navbharat_motion_mode');
  const sysReduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduce =
    mode === 'reduced' ? true :
    mode === 'animated' ? false :
    mode === 'system' ? sysReduce :
    localStorage.getItem('navbharat_reduce_motion') === 'true'; // legacy fallback
  if (reduce) document.documentElement.classList.add('nb-reduce-motion');

  // The clamp comes from a11y.ts — the ONE definition of the safe range. It used to be re-implemented
  // here with 0.9/1.4 inlined, so widening the range in a11y.ts would have left this boot path pinning
  // every user back to 140 % until React hydrated (a visible jump, and a setting that looked ignored).
  const fontScale = parseFloat(localStorage.getItem(FONT_SCALE_STORAGE_KEY) || '1');
  if (Number.isFinite(fontScale) && fontScale !== 1) {
    document.documentElement.style.setProperty('--nb-font-scale', String(clampFontScale(fontScale)));
  }
} catch { /* storage unavailable — default to animations on, font-scale 1 */ }

// Chunk load error recovery — a new deployment content-hashes old Vite chunks, so a tab opened before
// the deploy requests a chunk URL that no longer exists → blank screen / dead feature. Reload once to
// pick up the fresh bundle. Uses a TIMESTAMPED flag (not a permanent per-session flag): the flag is
// cleared once the app successfully mounts (see below), so a long-open tab recovers on EVERY deploy —
// not just the first — while the cooldown guarantees a still-broken build can never spin in a loop.
const CHUNK_RELOAD_KEY = 'navbharat_chunk_reload_at';
function recoverFromStaleChunk(): void {
  try {
    const lastRaw = localStorage.getItem(CHUNK_RELOAD_KEY);
    const last = lastRaw ? Number(lastRaw) : null;
    if (shouldReloadForStaleChunk(Date.now(), Number.isFinite(last as number) ? last : null)) {
      localStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  } catch { /* storage unavailable — best effort */ }
}
window.addEventListener('unhandledrejection', (e) => {
  if (isChunkLoadError(e.reason)) recoverFromStaleChunk();
});
// Vite's dedicated event for a failed dynamic import preload — fires even when the rejection is handled,
// so the unhandledrejection listener above would otherwise miss it.
window.addEventListener('vite:preloadError', () => recoverFromStaleChunk());

// Bundled native shell transport layer (Capacitor): install the fetch/XHR rewriter to redirect
// site-relative `/api/*` URLs to the production origin when running in bundled mode. NO-OP on the web
// and in today's hosted shell (origin already correct). Must run early, before any component/library
// makes its first API call.
installNativeApiRewrite(window);

// 8.6 PWA — register service worker, and AUTO-UPDATE: when a freshly deployed
// service worker takes control, reload once so the user is never stuck on stale
// code after a deploy (this was causing "my changes don't show up").
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Proactively check for a new SW on each load.
      reg.update().catch(() => {});
      // B8 (audit Batch 5): a tab left OPEN across a deploy kept serving the STALE bundle because the
      // SW was only checked once (here, at load) — the exact "my changes don't show up / #973 still
      // dead" the admin hit, made the COMMON case by sticky sessions that keep the tab open for a long
      // time. Re-check for a new SW periodically AND whenever the tab regains focus (phone back on /
      // tab refocus), throttled so rapid switches don't hammer it. A found update → the SW's
      // skipWaiting/activate → controllerchange → the reload above fires automatically, so a deploy is
      // picked up within ~a minute instead of "never until a manual hard-refresh".
      let lastCheckMs = Date.now();
      const checkForUpdate = () => { lastCheckMs = Date.now(); reg.update().catch(() => {}); };
      setInterval(checkForUpdate, SW_UPDATE_MIN_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && shouldCheckForUpdate(lastCheckMs, Date.now())) checkForUpdate();
      });
    }).catch(() => {});
  });
}

// 12.1 — Global error tracking (reports unhandled errors to backend).
// P3.2 — routed through the offline queue: if a report fails because the device is
// offline, it is buffered and replayed on reconnect (these endpoints are allowlisted
// as safe to replay). installOfflineQueueFlush() drives the reconnect replay.
if (import.meta.env.PROD) {
  installOfflineQueueFlush();
  window.addEventListener('error', (e) => {
    void offlineQueue.postWithFallback('/api/logs/error', JSON.stringify({
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack?.slice(0, 2000),
      url: window.location.href,
      ts: Date.now(),
    }));
  });
  window.addEventListener('unhandledrejection', (e) => {
    void offlineQueue.postWithFallback('/api/logs/error', JSON.stringify({
      message: String(e.reason),
      type: 'unhandledrejection',
      url: window.location.href,
      ts: Date.now(),
    }));
  });
}

// 12.3 — Core Web Vitals measurement via PerformanceObserver.
// P-UX.1 — GDPR/DPDP: this is non-essential telemetry, so it only starts once the user has granted
// analytics consent. `buffered: true` means metrics emitted before init (e.g. LCP) are still
// captured when the user accepts mid-session. Guarded so it inits at most once.
let webVitalsStarted = false;
function initWebVitals() {
  if (webVitalsStarted) return;
  if (!(import.meta.env.PROD && typeof PerformanceObserver !== 'undefined')) return;
  if (!hasAnalyticsConsent()) return;
  webVitalsStarted = true;
  try {
    // LCP
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lcp = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'web_vital', props: { name: 'LCP', value: Math.round(lcp.startTime), unit: 'ms' }, ts: Date.now() }),
      }).catch(() => {});
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // CLS
    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!e.hadRecentInput) clsValue += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'web_vital', props: { name: 'CLS', value: +clsValue.toFixed(4), unit: 'score' }, ts: Date.now() }),
        }).catch(() => {});
      }
    }, { once: true });

    // FID / INP
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { processingStart: number; startTime: number };
        const fid = e.processingStart - e.startTime;
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'web_vital', props: { name: 'FID', value: Math.round(fid), unit: 'ms' }, ts: Date.now() }),
        }).catch(() => {});
      }
    }).observe({ type: 'first-input', buffered: true });
  } catch {}
}

// Start web-vitals now if consent was granted in a previous session, and also when the user accepts
// via the banner this session (the consent module dispatches CONSENT_EVENT on change).
initWebVitals();
window.addEventListener(CONSENT_EVENT, () => initWebVitals());

// META ADVERTISING PIXEL — the WEB half of Facebook/Instagram conversion measurement, started on
// exactly the same consent gate as web-vitals above and, like it, re-attempted when the user accepts
// mid-session. It is inert unless the server reports a configured META_PIXEL_ID, and it deliberately
// never runs inside the installed native app (the Facebook Android SDK reports the app's own events;
// running both would count one person twice). All of those conditions are decided inside
// initMetaPixel — see src/lib/metaPixel.ts for why each one exists.
const startMetaPixel = () => {
  void initMetaPixel({
    hasConsent: hasAnalyticsConsent,
    isNative: () => isNativeShell(window as never),
    isProd: import.meta.env.PROD,
    fetchPixelId: fetchPixelIdFromServer,
  });
};
startMetaPixel();
window.addEventListener(CONSENT_EVENT, startMetaPixel);

// NOTE: the public /sonic experiment route was removed (admin 2026-07-15) to close a misuse vector —
// an unauthenticated, discoverable voice page. The voice capability itself is NOT deleted: it lives on
// inside the professional chats as the gated ProfessionalVoiceButton (paid, signed-in only), which mounts
// the same SonicChat widget on demand. So /sonic now just loads the normal app (SPA catch-all → Home).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={RootFallback}>
      <BuildProvider>
        <App />
        <ConsentBanner />
        <InviteAcceptGate />
        <SharePortal />
        <MobileEngagementGate />
      </BuildProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// The app shell mounted successfully → the current bundle is good, so clear the stale-chunk reload flag.
// This is what lets a long-open tab recover on EVERY future deploy (not just the first): the next stale
// chunk after the next deploy gets a fresh one-time reload. A build that never mounts leaves the flag set,
// so a genuinely-broken deploy still can't loop.
requestAnimationFrame(() => {
  try { localStorage.removeItem('navbharat_chunk_reload_at'); } catch { /* best effort */ }

  // Bundled native shell polish (Capacitor): hide splash screen, apply status bar theme, install
  // back button handler. Runs after React mounts so the back button handler can navigate. NO-OP
  // on web and hosted shell.
  // Pass the REAL plugin context. This used to hand over `window`, but Capacitor 4+ does not expose
  // plugins as window globals — so every polish feature silently no-opped (no splash control, no
  // status-bar theme, no haptics and, most visibly on Android, no hardware Back handling at all).
  void loadNativeShellContext()
    .then((ctx) => installNativeShellPolish(ctx, () => {
      // Somewhere to go back to → go. (A genuinely empty back stack is handled inside the installer,
      // which exits the app rather than trapping the user on the screen.)
      window.history.back();
    }))
    .catch(() => { /* polish is best-effort — it must never block the app from starting */ });
});
