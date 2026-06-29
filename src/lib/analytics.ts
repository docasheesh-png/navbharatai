// 12.2 — Lightweight analytics event tracker (PostHog-style, no 3rd-party lib)

import { hasAnalyticsConsent } from './consent';

const SESSION_ID = Math.random().toString(36).slice(2);

export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!import.meta.env.PROD) return;
  // P-UX.1 — GDPR/DPDP: do not fire non-essential analytics until the user has consented.
  if (!hasAnalyticsConsent()) return;
  try {
    const userId = localStorage.getItem('navbharat_uid') || undefined;
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props, userId, sessionId: SESSION_ID, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}
