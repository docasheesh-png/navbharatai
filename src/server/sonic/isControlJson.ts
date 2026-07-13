// Nova Sonic emits some control/tool signals (e.g. {"interrupted":true}) as textOutput content —
// these are NOT speech and must never be shown as a chat line. True when the text is a JSON object.
// Pure + standalone so both SonicBridge and the transcript gate share ONE definition (no drift).
export function isControlJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try { return typeof JSON.parse(t) === 'object'; } catch { return false; }
}
