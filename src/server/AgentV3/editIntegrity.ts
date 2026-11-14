// AN EDIT TO A ONE-FILE GAME IS CHECKED BEFORE IT IS KEPT (single-file game autopsy, 2026-11-14).
//
// 🔴 THE GAP. The write-time parse guard judges .js/.ts/.json/.css — and NOT an .html file. A one-file game keeps ALL its code
// inside `<script>` in one .html page, so an AI edit that left a stray `}` there was accepted, reported as done, and the game
// showed a black screen. Nor did anything look at media: an edit could silently drop a 4 MB intro video, or "add" a base64
// string the model made up.
//
// 🔑 THE RULE. A write to an HTML page is refused — the previous version stays on disk — when it REGRESSES:
//   1. media          — the page's embedded media changed (a payload dropped or invented), or the model's own placeholder
//                       text (`<<media omitted…>>`, which is what it was shown instead of the payload) was written back;
//   2. inline script  — an inline `<script>` that parsed before no longer does;
//   3. structure      — a <script>/<style> tag that was balanced is no longer, or the closing </body>/</html> vanished;
//   4. asset refs     — the edit points at an `assets/media/…` file that does not exist.
// Only a REGRESSION is refused: a page that was already broken may be repaired step by step. Kill switch:
// AGENTV3_EDIT_INTEGRITY=off. PURE apart from the injected parser; never throws (a guard that fails allows the write).
import { elideEmbeddedMedia, mediaFingerprints } from '../../lib/embeddedMedia';
import { findSyntaxErrors } from './SyntaxCheck';

export function editIntegrityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_EDIT_INTEGRITY ?? '').trim().toLowerCase() !== 'off';
}

const HTML_PAGE = /\.html?$/i;
export function isHtmlPage(path: string): boolean { return HTML_PAGE.test(String(path ?? '')); }

/** The model's own stand-in for a payload. Writing it back would replace real media with this text. */
const PLACEHOLDER = /<<(?:base64 )?media omitted:/;

/** Inline classic scripts: no `src`, and a JavaScript (or absent) type. Modules are parsed too, as modules. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/^(?:text\/javascript|application\/javascript|module|text\/babel)$/.test(type)) continue; // JSON data, templates…
    if (type === 'text/babel') continue; // JSX — not parseable as plain JS
    const body = m[2];
    if (body.trim()) out.push(body);
  }
  return out;
}

/** How many inline scripts of a page fail to parse (and the first message). */
async function brokenScripts(html: string): Promise<{ count: number; first: string }> {
  // A payload is never parsed: it is a string literal, but a 5 MB one costs real time for no information.
  const code = elideEmbeddedMedia(html).text;
  const scripts = inlineScripts(code);
  if (scripts.length === 0) return { count: 0, first: '' };
  const files: Record<string, string> = {};
  scripts.forEach((s, i) => { files[`inline-script-${i + 1}.js`] = s; });
  const errs = await findSyntaxErrors(files);
  return { count: errs.length, first: errs[0]?.message ?? '' };
}

function tagCount(html: string, re: RegExp): number { return (html.match(re) ?? []).length; }

/** Balanced tags, and the document's closing tags still present when they were. */
function structureFacts(html: string): { scriptsBalanced: boolean; stylesBalanced: boolean; closesBody: boolean; closesHtml: boolean } {
  return {
    scriptsBalanced: tagCount(html, /<script\b/gi) === tagCount(html, /<\/script\s*>/gi),
    stylesBalanced: tagCount(html, /<style\b/gi) === tagCount(html, /<\/style\s*>/gi),
    closesBody: /<\/body\s*>/i.test(html),
    closesHtml: /<\/html\s*>/i.test(html),
  };
}

/** Every local `assets/media/<file>` the page refers to, as written. */
export function mediaAssetRefs(html: string): string[] {
  return [...new Set([...html.matchAll(/(?:\.\/)?assets\/media\/[A-Za-z0-9._-]+/g)].map((m) => m[0].replace(/^\.\//, '')))];
}

export interface IntegrityVerdict { ok: boolean; message: string }
const OK: IntegrityVerdict = { ok: true, message: '' };

function refusal(message: string): IntegrityVerdict { return { ok: false, message }; }

/** Rule 1 — embedded media must come out of an edit exactly as it went in. Pure. */
export function mediaEditVerdict(before: string, after: string): IntegrityVerdict {
  if (PLACEHOLDER.test(after) && !PLACEHOLDER.test(before)) {
    return refusal('This page holds embedded media that you were shown as "<<media omitted…>>" placeholders. Writing the whole file back would replace the real media with that text. Make your change with edit_file on the specific lines you need — never rewrite this file wholesale, and never copy a placeholder.');
  }
  const was = mediaFingerprints(before);
  const now = mediaFingerprints(after);
  if (was.size === 0 && now.size === 0) return OK;
  const dropped = [...was].filter((f) => !now.has(f));
  const invented = [...now].filter((f) => !was.has(f));
  if (dropped.length > 0) {
    return refusal(`This edit would delete ${dropped.length} embedded media payload(s) (video / audio / image data) from the page. The media is the user's and must stay byte-for-byte. Use edit_file for only the lines you need to change.`);
  }
  if (invented.length > 0) {
    return refusal(`This edit adds ${invented.length} embedded base64 media payload(s). Media is never written into code: put the file in assets/media/ and reference it by path. Nothing was changed.`);
  }
  return OK;
}

/** Rules 2 and 3 — the page still parses and is still whole. Async because script parsing is. */
export async function pageHealthVerdict(before: string, after: string): Promise<IntegrityVerdict> {
  const b = structureFacts(before);
  const a = structureFacts(after);
  if (b.scriptsBalanced && !a.scriptsBalanced) return refusal('This edit leaves a <script> tag unclosed (or closes one that was never opened), so the page would stop running. Nothing was changed.');
  if (b.stylesBalanced && !a.stylesBalanced) return refusal('This edit leaves a <style> tag unbalanced, so the page would lose its styling. Nothing was changed.');
  if ((b.closesBody && !a.closesBody) || (b.closesHtml && !a.closesHtml)) return refusal('This edit removes the closing </body> or </html> of the page — the file was cut off. Nothing was changed.');
  const was = await brokenScripts(before);
  const now = await brokenScripts(after);
  if (now.count > was.count) return refusal(`This edit breaks the page's JavaScript — an inline <script> no longer parses (${now.first.slice(0, 160)}). The game would show a blank screen. Nothing was changed; fix the syntax and write again.`);
  return OK;
}

/** Rule 4 — every NEW `assets/media/` reference must name a file that exists. `exists` gets workspace-relative paths. */
export function unresolvedMediaRefs(pagePath: string, before: string, after: string, exists: (path: string) => boolean): string[] {
  const known = new Set(mediaAssetRefs(before));
  const dir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/') + 1) : '';
  return mediaAssetRefs(after).filter((ref) => !known.has(ref) && !exists(dir + ref));
}

/** All four, for one write. The existence check is injected so it costs a listing only when a new reference appeared. */
export async function htmlEditVerdict(
  pagePath: string,
  before: string,
  after: string,
  existingPaths: () => Promise<ReadonlySet<string>>,
): Promise<IntegrityVerdict> {
  try {
    if (!editIntegrityEnabled() || !isHtmlPage(pagePath) || before === after) return OK;
    const media = mediaEditVerdict(before, after);
    if (!media.ok) return media;
    const health = await pageHealthVerdict(before, after);
    if (!health.ok) return health;
    const newRefs = mediaAssetRefs(after).filter((r) => !mediaAssetRefs(before).includes(r));
    if (newRefs.length > 0) {
      const have = await existingPaths();
      const missing = unresolvedMediaRefs(pagePath, before, after, (p) => have.has(p));
      if (missing.length > 0) return refusal(`This edit refers to media file(s) that do not exist: ${missing.slice(0, 5).join(', ')}. Add the file first, or keep the existing reference. Nothing was changed.`);
    }
    return OK;
  } catch {
    return OK; // a guard that cannot run never blocks a write
  }
}

