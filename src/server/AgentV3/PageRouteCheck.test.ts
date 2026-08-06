import { describe, it, expect } from 'vitest';
import {
  extractPageRoutes, pageCheckScript, parsePageCheck, classifyPage, summarizePageCheck,
  MAX_PAGE_ROUTES, TOOLS_DIR, PAGE_LOAD_TIMEOUT_MS,
} from './PageRouteCheck';

/**
 * DOES EVERY PAGE RENDER, OR ONLY THE HOME ONE? (admin 2026-08-06.)
 *
 * Three checks already ran after a build and none covered this: the preview verifier loads HOME in a
 * browser, RouteSmokeCheck curls the API endpoints, and the console capture watches the page the preview
 * opened. So a React/Next app can answer 200 for `/dashboard`, throw during the client-side render, paint
 * a blank screen — and every one of them passes. That is the family the "Cannot GET /customer/home"
 * reports came from.
 */
describe('extractPageRoutes — the app\'s own pages, from its own source', () => {
  it('reads React Router routes', () => {
    const files = { 'src/App.tsx': '<Route path="/" element={<H/>}/><Route path="/dashboard" element={<D/>}/><Route path="/settings" element={<S/>}/>' };
    expect(extractPageRoutes(files)).toEqual(['/dashboard', '/settings']);
  });

  it('reads the Next App Router, dropping route GROUPS that carry no URL segment', () => {
    const files = { 'app/page.tsx': 'x', 'app/dashboard/page.tsx': 'x', 'app/(marketing)/pricing/page.tsx': 'x' };
    expect(extractPageRoutes(files)).toEqual(['/dashboard', '/pricing']);
  });

  it('reads the Next Pages Router, and knows api/ and _app are not pages', () => {
    const files = { 'pages/index.tsx': 'x', 'pages/about.tsx': 'x', 'pages/api/hello.ts': 'x', 'pages/_app.tsx': 'x', 'pages/_document.tsx': 'x' };
    expect(extractPageRoutes(files)).toEqual(['/about']);
  });

  it('SKIPS home — the preview verifier already proved it, and paying twice buys nothing', () => {
    expect(extractPageRoutes({ 'src/App.tsx': '<Route path="/" element={<H/>}/>' })).toEqual([]);
    expect(extractPageRoutes({ 'app/page.tsx': 'x' })).toEqual([]);
    expect(extractPageRoutes({ 'pages/index.tsx': 'x' })).toEqual([]);
  });

  it('SKIPS dynamic routes — an invented id renders "not found", which we would report as broken', () => {
    // False alarms about working code are what teach people to ignore the report.
    const files = {
      'src/App.tsx': '<Route path="/users/:id" element={<U/>}/><Route path="/ok" element={<O/>}/>',
      'app/posts/[slug]/page.tsx': 'x',
      'pages/blog/[id].tsx': 'x',
    };
    expect(extractPageRoutes(files)).toEqual(['/ok']);
  });

  it('ignores build output and dependencies — including at the project ROOT', () => {
    // The first version of the filter required `/dist/` with a leading slash, so a top-level
    // `dist/App.tsx` — the common case — was read as source. Caught by this test.
    for (const dir of ['node_modules/x', 'dist', 'build', 'out', '.next', 'coverage', 'src/dist']) {
      expect(extractPageRoutes({ [`${dir}/App.tsx`]: '<Route path="/nope" element={<N/>}/>' }), dir).toEqual([]);
    }
  });

  it('is bounded — a 40-page app must not add minutes to every build', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) many[`app/p${i}/page.tsx`] = 'x';
    expect(extractPageRoutes(many)).toHaveLength(MAX_PAGE_ROUTES);
  });

  it('never throws on junk input', () => {
    expect(extractPageRoutes(null)).toEqual([]);
    expect(extractPageRoutes({})).toEqual([]);
  });
});

describe('pageCheckScript — cheap by construction', () => {
  const script = pageCheckScript('https://3000-abc.e2b.app/', ['/dashboard']);

  it('uses the PRE-BAKED browser — no download, no npm install', () => {
    // Playwright 1.49.1 and Chromium are baked into both E2B images; the ~300 MB is paid once at
    // template-build time. This is what makes running it by default defensible.
    expect(script).toContain(`NODE_PATH=${TOOLS_DIR}/node_modules`);
    expect(script).toContain(`PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers`);
    expect(script).not.toContain('npm install');
    expect(script).not.toContain('playwright install');
  });

  it('never touches the user\'s project — the script lives in /tmp', () => {
    expect(script).toContain('/tmp/nbai-pagecheck.mjs');
  });

  it('passes the JavaScript through a QUOTED heredoc, so shell quoting cannot corrupt it', () => {
    // A single stray quote in a generated route would otherwise become a syntax error nobody would
    // attribute to this file.
    expect(script).toContain("<<'NBAI_EOF'");
    expect(script).toContain('NBAI_EOF\n');
  });

  it('bounds every page load', () => {
    expect(script).toContain(`timeout: ${PAGE_LOAD_TIMEOUT_MS}`);
  });

  it('measures PAINTED TEXT, which is the only way to catch a 200 that renders nothing', () => {
    expect(script).toContain('document.body.innerText.trim().length');
    // …and waits, because a client-rendered app paints after domcontentloaded.
    expect(script).toContain('waitForTimeout');
  });

  it('cannot fail the step — the command ends in a tolerant filter', () => {
    expect(script.trim().endsWith('|| true')).toBe(true);
  });
});

describe('classifyPage — the order is the point', () => {
  it('a 200 that painted NOTHING is the finding, not a footnote', () => {
    const r = classifyPage({ route: '/dashboard', status: 200, text: 0, errors: [] });
    expect(r.verdict).toBe('blank');
    expect(r.note).toContain('rendered NOTHING');
  });

  it('a real server error says so instead of being called blank', () => {
    expect(classifyPage({ route: '/x', status: 500, text: 0, errors: [] }).verdict).toBe('server-error');
  });

  it('console errors on a page that DID render are reported, but are not a broken page', () => {
    // Calling them one would fail every app that logs a warning — i.e. most of them.
    const r = classifyPage({ route: '/x', status: 200, text: 120, errors: ['Warning: x'] });
    expect(r.verdict).toBe('script-error');
    expect(r.note).toContain('rendered, but threw errors');
  });

  it('a page that rendered cleanly passes', () => {
    expect(classifyPage({ route: '/x', status: 200, text: 120, errors: [] }).verdict).toBe('ok');
  });

  it('no status at all is unreachable, not a 200', () => {
    expect(classifyPage({ route: '/x', status: null, text: 0, errors: ['timeout'] }).verdict).toBe('unreachable');
  });
});

describe('parsePageCheck — drop what cannot be read, never guess', () => {
  it('reads the marker lines and ignores everything else', () => {
    const out = [
      'some unrelated log line',
      'NBAI_PAGE:{"route":"/a","status":200,"text":50,"errors":[]}',
      'NBAI_PAGE:{"route":"/b","status":200,"text":0,"errors":[]}',
    ].join('\n');
    const results = parsePageCheck(out);
    expect(results.map((r) => r.verdict)).toEqual(['ok', 'blank']);
  });

  it('a truncated line is dropped — inventing a verdict would be worse than missing one', () => {
    expect(parsePageCheck('NBAI_PAGE:{"route":"/a","stat')).toEqual([]);
    expect(parsePageCheck('NBAI_PAGE:{"status":200}')).toEqual([]); // no route
    expect(parsePageCheck('')).toEqual([]);
    expect(parsePageCheck(null)).toEqual([]);
  });
});

describe('summarizePageCheck — says how many were CHECKED, not just how many passed', () => {
  it('"3 pages render" means nothing without knowing the app has 3 pages or 30', () => {
    const ok = summarizePageCheck([
      classifyPage({ route: '/a', status: 200, text: 10, errors: [] }),
      classifyPage({ route: '/b', status: 200, text: 10, errors: [] }),
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.summary).toContain('All 2 page routes');
  });

  it('names every failure, so the report is actionable', () => {
    const bad = summarizePageCheck([
      classifyPage({ route: '/a', status: 200, text: 10, errors: [] }),
      classifyPage({ route: '/b', status: 200, text: 0, errors: [] }),
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain('1 of 2');
    expect(bad.summary).toContain('/b');
  });

  it('nothing to check is honest, not a pass with a false claim', () => {
    expect(summarizePageCheck([]).summary).toContain('No additional page routes');
  });
});
