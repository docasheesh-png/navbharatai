// AgentV3 — "made by NavBharatAI" app signature (admin 2026-07-16, viral-growth mechanic).
//
// WHY: every app a user builds should carry a small "made by NavBharatAI" badge in the
// bottom-right corner that links to navbharatai.com. When the user shares their built app,
// a friend who clicks the badge lands on navbharatai.com and can become a customer too.
//
// The user can turn this OFF from Settings → General ("made by NavBharatAI" signature toggle);
// default ON. The build request carries the preference (`appSignature`), the dispatcher gates
// the injection on it, and this module is the SINGLE source of truth for the badge markup +
// how it is injected — so there is one implementation, never per-framework copies that drift
// (fourth absolute rule: fix the class with one shared, tested implementation).
//
// PURE + dependency-free = fully unit-testable without a sandbox.

/** Marker attribute that makes the injection idempotent + detectable (never inject twice). */
export const APP_SIGNATURE_MARKER = 'data-nbai-signature';

/** The public site the badge links to. */
export const APP_SIGNATURE_URL = 'https://navbharatai.com';

/** The visible label. */
export const APP_SIGNATURE_LABEL = 'made by NavBharatAI';

/**
 * The self-contained badge markup: a fixed-position, bottom-right anchor with fully INLINE styles
 * (no external CSS/JS/fonts) so it renders identically inside ANY built app — React, Vue, Svelte,
 * plain HTML — with zero dependencies and nothing to break. Opens navbharatai.com in a new tab.
 * `rel="noopener"` so the opened tab can't touch the opener. The high z-index keeps it visible
 * above app chrome without a stacking-context fight.
 */
export function appSignatureHtml(): string {
  return (
    `<a href="${APP_SIGNATURE_URL}" target="_blank" rel="noopener noreferrer" ${APP_SIGNATURE_MARKER}="1" ` +
    `aria-label="${APP_SIGNATURE_LABEL} — open navbharatai.com" ` +
    `style="position:fixed;right:12px;bottom:12px;z-index:2147483647;display:inline-flex;align-items:center;` +
    `gap:6px;padding:6px 11px;background:#161b22;color:#ffffff;` +
    `font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;` +
    `border-radius:9999px;box-shadow:0 2px 10px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14)">` +
    `<span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background:#6366f1"></span>` +
    `${APP_SIGNATURE_LABEL}</a>`
  );
}

/** True when the badge is already present in the document (so a re-run never adds a second copy). */
export function hasAppSignature(html: string): boolean {
  return typeof html === 'string' && html.includes(APP_SIGNATURE_MARKER);
}

/**
 * Inject the badge into an HTML document. Idempotent (returns the input unchanged when the badge
 * is already there). Inserts right before the LAST `</body>` so the anchor is a body sibling that
 * renders on top of the mounted app (a `<div id="root">` app still shows it — the fixed anchor is
 * outside the root and is never unmounted). When there is no `</body>` (a fragment/odd document),
 * the badge is appended so it is never silently dropped. A blank/whitespace-only string is left as
 * is — there is no document to sign. PURE.
 */
export function injectAppSignature(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return html;
  if (hasAppSignature(html)) return html;
  const badge = appSignatureHtml();
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return `${html}\n${badge}\n`;
  return `${html.slice(0, idx)}${badge}\n${html.slice(idx)}`;
}
