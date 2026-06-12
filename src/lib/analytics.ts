// 12.2 — Lightweight analytics event tracker (PostHog-style, no 3rd-party lib)

const SESSION_ID = Math.random().toString(36).slice(2);

export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!import.meta.env.PROD) return;
  try {
    const userId = localStorage.getItem('navbharat_uid') || undefined;
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props, userId, sessionId: SESSION_ID, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}
