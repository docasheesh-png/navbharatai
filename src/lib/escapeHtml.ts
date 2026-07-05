// One shared HTML-escaper for values interpolated RAW into an HTML string the platform will render
// (a generated PDF written to a same-origin popup, a nav-preview injected via dangerouslySetInnerHTML,
// etc.). Escaping `& < > "` prevents an attacker/user/AI-controlled value — a filename, page title,
// patient field, logo text — from breaking out of its text/attribute context and executing
// `<img onerror=…>` in the platform origin (same-origin token theft). Pure.
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
