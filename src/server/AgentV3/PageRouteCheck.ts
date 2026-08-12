// AgentV3 — does every PAGE actually render, or only the home one? (admin 2026-08-06)
//
// THE GAP THIS CLOSES, precisely. Three checks already run after a build and none of them covers this:
//   • the preview verifier loads the HOME route in a browser and reads the rendered HTML — home only;
//   • RouteSmokeCheck curls the app's API endpoints — HTTP status, no browser, no rendering;
//   • the console-error capture watches the page the preview opened — again, home.
// So a React or Next app can return 200 for `/dashboard` with a perfectly good HTML shell, throw during
// the client-side render, and paint a blank screen — and every check above passes. That is the exact
// family of failure the "Cannot GET /customer/home" reports came from, and nothing was looking at it.
//
// WHY THIS IS CHEAP, which is the whole reason it can run by default (admin: "admin ka kam kharcha ho").
// Playwright 1.49.1 AND Chromium are PRE-BAKED into both E2B images (`infra/e2b/e2b.Dockerfile`,
// `e2b-fullstack.Dockerfile`, into `/home/user/.e-tools`), and `_kickoffPlaywright` already warms them on
// every sandbox for the screenshot/browser tools. So this costs one browser navigation per route:
//   • NO download — the ~300 MB browser is paid once at template-build time, not per build;
//   • NO npm install — nothing is added to the user's package.json or node_modules;
//   • NO model call — the routes come from the source, not from an LLM.
// (The `e2eAutoScaffold` module declined to RUN its suite on the grounds that Playwright "pulls a
// browser of roughly 300 MB … on EVERY build". That reasoning was true in general and false for this
// engine, because of the pre-bake above. Corrected there.)
//
// EVERYTHING HERE IS BOUNDED, because a check that can cost minutes will be turned off and then it
// protects nobody: a small route cap, a per-route timeout, and home is deliberately NOT re-checked —
// the preview verifier already proved it, and paying for it twice buys nothing.
//
// THE ACCESSIBILITY PASS IS SIX CHECKS, NOT A LIBRARY, and it is never called "axe" or "WCAG-compliant".
// Injecting axe-core would mean pushing ~500 KB through a sandbox command whose size limit cannot be
// verified from here, and shipping an unverified mechanism is a mistake this codebase has already paid
// for. The six are the ones generated apps actually fail — missing lang, missing title, images with no
// alt, buttons and links a screen reader cannot name, form fields with no label — each reported as the
// specific thing it is. Claiming full coverage would be the lie; finding real problems is not. Verified
// in a real browser against a deliberately-bad page (all six found) and a correct one (none found,
// including the cases that LOOK like violations: alt="" with aria-hidden, an aria-label on a button, a
// label[for], a wrapping label, and a hidden input).

/** How many page routes to actually open. A 40-page app must not add minutes to every build. */
export const MAX_PAGE_ROUTES = 6;

/** Where the pre-baked Playwright and its browsers live inside the sandbox image. */
export const TOOLS_DIR = '/home/user/.e-tools';

/** How long one route may take to load before we stop waiting on it. */
export const PAGE_LOAD_TIMEOUT_MS = 12_000;

/**
 * How long to let a page go QUIET before measuring it.
 *
 * This is the number that decides whether the vitals below are honest. A fixed short window can only
 * ever observe an LCP smaller than itself, so every page would score "good" — a false pass, which is
 * worse than no measurement at all. Waiting for network idle (capped here) lets most pages settle, and
 * when one does not, we record that and refuse to grade it.
 */
export const SETTLE_TIMEOUT_MS = 3_000;

/**
 * The app's own PAGE routes, read from its source.
 *
 * Covers the three conventions a generated app actually uses: React Router's `<Route path>`, Next's App
 * Router (`app/**\/page.tsx`) and its Pages Router (`pages/**\/*.tsx`).
 *
 * DYNAMIC ROUTES ARE SKIPPED, for the same reason RouteSmokeCheck skips path parameters: `/users/:id`
 * cannot be opened without inventing an id, an invented id renders "not found", and reporting that as a
 * broken page would be a false alarm about working code. False alarms are what teach people to ignore
 * the report. HOME is skipped too — the preview verifier already proved it renders. PURE.
 */
export function extractPageRoutes(files: Record<string, string> | null | undefined): string[] {
  const map = files && typeof files === 'object' ? files : {};
  const found = new Set<string>();

  const add = (raw: string): void => {
    let p = String(raw || '').trim();
    if (!p.startsWith('/')) return;                 // relative/nested route fragments need a parent to mean anything
    if (/[:*]|\[|\]/.test(p)) return;               // dynamic segment — see the note above
    p = p.replace(/\/+$/, '') || '/';
    if (p === '/') return;                          // already proven by the preview verifier
    found.add(p);
  };

  for (const [path, content] of Object.entries(map)) {
    // Build output lives at the ROOT of a project far more often than nested, so the pattern has to
    // anchor on a path START as well as a slash — the first version required `/dist/` and therefore let
    // a top-level `dist/App.tsx` through, which is the common case. Caught by its own test.
    if (/(^|\/)(node_modules|dist|build|out|coverage|\.next|\.output)\//.test(path)) continue;

    // React Router — the element is what makes it a page, so a bare `path` string elsewhere is ignored.
    if (/\.(t|j)sx$/.test(path)) {
      for (const m of String(content ?? '').matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["']/g)) add(m[1]);
    }

    // Next App Router: app/dashboard/page.tsx -> /dashboard. Route GROUPS `(marketing)` are organisational
    // and carry no URL segment, so they are dropped rather than turned into a path nobody can visit.
    const appRoute = /(?:^|\/)app\/(.*)page\.(?:t|j)sx?$/.exec(path);
    if (appRoute) {
      const segs = appRoute[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s));
      add('/' + segs.join('/'));
      continue;
    }

    // Next Pages Router. `api/` is not a page, and `_app`/`_document` are not routes.
    const pagesRoute = /(?:^|\/)pages\/(.+)\.(?:t|j)sx?$/.exec(path);
    if (pagesRoute && !/^api\//.test(pagesRoute[1]) && !/(^|\/)_/.test(pagesRoute[1])) {
      add('/' + pagesRoute[1].replace(/\/?index$/, ''));
    }
  }

  return Array.from(found).sort().slice(0, MAX_PAGE_ROUTES);
}

/**
 * The in-sandbox script that opens each route in the PRE-BAKED browser.
 *
 * Written through a quoted heredoc rather than `node -e`, so the JavaScript never has to survive a
 * round of shell quoting — a single stray quote in a generated route would otherwise turn a check into
 * a syntax error nobody would attribute to this file.
 *
 * It reports three things per route, and they mean different things:
 *   status  — the HTTP answer, so a real 500 is not confused with a blank render;
 *   text    — how much text the page actually painted, which is the ONLY way to catch a 200 that
 *             renders nothing (the failure this whole module exists for);
 *   errors  — uncaught page errors and console errors, capped so one noisy page cannot flood the log.
 * PURE string builder.
 */
export function pageCheckScript(previewUrl: string, routes: string[]): string {
  const base = previewUrl.replace(/\/+$/, '');
  const list = JSON.stringify(routes);
  return `cat > /tmp/nbai-pagecheck.mjs <<'NBAI_EOF'
// ABSOLUTE PATH, NOT NODE_PATH. This script is an ES module, and NODE_PATH is honoured only by CJS
// require() — an ESM import ignores it entirely and dies with ERR_MODULE_NOT_FOUND. The first version
// relied on NODE_PATH and would therefore have failed on EVERY build, silently: the trailing || true
// and the grep swallow the error, so the run simply produces no result lines. Verified both ways.
// (No backticks anywhere in this script: it lives inside a TypeScript template literal, where one would
// close the literal. That mistake has been made twice here; tsc catches it, which is why it is caught.)
import { chromium } from '${TOOLS_DIR}/node_modules/playwright/index.js';
const base = ${JSON.stringify(base)};
const routes = ${list};
const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const route of routes) {
  const out = { route, status: null, text: 0, errors: [], settled: false, vitals: null, a11y: [] };
  const page = await browser.newPage();
  page.on('pageerror', (e) => { if (out.errors.length < 3) out.errors.push(String(e.message).slice(0, 200)); });
  page.on('console', (m) => { if (m.type() === 'error' && out.errors.length < 3) out.errors.push(String(m.text()).slice(0, 200)); });
  try {
    const res = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: ${PAGE_LOAD_TIMEOUT_MS} });
    out.status = res ? res.status() : null;
    // A client-rendered app paints AFTER domcontentloaded, so wait for the page to go QUIET rather than
    // for a fixed guess. This is also what makes the numbers below honest: a fixed 1.2s window could
    // only ever observe an LCP under 1.2s, so every page would score "good" — a false pass. When the
    // page does NOT settle in time we say so, and refuse to grade it, instead of reporting a floor as
    // if it were the real value. On a quick preview networkidle usually resolves well under the cap,
    // so in practice this is often FASTER than the fixed wait it replaced.
    out.settled = await page.waitForLoadState('networkidle', { timeout: ${SETTLE_TIMEOUT_MS} }).then(() => true).catch(() => false);
    await page.waitForTimeout(300);
    out.text = await page.evaluate(() => (document.body ? document.body.innerText.trim().length : 0));
    // Real Web Vitals, read from the page itself — no Lighthouse, no extra navigation, no dependency.
    // buffered:true hands us the entries that already happened before we started observing.
    out.vitals = await page.evaluate(() => new Promise((resolve) => {
      let lcp = 0; let cls = 0;
      try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); })
          .observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      } catch (err) { /* an engine without these entry types reports nothing rather than a wrong number */ }
      const nav = performance.getEntriesByType('navigation')[0];
      setTimeout(() => resolve({ lcp: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, ttfb: nav ? Math.round(nav.responseStart) : null }), 200);
    }));
    // A focused accessibility pass — see the module header for why these six and not a library.
    out.a11y = await page.evaluate(() => {
      const issues = [];
      const named = (el) => !!(el.getAttribute('aria-label') || el.getAttribute('title')
        || el.getAttribute('aria-labelledby') || (el.textContent || '').trim()
        || el.querySelector('img[alt]:not([alt=\"\"])'));
      const hidden = (el) => el.getAttribute('aria-hidden') === 'true' || el.getAttribute('role') === 'presentation';
      const add = (rule, nodes) => { if (nodes.length) issues.push({ rule, count: nodes.length, example: (nodes[0].outerHTML || '').slice(0, 120) }); };
      if (!document.documentElement.getAttribute('lang')) issues.push({ rule: 'html-lang', count: 1, example: '<html>' });
      if (!(document.title || '').trim()) issues.push({ rule: 'page-title', count: 1, example: '<title>' });
      add('image-alt', [...document.querySelectorAll('img')].filter((el) => !hidden(el) && el.getAttribute('alt') === null));
      add('button-name', [...document.querySelectorAll('button,[role=\"button\"]')].filter((el) => !hidden(el) && !named(el)));
      add('link-name', [...document.querySelectorAll('a[href]')].filter((el) => !hidden(el) && !named(el)));
      add('input-label', [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter((el) => {
        if (hidden(el)) return false;
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
        if (el.id && document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]')) return false;
        return !el.closest('label');
      }));
      return issues;
    });
  } catch (e) {
    out.errors.push(String(e && e.message ? e.message : e).slice(0, 200));
  }
  await page.close().catch(() => {});
  console.log('NBAI_PAGE:' + JSON.stringify(out));
}
await browser.close().catch(() => {});
NBAI_EOF
PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers node /tmp/nbai-pagecheck.mjs 2>&1 | grep '^NBAI_PAGE:' || true`;
}

export type PageVerdict = 'ok' | 'blank' | 'server-error' | 'script-error' | 'unreachable';

/** What the page reported about itself. Absent when the browser could not measure it. */
export interface PageVitals {
  /** Largest Contentful Paint, ms. */
  lcp: number;
  /** Cumulative Layout Shift, unitless. */
  cls: number;
  /** Time to first byte, ms — null when the navigation entry was unavailable. */
  ttfb: number | null;
}

/** One accessibility problem found on a page, with a real example rather than a count alone. */
export interface A11yIssue { rule: string; count: number; example: string }

export interface PageResult {
  route: string;
  status: number | null;
  text: number;
  /** Did the page go quiet before we measured it? When false, the vitals are NOT graded. */
  settled?: boolean;
  vitals?: PageVitals | null;
  a11y?: A11yIssue[];
  errors: string[];
  verdict: PageVerdict;
  /** What this means, in the words the report should use. */
  note: string;
}

/**
 * What one route's answer actually means.
 *
 * The order is the point. A 500 is a server problem and says so; a page that answered 200 and painted
 * NOTHING is the finding this module exists for and must not be softened into "had some console
 * errors"; and console errors on a page that DID render are worth reporting but are not a broken page —
 * calling them one would fail apps that log a warning, i.e. most of them. PURE.
 */
export function classifyPage(r: { route: string; status: number | null; text: number; errors: string[] }): PageResult {
  const base = { route: r.route, status: r.status, text: r.text, errors: r.errors };
  if (r.status === null) {
    return { ...base, verdict: 'unreachable', note: `${r.route} could not be opened at all${r.errors[0] ? ` (${r.errors[0]})` : ''}` };
  }
  if (r.status >= 500) {
    return { ...base, verdict: 'server-error', note: `${r.route} answered ${r.status} — the server failed on this route` };
  }
  // THE ONE THIS EXISTS FOR: a good status and an empty page. Every other check would call this a pass.
  if (r.text === 0) {
    return { ...base, verdict: 'blank', note: `${r.route} answered ${r.status} but rendered NOTHING — the page loaded and painted an empty screen${r.errors[0] ? ` (${r.errors[0]})` : ''}` };
  }
  if (r.errors.length > 0) {
    return { ...base, verdict: 'script-error', note: `${r.route} rendered, but threw errors in the browser (${r.errors[0]})` };
  }
  return { ...base, verdict: 'ok', note: `${r.route} rendered` };
}

/**
 * Grade the vitals — or honestly refuse to.
 *
 * TWO RULES, BOTH HONESTY RATHER THAN TASTE:
 *
 *  1. AN UNSETTLED PAGE IS NOT GRADED. The observation window can only ever see an LCP smaller than
 *     itself, so grading a page that never went quiet would report "good" for the slowest pages in the
 *     app — precisely backwards, and a false pass is worse than no measurement.
 *
 *  2. ONLY CLEARLY-BAD VALUES ARE FLAGGED, and the numbers are labelled as what they are: a measurement
 *     taken inside a 2-vCPU sandbox on a cold dev server, not the user's machine on a production build.
 *     Reporting a sandbox LCP as if it were someone's real experience would frighten people about an app
 *     that is fine. So the thresholds are Google's own, applied only to call out the genuinely poor.
 * PURE.
 */
export function vitalsVerdict(r: { settled?: boolean; vitals?: PageVitals | null }): { graded: boolean; poor: string[]; note: string } {
  const v = r.vitals;
  if (!v) return { graded: false, poor: [], note: '' };
  if (!r.settled) {
    return { graded: false, poor: [], note: `still loading when the check ended — LCP was at least ${Math.round(v.lcp)}ms, so it was not graded` };
  }
  const poor: string[] = [];
  if (v.lcp > 4000) poor.push(`slow to show its main content (LCP ${Math.round(v.lcp)}ms)`);
  if (v.cls > 0.25) poor.push(`content jumps around while loading (CLS ${v.cls})`);
  return {
    graded: true,
    poor,
    note: poor.length > 0 ? poor.join(', ') : `LCP ${Math.round(v.lcp)}ms, CLS ${v.cls}`,
  };
}

/** Read the script's marker lines. Anything unparseable is dropped rather than guessed at. PURE. */
export function parsePageCheck(stdout: string | null | undefined): PageResult[] {
  const out: PageResult[] = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('NBAI_PAGE:');
    if (at < 0) continue;
    try {
      const raw = JSON.parse(line.slice(at + 'NBAI_PAGE:'.length)) as { route?: unknown; status?: unknown; text?: unknown; errors?: unknown; settled?: unknown; vitals?: unknown; a11y?: unknown };
      if (typeof raw.route !== 'string' || !raw.route) continue;
      const rv = raw.vitals as { lcp?: unknown; cls?: unknown; ttfb?: unknown } | null | undefined;
      out.push({
        ...classifyPage({
          route: raw.route,
          status: typeof raw.status === 'number' ? raw.status : null,
          text: typeof raw.text === 'number' ? raw.text : 0,
          errors: Array.isArray(raw.errors) ? raw.errors.filter((e): e is string => typeof e === 'string') : [],
        }),
        settled: raw.settled === true,
        a11y: Array.isArray(raw.a11y)
          ? (raw.a11y as unknown[]).filter((i): i is A11yIssue =>
              !!i && typeof (i as A11yIssue).rule === 'string' && typeof (i as A11yIssue).count === 'number')
          : [],
        // A partial vitals object is not a measurement — take it only when both numbers are real.
        vitals: rv && typeof rv.lcp === 'number' && typeof rv.cls === 'number'
          ? { lcp: rv.lcp, cls: rv.cls, ttfb: typeof rv.ttfb === 'number' ? rv.ttfb : null }
          : null,
      });
    } catch { /* a truncated line is not evidence — dropping it is honest, inventing a verdict is not */ }
  }
  return out;
}

/** How each accessibility rule reads to someone who did not write the checker. */
const A11Y_LABELS: Record<string, string> = {
  'html-lang': 'the page does not say what language it is in',
  'page-title': 'the page has no title',
  'image-alt': 'images with no alt text',
  'button-name': 'buttons a screen reader cannot name',
  'link-name': 'links a screen reader cannot name',
  'input-label': 'form fields with no label',
};

/**
 * The accessibility line, in plain words.
 *
 * DELIBERATELY NOT CALLED "axe" OR "WCAG". Injecting axe-core would mean pushing ~500 KB through a
 * sandbox command whose size limit cannot be verified from here, and shipping an unverified mechanism is
 * a mistake this codebase has already paid for. These six checks are the ones generated apps actually
 * fail; each is reported as the specific thing it is. Claiming full coverage would be the lie — finding
 * real problems is not. Verified in a real browser against a deliberately-bad page (all six found) and a
 * correct one (nothing found). PURE.
 */
export function a11ySummary(results: PageResult[]): string {
  const totals = new Map<string, number>();
  for (const r of results) for (const i of r.a11y ?? []) totals.set(i.rule, (totals.get(i.rule) ?? 0) + i.count);
  if (totals.size === 0) return '';
  const parts = [...totals.entries()].map(([rule, n]) => {
    const label = A11Y_LABELS[rule] ?? rule;
    return /^the page/.test(label) ? label : `${n} ${label}`;
  });
  return ` Accessibility: ${parts.join(', ')}.`;
}

/**
 * How many accessibility problems the browser actually found, across every page checked.
 *
 * Exported as a NUMBER, not re-derived from the summary sentence, because the release gate needs the
 * same fact and parsing prose back into a count is how two parts of one report end up disagreeing.
 */
export function a11yIssueCount(results: readonly PageResult[]): number {
  let n = 0;
  for (const r of results ?? []) for (const i of r.a11y ?? []) n += i.count;
  return n;
}

/**
 * How many routes were measured and found genuinely poor.
 *
 * A page that never settled is NOT counted — it was not graded, and counting an ungraded page as slow
 * would be inventing the measurement that `vitalsVerdict` explicitly refuses to make.
 */
export function slowRouteCount(results: readonly PageResult[]): number {
  return (results ?? []).filter((r) => vitalsVerdict(r).poor.length > 0).length;
}

/**
 * The one line the report carries.
 *
 * Says how many were CHECKED as well as how many passed, because "3 pages render" means nothing without
 * knowing whether the app has 3 pages or 30. PURE.
 */
export function summarizePageCheck(results: PageResult[], attempted = results.length): { ok: boolean; summary: string } {
  // "Nothing to check" and "the check produced nothing" are different facts, and only the first is good
  // news. Collapsing them would have reported a check that never ran as a clean result — which is what
  // the NODE_PATH bug above would have done on every single build.
  if (results.length === 0) {
    return attempted > 0
      ? { ok: false, summary: `The page-render check could not be completed for ${attempted} route${attempted === 1 ? '' : 's'} — it produced no result, so nothing about those pages was verified.` }
      : { ok: true, summary: 'No additional page routes were found to check.' };
  }
  const bad = results.filter((r) => r.verdict !== 'ok');
  // Performance is reported ALONGSIDE the render verdict, never as one: a slow page still renders, and
  // failing a build over a number measured on a 2-vCPU sandbox would be a false alarm about a fine app.
  const slow = results.map((r) => ({ route: r.route, v: vitalsVerdict(r) })).filter((x) => x.v.poor.length > 0);
  const perf = slow.length > 0
    ? ` Measured in the preview sandbox (not your users' devices): ${slow.map((x) => `${x.route} is ${x.v.poor.join(' and ')}`).join('; ')}.`
    : '';
  // Accessibility rides along for the same reason performance does: a page with an unlabelled button
  // still rendered, and failing a build over it would be a false alarm about a working app.
  const a11y = a11ySummary(results);
  if (bad.length === 0) {
    return { ok: true, summary: `All ${results.length} page route${results.length === 1 ? '' : 's'} opened in a browser and rendered.${perf}${a11y}` };
  }
  return {
    ok: false,
    summary: `${bad.length} of ${results.length} page route${results.length === 1 ? '' : 's'} did not render correctly: ${bad.map((r) => r.note).join('; ')}.${perf}${a11y}`,
  };
}
