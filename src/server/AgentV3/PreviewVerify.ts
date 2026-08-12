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
  /**
   * True when we could not SEE the app rather than seeing it broken — so `rendered: false` here is
   * ignorance, not a defect, and the caller must NOT launch a repair pass on it.
   *
   * ROOT CAUSE (admin field report 2026-08-12, and the reason this field exists at all): for any
   * single-page app the un-hydrated shell is `<div id="root"></div>` and nothing else — byte-identical
   * to an app that crashed on mount. Judged by the same rules, a perfectly healthy React app was
   * declared to have "a runtime error [that] likely crashed it before render". The build then repaired
   * a bug that did not exist, the repair restarted the dev server, the preview genuinely went down,
   * and the next check could snapshot early again. That loop turned a 7-minute app into a 34-minute
   * build, and every pass through it edited working code.
   */
  inconclusive?: boolean;
}

/**
 * What the caller knows about HOW the html was captured.
 *
 * Without this, `analyzePreviewHtml` is being asked to distinguish "the app crashed" from "I took the
 * photograph before the app was ready", using only the photograph.
 */
export interface PreviewCaptureContext {
  /** Did the capturing browser observe content in the mount root? `undefined` = it could not tell. */
  painted?: boolean;
  /** 'curl' can only ever return the static shell — it never executes the app's JavaScript. */
  source?: 'browser' | 'curl';
}

/**
 * How long browseUrl waits for a single-page app to PAINT before giving up on it.
 *
 * This replaced a fixed `waitForTimeout(1800)`. A fixed sleep cannot be right: too short and a healthy
 * app is snapshotted blank and then accused of crashing; too long and every build pays for the slowest
 * app. Polling ends the moment content appears, so the common case is FASTER than the old guess while
 * the slow case stops producing a false accusation.
 */
export const BROWSE_PAINT_DEADLINE_MS = 10_000;
/** How often to look. Short enough that a fast app is barely delayed. */
export const BROWSE_PAINT_POLL_MS = 250;

/** The marker the in-sandbox script prints so we know whether the app had painted when we looked. */
export const PAINT_MARKER = 'NBAI_PAINTED:';

/**
 * Split the paint marker off the captured HTML. Pure; never throws.
 *
 * A snapshot with NO marker came from somewhere that could not tell us (an older script, a truncated
 * stream). That is reported as `painted: undefined` — unknown — rather than as `false`, because
 * "unknown" and "it did not paint" lead to opposite decisions and collapsing them is how this whole
 * class of false accusation started.
 */
export function splitPaintMarker(stdout: string): { painted?: boolean; html: string } {
  const text = String(stdout ?? '');
  const at = text.indexOf(PAINT_MARKER);
  if (at < 0) return { html: text };
  const nl = text.indexOf('\n', at);
  const flag = text.slice(at + PAINT_MARKER.length, nl < 0 ? undefined : nl).trim();
  const html = nl < 0 ? '' : text.slice(nl + 1);
  return { painted: flag === '1', html };
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
 * Is this the SANDBOX HOST's error page rather than the user's app? Returns the honest problem line,
 * or '' when the page is the app. PURE.
 *
 * These pages are served by the preview host itself when nothing is listening on the requested port,
 * so they always render "successfully" — real HTML, real prose, HTTP 200 in some cases. Every other
 * rule in this module looks for a failure INSIDE the app; this one recognises that the app was never
 * reached at all.
 *
 * Matched on the host's own distinctive wording, and deliberately requiring a PAIR of signals so a
 * user's app that happens to mention a port cannot be mistaken for one (a devops dashboard is allowed
 * to contain the words "connection refused").
 */
export function hostErrorPage(html: string): string {
  const lower = (html || '').toLowerCase();
  if (!lower) return '';
  const closedPort = lower.includes('closed port error')
    || /no service (?:is )?running on port/.test(lower)
    || /connection refused on port/.test(lower);
  if (!closedPort) return '';
  // A second, independent signal from the same page — the host explaining itself to the user.
  const hostVoice = lower.includes('the sandbox')
    || lower.includes('sandbox logs')
    || lower.includes('properly configured and running on the specified port')
    || /\be2b\b/.test(lower);
  if (!hostVoice) return '';
  const port = /port\s*<?[^0-9]{0,8}(\d{2,5})/.exec(lower)?.[1];
  return `nothing is listening on ${port ? `port ${port}` : 'that port'} — the preview host returned its own "closed port" page, so this is not your app`;
}

/**
 * Judge whether a preview's RENDERED HTML represents a working app. Conservative: only declares
 * `rendered` when there is genuine visible content AND no error/empty-mount signal.
 */
export function analyzePreviewHtml(html: string, capture: PreviewCaptureContext = {}): PreviewVerdict {
  const h = (html || '').trim();
  const lower = h.toLowerCase();
  const problems: string[] = [];
  // An un-painted snapshot cannot testify about the app. A curl capture NEVER runs the app's
  // JavaScript, so its empty mount root proves nothing at all; a browser capture that polled to its
  // deadline without seeing content is weaker evidence than a positive error signal, but it is still
  // evidence — the app really did fail to paint within ten seconds.
  const blind = capture.source === 'curl' || capture.painted === false;

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

  // THE SANDBOX HOST'S OWN ERROR PAGE (real build report e61b13b1, Mitrify, 2026-08-10). The admin's
  // screen showed the E2B "Closed Port Error" page — "the sandbox is running but there's no service
  // running on port 3000 · Connection refused" — while the report said "✅ Live preview is up on port
  // 3000". That page slipped through EVERY rule here: it is long, it has real prose, no overlay
  // markup, no "Cannot GET", no empty mount root, and it is HTML rather than JSON.
  //
  // The damage went further than a wrong verdict. This page rendering as "the app" is what stopped the
  // port FLIP from ever engaging: the flip only runs when the first port fails to render, so a host
  // error page that reads as success pins the preview to a port nothing is listening on — which is the
  // exact bug the flip was built to fix. Recognising it here is what makes that whole mechanism work.
  const hostError = hostErrorPage(h);
  if (hostError) {
    problems.push(hostError);
  }

  if (problems.length === 0 && h.length < 40) {
    return blindVerdict(capture, 'the preview returned an empty/blank page (the dev server may not be serving the app)');
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

  // SPA mount root left empty. This USED to say "a runtime error likely crashed it before render" —
  // a cause, asserted from an observation that cannot distinguish a crash from a photograph taken too
  // early. When the capture could not see the app, it now says what actually happened instead.
  const rootEmpty = /<div[^>]*id=["'](?:root|app)["'][^>]*>\s*<\/div>/i.test(h);
  const text = visibleText(h);
  if (rootEmpty && text.length < 5) {
    // POSITIVE EVIDENCE OUTRANKS BLINDNESS. An error overlay or a host error page in this same html is
    // something we genuinely SAW, and returning "inconclusive" here would throw that away and let a
    // real failure through as "we could not tell". Only an otherwise-clean page is inconclusive.
    if (blind && problems.length === 0) return blindVerdict(capture, "the app's root element is empty");
    if (!blind) problems.push("the app's root element is empty — the UI never rendered (a runtime error likely crashed it before render)");
  }

  // No error signal but also no visible content → a blank page.
  if (problems.length === 0 && text.length < 5) {
    if (blind) return blindVerdict(capture, 'the preview showed no visible content');
    problems.push('the preview rendered no visible content (a blank page)');
  }

  return { rendered: problems.length === 0, problems };
}

/**
 * The honest verdict when the capture could not see the app.
 *
 * `rendered` stays false — we have not earned a pass, and "preview is EARNED" is a standing rule. But
 * `inconclusive` is set so the caller knows this is IGNORANCE, not a defect, and does not spend a
 * repair pass rewriting working code. The wording never names a cause we did not observe.
 */
function blindVerdict(capture: PreviewCaptureContext, observed: string): PreviewVerdict {
  const why = capture.source === 'curl'
    ? 'the page was fetched without running its JavaScript, so a single-page app looks empty here whether it works or not'
    : 'nothing had painted yet when the snapshot was taken';
  return {
    rendered: false,
    inconclusive: true,
    problems: [`${observed} — but this is NOT evidence the app is broken: ${why}.`],
  };
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
