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

/**
 * The badge's version, carried as the marker's VALUE. Version 1 was a bare link; version 2 (2026-09-30)
 * wraps it with a close button. `injectAppSignature` upgrades a version-1 badge in place, so an app built
 * before the change gets the close button on its next build instead of keeping a badge nobody can hide.
 */
export const APP_SIGNATURE_VERSION = '2';

/** The public site the badge links to. */
export const APP_SIGNATURE_URL = 'https://navbharatai.com';

/** The visible label. */
export const APP_SIGNATURE_LABEL = 'made by NavBharatAI';

/** What a screen reader announces for the close control. */
export const APP_SIGNATURE_CLOSE_LABEL = 'Hide the NavBharatAI badge';

/**
 * The self-contained badge: a fixed bottom-right link to navbharatai.com with a small × beside it.
 *
 * 🙈 THE × HIDES IT UNTIL THE NEXT REFRESH (admin 2026-09-30: "x (close) button bana jo har refresh par
 * wapas aa jaye"). The badge is fixed, so it can sit over an app's own footer or cart bar; the person
 * using the app can now move it out of the way. Nothing is stored, so a reload brings it back.
 *
 * 🔒 WHY THE × IS A CHECKBOX AND NOT A BUTTON WITH A SCRIPT. A click handler is JavaScript, and an app
 * whose Content-Security-Policy forbids inline script (which this platform itself recommends adding) would
 * silently turn a scripted × into a dead control. A checked checkbox hides its siblings with CSS alone, so
 * the × works wherever the badge itself renders. `autocomplete="off"` stops a browser restoring the ticked
 * state on reload, which is what keeps "comes back on refresh" true. The checkbox is first in the DOM
 * because CSS can only hide what FOLLOWS it; `order` draws it to the right of the link.
 *
 * Everything that must win against the app's own CSS is an inline style; the <style> block carries only
 * what inline styles cannot express (the checked state, the ×, the focus ring), under a selector scoped
 * to the badge so it can never touch the app. No external CSS, JS or fonts. `rel="noopener"` so the
 * opened tab can't touch the opener.
 */
export function appSignatureHtml(): string {
  const scope = `[${APP_SIGNATURE_MARKER}]`;
  return (
    `<div ${APP_SIGNATURE_MARKER}="${APP_SIGNATURE_VERSION}" ` +
    `style="position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:4px">` +
    `<style>` +
    `${scope}>input:checked,${scope}>input:checked~a{display:none!important}` +
    `${scope}>input::before{content:"\\00d7";color:#ffffff;font:600 15px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}` +
    `${scope}>input:focus-visible{outline:2px solid #6366f1;outline-offset:2px}` +
    `</style>` +
    `<input type="checkbox" autocomplete="off" aria-label="${APP_SIGNATURE_CLOSE_LABEL}" title="${APP_SIGNATURE_CLOSE_LABEL}" ` +
    `style="order:2;appearance:none;-webkit-appearance:none;margin:0;width:24px;height:24px;flex:none;` +
    `display:grid;place-items:center;cursor:pointer;border-radius:9999px;background:#161b22;` +
    `border:1px solid rgba(255,255,255,.14);box-shadow:0 2px 10px rgba(0,0,0,.28)">` +
    `<a href="${APP_SIGNATURE_URL}" target="_blank" rel="noopener noreferrer" ` +
    `aria-label="${APP_SIGNATURE_LABEL} — open navbharatai.com" ` +
    `style="order:1;display:inline-flex;align-items:center;` +
    `gap:6px;padding:6px 11px;background:#161b22;color:#ffffff;` +
    `font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;` +
    `border-radius:9999px;box-shadow:0 2px 10px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14)">` +
    `<span style="display:inline-block;width:7px;height:7px;border-radius:9999px;background:#6366f1"></span>` +
    `${APP_SIGNATURE_LABEL}</a>` +
    `</div>`
  );
}

/** True when a badge of ANY version is present in the document. */
export function hasAppSignature(html: string): boolean {
  return typeof html === 'string' && html.includes(APP_SIGNATURE_MARKER);
}

/** True when the CURRENT badge (with its close button) is present. */
export function hasCurrentAppSignature(html: string): boolean {
  return typeof html === 'string' && html.includes(`${APP_SIGNATURE_MARKER}="${APP_SIGNATURE_VERSION}"`);
}

/** The version-1 badge exactly as `appSignatureHtml` used to write it: one <a> holding one <span>. */
const V1_BADGE = new RegExp(`<a\\b[^>]*\\b${APP_SIGNATURE_MARKER}="1"[^>]*>[\\s\\S]*?</a>`);

/**
 * Inject the badge into an HTML document. Idempotent (returns the input unchanged when the current badge
 * is already there). A version-1 badge is REPLACED in place by the current one, so an older app gains the
 * close button without a second badge. Otherwise inserts right before the LAST `</body>` so the badge is a
 * body sibling that renders on top of the mounted app (a `<div id="root">` app still shows it — it is
 * outside the root and is never unmounted). When there is no `</body>` (a fragment/odd document), the
 * badge is appended so it is never silently dropped. A badge whose markup has been edited out of
 * recognition is left alone rather than doubled. A blank/whitespace-only string is left as is — there is
 * no document to sign. PURE.
 */
export function injectAppSignature(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return html;
  if (hasCurrentAppSignature(html)) return html;
  const badge = appSignatureHtml();
  if (hasAppSignature(html)) {
    return V1_BADGE.test(html) ? html.replace(V1_BADGE, () => badge) : html;
  }
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return `${html}\n${badge}\n`;
  return `${html.slice(0, idx)}${badge}\n${html.slice(idx)}`;
}
