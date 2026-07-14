// Nova Sonic emits some control/tool signals (e.g. {"interrupted":true}) as textOutput content —
// these are NOT speech and must never be shown as a chat line. True when the text is a JSON object.
// Pure + standalone so both SonicBridge and the transcript gate share ONE definition (no drift).
export function isControlJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try { return typeof JSON.parse(t) === 'object'; } catch { return false; }
}

// Barge-in: when the user starts speaking while the assistant is still talking, Nova Sonic emits an
// interruption control signal (`{"interrupted":true}`) as textOutput content. We must catch THIS
// specific control object — before it is discarded as generic control-JSON — so the client can flush
// the already-buffered playback and go quiet immediately (real barge-in, admin 2026-07-14). Pure so
// SonicBridge and its test share ONE definition.
export function isInterruptionSignal(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    return typeof o === 'object' && o !== null && o.interrupted === true;
  } catch { return false; }
}
