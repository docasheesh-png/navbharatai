/**
 * A fresh per-CASE Doctor AI (SDA) session id. The server's clinical store is keyed by sessionId, so
 * each patient MUST get a distinct id — otherwise (when the client sends none) every case for one
 * doctor collapses onto their userId and Patient A's demographics / red-flags / recent turns bleed into
 * Patient B's workup (wrong risk stratification + dosing). Prefers crypto.randomUUID (secure context);
 * falls back to a time+random id. Pure + testable: successive calls must never collide.
 */
export function newSdaCaseId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `case_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
