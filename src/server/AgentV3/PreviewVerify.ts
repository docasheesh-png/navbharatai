// AgentV3 — Preview self-awareness.
//
// v5.0 used to claim "preview published" after only a port check (nc -z): port-up ≠ the app actually
// rendered. Nothing ever VISITED the preview, so a blank/white screen, a React crash-before-render, a
// Vite error overlay, or a dev-server 404 went completely unnoticed — the agent had no idea whether
// its app really ran. This module analyses the RENDERED DOM of the preview (captured by navigating a
// real browser to it) to judge honestly whether the app rendered, and to name what's wrong so the
// agent can FIX it. Pure + dependency-free (fully unit-testable).

export interface PreviewVerdict {
  /** True only when the page shows real, visible app content with no error surface. */
  rendered: boolean;
  /** Human-readable problems found (empty when rendered) — fed back to the agent to repair. */
  problems: string[];
}

/** Strip scripts/styles/tags to the visible text, so we can tell a real UI from an empty shell. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that separate a server ERROR payload from a friendly JSON greeting like {"status":"ok"}. */
const JSON_ERROR_WORDS = /\b(error|failed|failure|required|missing|invalid|unauthori[sz]ed|forbidden|not\s+found|cannot|can't|unexpected|exception|denied|unavailable|timeout|timed\s+out|crash)\b/i;

/**
 * If the page body is a JSON ERROR envelope, return its message; otherwise ''. PURE.
 *
 * Deliberately narrow, because an API-first project may legitimately answer `/` with JSON: the body
 * must PARSE as a JSON object, be small enough to be a status envelope rather than real data, and
 * either carry an explicit error field (`error`, `stack`, a 4xx/5xx `statusCode`) or a message that
 * READS as a failure. `{"message":"API is running"}` is therefore left alone, while
 * `{"message":"secret option required for sessions"}` is caught.
 */
export function jsonErrorBody(html: string): string {
  const body = (html || '').trim();
  if (!body.startsWith('{') || body.length > 2000) return '';
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const obj = parsed as Record<string, unknown>;
  const message = [obj.message, obj.error, obj.msg, obj.detail].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const status = typeof obj.statusCode === 'number' ? obj.statusCode : typeof obj.status === 'number' ? obj.status : 0;
  const explicit = 'error' in obj || 'stack' in obj || 'errors' in obj || (status >= 400 && status <= 599);
  if (!explicit && !(message && JSON_ERROR_WORDS.test(message))) return '';
  const shown = (message ?? JSON.stringify(obj)).trim();
  return shown.length > 200 ? `${shown.slice(0, 200)}…` : shown;
}

/**
 * Judge whether a preview's RENDERED HTML represents a working app. Conservative: only declares
 * `rendered` when there is genuine visible content AND no error/empty-mount signal.
 */
export function analyzePreviewHtml(html: string): PreviewVerdict {
  const h = (html || '').trim();
  const lower = h.toLowerCase();
  const problems: string[] = [];

  // Dev-server / routing failures — checked FIRST (an Express "Cannot GET /" page is short, so it
  // must not be misread as a generic blank page by the length check below).
  if (/cannot get \//i.test(h) || /\b404\b[^<]{0,40}not found/i.test(lower)) {
    problems.push('the server returned 404 / "Cannot GET" — the dev server is not serving the app at this path');
  }

  // A JSON ERROR BODY WHERE THE APP SHOULD BE (build report d6deaaf0, Mitrify, 2026-08-09). The
  // preview showed literally `{"message":"secret option required for sessions"}` — express-session
  // rejecting EVERY request because it had no secret — and this analyser passed it as "rendered",
  // so the build reported "✅ Live preview is up" over an app that served nothing but an error. It
  // slipped through every existing rule: 48 characters (over the blank-page threshold), no overlay
  // markup, no "Cannot GET", no empty mount root. A machine-readable error is still an error.
  const jsonError = jsonErrorBody(h);
  if (jsonError) {
    problems.push(`the server returned an error instead of the app: ${jsonError}`);
  }

  if (problems.length === 0 && h.length < 40) {
    return { rendered: false, problems: ['the preview returned an empty/blank page (the dev server may not be serving the app)'] };
  }
  // Build-error overlays surfaced into the DOM. T0-5 fix: the old check only knew Vite's overlay, so a
  // React / Next.js / webpack / Parcel overlay (or a bundler module-resolution error) that had crashed
  // the screen was NOT recognised → verify falsely reported "renders correctly" (a fake success). These
  // markers are error-overlay HOST elements (never legitimate app content) plus compile/resolve failures
  // of the same class as the existing "failed to compile" signal, so precision stays high.
  const overlayHost =
    lower.includes('vite-error-overlay') ||       // Vite
    lower.includes('react-error-overlay') ||      // CRA / react dev overlay
    lower.includes('webpack-dev-server-client-overlay') || // webpack-dev-server
    lower.includes('nextjs-portal') ||            // Next.js dev overlay host
    lower.includes('parcel-error-overlay');       // Parcel
  const compileError =
    lower.includes('plugin:vite') || lower.includes('[plugin:') ||
    lower.includes('failed to compile') ||        // CRA / Next
    lower.includes('could not resolve') ||        // esbuild
    lower.includes('module not found') ||         // webpack / Next
    lower.includes('build failed') ||             // esbuild / generic bundler
    lower.includes('pre-transform error');        // Vite
  if (overlayHost || compileError) {
    problems.push('the dev server is showing a build-error overlay (the app failed to compile)');
  }
  // An uncaught runtime error printed onto the page.
  if (/uncaught\s+(type|reference|syntax|range)error/i.test(h) || /unhandled\s+(error|rejection)/i.test(lower)) {
    problems.push('an uncaught runtime error is shown on the page');
  }

  // SPA mount root left empty → JS crashed before the UI rendered.
  const rootEmpty = /<div[^>]*id=["'](?:root|app)["'][^>]*>\s*<\/div>/i.test(h);
  const text = visibleText(h);
  if (rootEmpty && text.length < 5) {
    problems.push("the app's root element is empty — the UI never rendered (a runtime error likely crashed it before render)");
  }

  // No error signal but also no visible content → a blank page.
  if (problems.length === 0 && text.length < 5) {
    problems.push('the preview rendered no visible content (a blank page)');
  }

  return { rendered: problems.length === 0, problems };
}

/** A short, agent-facing instruction to fix the observed preview problems (used when repairing). */
export function buildPreviewRepairPrompt(problems: string[], consoleErrors: string[] = []): string {
  const lines = [
    'The app was built but its LIVE PREVIEW does not work. A real browser opened the running app and observed these problems:',
    ...problems.map((p) => `  - ${p}`),
  ];
  if (consoleErrors.length) {
    lines.push('', 'Browser console errors captured on that page:');
    lines.push(...consoleErrors.slice(0, 15).map((e) => `  - ${e.slice(0, 300)}`));
  }
  lines.push(
    '',
    'Find the ROOT CAUSE and fix it so the app actually renders in the browser (read the relevant files first; fix imports, undefined variables, failed data access, or a crashing component). Make the minimum targeted edits, then ensure the dev server is running so the preview reloads. Do NOT claim success unless the app would visibly render.',
  );
  return lines.join('\n');
}
