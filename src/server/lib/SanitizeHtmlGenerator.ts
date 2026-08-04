// U-4 (verified recipe modules) — HTML sanitization / XSS prevention (sanitize-html).
//
// The moment an app renders user-supplied HTML — a comment, a rich-text post, a profile bio, a support
// ticket — unsanitized markup is a stored-XSS hole: `<script>`, `onerror=`, `javascript:` URLs and `<iframe>`
// run in every other user's browser. The wrong "fix" is a regex that strips `<script>` (trivially bypassed);
// the right one is an allowlist sanitizer. This recipe ships two real helpers: `sanitizeHtml(dirty)` keeps a
// safe formatting subset (bold/italic/lists/links, with links forced to safe protocols + rel="noopener")
// and drops everything dangerous; `sanitizeToText(dirty)` strips ALL markup to plain text. Built on
// `sanitize-html` (the standard). PURE builder; correct and complete — no TODO stubs (the real-features
// rule). Introduces no env keys. Unit-tested.

export interface SanitizeConfig {
  files: Record<string, string>;
  /** sanitize-html is the one dependency (the standard allowlist HTML sanitizer). */
  dependency: { name: string; version: string };
  instructions: string;
}

const SANITIZE_SERVER = `import sanitizeHtmlLib from 'sanitize-html';

// Sanitize user-supplied HTML before you STORE or RENDER it, keeping a safe formatting subset and dropping
// anything that can run code. Removes <script>/<style>/<iframe>, on* event handlers and javascript: URLs;
// keeps headings, paragraphs, lists, bold/italic, code, blockquotes and links. Links are forced to safe
// protocols (http/https/mailto) and get rel="noopener noreferrer" + target="_blank". Use on every field a
// user can type rich text into (comments, posts, bios, ticket bodies).
export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLib(dirty, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'b', 'i', 'strong', 'em', 'u', 's', 'a', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      span: [],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: {
      // Every surviving link becomes safe: no window.opener hijack, no reverse-tabnabbing.
      a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}

// Strip ALL HTML to plain text — use when you want no markup at all (a username, a search index, a preview).
export function sanitizeToText(dirty: string): string {
  return sanitizeHtmlLib(dirty, { allowedTags: [], allowedAttributes: {} });
}
`;

const INSTRUCTIONS =
  'HTML sanitization wired at server/lib/sanitize.ts (add the dependency sanitize-html). Import ' +
  'sanitizeHtml(dirty) and run it on any user-supplied HTML BEFORE you store or render it (comments, ' +
  'rich-text posts, bios, ticket bodies) — it keeps a safe formatting subset and strips <script>, event ' +
  'handlers, javascript: URLs and <iframe>, closing the stored-XSS hole. Links are forced to safe protocols ' +
  'and rel="noopener". Use sanitizeToText(dirty) to strip all markup to plain text. No API key needed. ' +
  'Never trust a regex-based tag stripper for this — it is bypassable; this is a proper allowlist sanitizer.';

export function generateSanitizeHtmlIntegration(): SanitizeConfig {
  return {
    files: { 'server/lib/sanitize.ts': SANITIZE_SERVER },
    dependency: { name: 'sanitize-html', version: '^2.13.0' },
    instructions: INSTRUCTIONS,
  };
}
