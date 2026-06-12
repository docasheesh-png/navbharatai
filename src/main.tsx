import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BuildProvider } from './components/ide/BuildContext';

if (import.meta.env.PROD) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

// 8.6 PWA — register service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// 12.1 — Global error tracking (reports unhandled errors to backend)
if (import.meta.env.PROD) {
  window.addEventListener('error', (e) => {
    fetch('/api/logs/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: e.message,
        source: e.filename,
        line: e.lineno,
        col: e.colno,
        stack: e.error?.stack?.slice(0, 2000),
        url: window.location.href,
        ts: Date.now(),
      }),
    }).catch(() => {});
  });
  window.addEventListener('unhandledrejection', (e) => {
    fetch('/api/logs/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(e.reason),
        type: 'unhandledrejection',
        url: window.location.href,
        ts: Date.now(),
      }),
    }).catch(() => {});
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
    <BuildProvider>
      <App />
    </BuildProvider>
  </StrictMode>,
);
