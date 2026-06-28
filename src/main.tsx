import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BuildProvider } from './components/ide/BuildContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { offlineQueue, installOfflineQueueFlush } from './lib/offlineQueue';

// Top-level crash fallback — guarantees the app NEVER shows a full white page.
// Any uncaught render error anywhere in the tree lands here with a recovery option.
const RootFallback = (
  <div style={{
    position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0d1117', fontFamily: 'system-ui, sans-serif', padding: 24,
  }}>
    <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', background: '#161b22', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 20, padding: 28 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 12 }}>Something interrupted the app</h2>
      <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Your work is safe. Reload to continue where you left off.</p>
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

// Motion preference (default: animations ON). The OS prefers-reduced-motion is NOT auto-applied;
// users opt into reduced motion via Settings → General → "Reduce Animations". Apply the saved
// choice as early as possible so there's no flash of motion before React mounts.
try {
  if (localStorage.getItem('navbharat_reduce_motion') === 'true') {
    document.documentElement.classList.add('nb-reduce-motion');
  }
} catch { /* storage unavailable — default to animations on */ }

// Chunk load error recovery — new deployment invalidates old Vite chunks.
// When a lazy import 404s, force a hard reload ONCE to pick up the new bundle.
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '');
  if (msg.toLowerCase().includes('importing a module script failed') ||
      msg.toLowerCase().includes('failed to fetch dynamically imported module') ||
      msg.toLowerCase().includes('error loading chunk')) {
    const RELOAD_KEY = 'navbharat_chunk_reload';
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    }
  }
});

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

// 12.3 — Core Web Vitals measurement via PerformanceObserver
if (import.meta.env.PROD && typeof PerformanceObserver !== 'undefined') {
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={RootFallback}>
      <BuildProvider>
        <App />
      </BuildProvider>
    </ErrorBoundary>
  </StrictMode>,
);
