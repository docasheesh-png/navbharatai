// The message contract between an app running in the PREVIEW and the NavBharatAI page around it, for the
// app's built-in assistant (admin 2026-10-04). Shared by the in-page shim (server-generated script) and the
// panel that answers it, so the two cannot drift.
//
// 🔒 The app's page never holds a credential. It posts the QUESTION to its parent; the parent — the page the
// owner is signed in to — asks our server with the owner's own login and posts the ANSWER back. Opened
// outside NavBharatAI there is no parent to answer, so the assistant is simply unavailable there.

export const PREVIEW_AI_ASK = '__nbaiAiAsk';
export const PREVIEW_AI_ANSWER = '__nbaiAiAnswer';
/** How long the page waits for an answer before it says so. */
export const PREVIEW_AI_TIMEOUT_MS = 60_000;
export const PREVIEW_AI_MAX_PROMPT = 4_000;

export interface PreviewAiAsk { [PREVIEW_AI_ASK]: true; id: string; prompt: string; system?: string }
export interface PreviewAiAnswer { [PREVIEW_AI_ANSWER]: true; id: string; ok: boolean; text?: string; message?: string }

/** Read an ask from a message, or null. Pure. */
export function readPreviewAiAsk(data: unknown): { id: string; prompt: string; system: string } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d[PREVIEW_AI_ASK] !== true || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  const prompt = typeof d.prompt === 'string' ? d.prompt.slice(0, PREVIEW_AI_MAX_PROMPT) : '';
  const system = typeof d.system === 'string' ? d.system.slice(0, PREVIEW_AI_MAX_PROMPT) : '';
  return { id: d.id, prompt, system };
}

/**
 * The script that gives a PREVIEW page its `window.NavAI`. Plain ES5, no credential, and it never replaces a
 * NavAI that is already there (a published page's own stamp wins).
 */
export function previewAiShimSource(): string {
  return `(function () {
  if (window.NavAI) return;
  var seq = 0, waiting = {};
  function hasParent() { try { return window.parent && window.parent !== window; } catch (e) { return false; } }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent && e.source !== window.top) return;
    var d = e && e.data;
    if (!d || typeof d !== 'object' || d.${PREVIEW_AI_ANSWER} !== true) return;
    var w = waiting[d.id]; if (!w) return;
    delete waiting[d.id];
    if (d.ok) w.resolve(String(d.text || ''));
    else w.reject(new Error(String(d.message || 'The assistant is not available right now.')));
  });
  window.NavAI = { app: 'preview', available: true, preview: true, ask: function (prompt, opts) {
    return new Promise(function (resolve, reject) {
      if (!hasParent()) { reject(new Error('Open this app inside NavBharatAI to try its assistant before publishing.')); return; }
      var id = 'a' + (++seq) + '_' + Date.now();
      waiting[id] = { resolve: resolve, reject: reject };
      try {
        (window.parent || window.top).postMessage({ ${PREVIEW_AI_ASK}: true, id: id, prompt: String(prompt || ''), system: opts && opts.system ? String(opts.system) : '' }, '*');
      } catch (err) { delete waiting[id]; reject(new Error('The assistant is not available right now.')); return; }
      setTimeout(function () {
        var w = waiting[id];
        if (w) { delete waiting[id]; w.reject(new Error('The assistant took too long to answer. Please try again.')); }
      }, ${PREVIEW_AI_TIMEOUT_MS});
    });
  } };
})();`;
}
