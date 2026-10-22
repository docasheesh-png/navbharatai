// WAKE THE SERVER WHILE THE PERSON IS STILL TYPING (admin 2026-10-22: "user jaise hi navbharatai open kare, backend warm
// kar ke rakhoge?").
//
// The server runs with no always-on instance (`--min-instances 0`, which is what keeps idle cost at zero), so the first
// request after a quiet period meets a cold start — seconds in which the chat looks dead. `GET /api/warm` (server side,
// src/server/routes/warm.ts) pre-builds everything the first chat message needs and makes NO model call, so it costs nothing
// but a few cached reads. Calling it the moment the app opens, and again when the person comes back to the tab, starts that
// cold start while they are still reading the screen and typing their first message — the wait is spent where they cannot
// feel it.
//
// 🔒 FIRE-AND-FORGET, AND IT NEVER BREAKS ANYTHING. No await, no UI, no error shown; a failure just means the first message
// pays the cold start it would have paid anyway. 🔒 AT MOST ONE CALL EVERY FOUR MINUTES per page (the server also caps real
// work to one run per 30 s), so a tab that flips focus ten times is one request, not ten.

export const WARM_MIN_GAP_MS = 4 * 60 * 1000;

let lastWarmAt = 0;

/** Pure: should a warm request go out now? */
export function shouldWarm(now: number, last: number): boolean {
  return last === 0 || now - last >= WARM_MIN_GAP_MS;
}

export function warmBackend(now: number = Date.now(), send: () => unknown = defaultSend): boolean {
  if (!shouldWarm(now, lastWarmAt)) return false;
  lastWarmAt = now;
  try { void Promise.resolve(send()).catch(() => undefined); } catch { /* nothing to do */ }
  return true;
}

function defaultSend(): Promise<unknown> {
  // `cache: 'no-store'`: a cached answer would not wake anything. The response body is never read.
  return fetch('/api/warm', { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
}

/** Wire it once: now, and whenever the person returns to the page. Returns the cleanup. */
export function startWarmingBackend(doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document): () => void {
  warmBackend();
  const onVisible = (): void => { if (doc.visibilityState === 'visible') warmBackend(); };
  doc.addEventListener('visibilitychange', onVisible);
  return () => doc.removeEventListener('visibilitychange', onVisible);
}

/** Test helper. */
export function __resetWarmBackend(): void { lastWarmAt = 0; }
