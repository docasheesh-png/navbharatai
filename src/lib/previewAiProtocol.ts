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

// PICTURES (admin 2026-10-04): the same relay, for `window.NavAI.image(prompt, { width, height })`. The page
// gets back a data URL — never a key, a token or a link to anything it could reuse.
export const PREVIEW_AI_IMAGE_ASK = '__nbaiAiImageAsk';
export const PREVIEW_AI_IMAGE_ANSWER = '__nbaiAiImageAnswer';
/** A picture can take a while; the page waits this long before it says so. */
export const PREVIEW_AI_IMAGE_TIMEOUT_MS = 120_000;
export interface PreviewAiImageAnswer { [PREVIEW_AI_IMAGE_ANSWER]: true; id: string; ok: boolean; image?: string; message?: string; code?: string }

/** Read a picture request from a message, or null. Pure. */
export function readPreviewAiImageAsk(data: unknown): { id: string; prompt: string; width: number; height: number } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d[PREVIEW_AI_IMAGE_ASK] !== true || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  const prompt = typeof d.prompt === 'string' ? d.prompt.slice(0, PREVIEW_AI_MAX_PROMPT) : '';
  const side = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 1024);
  return { id: d.id, prompt, width: side(d.width), height: side(d.height) };
}
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
  var pics = {};
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent && e.source !== window.top) return;
    var d = e && e.data;
    if (!d || typeof d !== 'object' || d.${PREVIEW_AI_IMAGE_ANSWER} !== true) return;
    var w = pics[d.id]; if (!w) return;
    delete pics[d.id];
    if (d.ok && typeof d.image === 'string') w.resolve(d.image);
    else { var err = new Error(String(d.message || 'The picture maker is not available right now.')); err.code = d.code || ''; w.reject(err); }
  });
  function image(prompt, opts) {
    return new Promise(function (resolve, reject) {
      if (!hasParent()) { reject(new Error('Open this app inside NavBharatAI to make pictures before publishing.')); return; }
      var id = 'i' + (++seq) + '_' + Date.now();
      pics[id] = { resolve: resolve, reject: reject };
      try {
        (window.parent || window.top).postMessage({ ${PREVIEW_AI_IMAGE_ASK}: true, id: id, prompt: String(prompt || ''), width: opts && opts.width, height: opts && opts.height }, '*');
      } catch (err) { delete pics[id]; reject(new Error('The picture maker is not available right now.')); return; }
      setTimeout(function () {
        var w = pics[id];
        if (w) { delete pics[id]; w.reject(new Error('The picture took too long to make. Please try again.')); }
      }, ${PREVIEW_AI_IMAGE_TIMEOUT_MS});
    });
  }
  window.NavAI = { app: 'preview', available: true, preview: true, image: image, ask: function (prompt, opts) {
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
