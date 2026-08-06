import { describe, it, expect } from 'vitest';
import {
  extractPageRoutes, pageCheckScript, parsePageCheck, classifyPage, summarizePageCheck,
  MAX_PAGE_ROUTES, TOOLS_DIR, PAGE_LOAD_TIMEOUT_MS, SETTLE_TIMEOUT_MS, vitalsVerdict,
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

/**
 * REAL WEB VITALS, ON PAGES WE ALREADY OPEN (admin 2026-08-06).
 *
 * The roadmap listed "Lighthouse / Web-Vitals + axe-core over the LIVE preview" as BLOCKED — "needs
 * headless Chrome" — and called it the app's weakest measured category. Chromium is pre-baked in the
 * E2B image, and these pages are already being loaded, so LCP and CLS cost one extra in-page read and
 * no dependency at all.
 *
 * The danger is the measurement being WRONG rather than absent, so both honesty rules are locked here.
 */
describe('the observation window is what makes the numbers honest', () => {
  it('waits for the page to go QUIET rather than a fixed guess', () => {
    // A fixed short window can only ever observe an LCP smaller than itself, so every page would score
    // "good" — the slowest pages most confidently of all. That is a false pass, worse than no number.
    const script = pageCheckScript('https://x.e2b.app', ['/a']);
    expect(script).toContain("waitForLoadState('networkidle'");
    expect(script).toContain(`timeout: ${SETTLE_TIMEOUT_MS}`);
    expect(script).toContain('out.settled =');
  });

  it('reads real Web Vitals from the page, with no library', () => {
    const script = pageCheckScript('https://x.e2b.app', ['/a']);
    expect(script).toContain('largest-contentful-paint');
    expect(script).toContain('layout-shift');
    expect(script).toContain('buffered: true');
    expect(script).toContain('hadRecentInput'); // a shift the USER caused is not a layout problem
  });

  it('the generated JavaScript is valid — it is composed text, like the shell around it', () => {
    const script = pageCheckScript('https://x.e2b.app', ['/a', "/it's"]);
    const body = script.slice(script.indexOf('\n') + 1, script.indexOf('\nNBAI_EOF'));
    expect(() => new Function(`return (async () => {${body.replace(/^import .*$/m, '')}})`)).not.toThrow();
  });
});

describe('vitalsVerdict — refuses to grade what it could not see', () => {
  it('an UNSETTLED page is not graded, and says the value is only a floor', () => {
    const v = vitalsVerdict({ settled: false, vitals: { lcp: 2900, cls: 0.02, ttfb: 100 } });
    expect(v.graded).toBe(false);
    expect(v.poor).toEqual([]);
    expect(v.note).toContain('at least 2900ms');
    expect(v.note).toContain('not graded');
  });

  it('grades a settled page against Google\'s own thresholds', () => {
    expect(vitalsVerdict({ settled: true, vitals: { lcp: 1200, cls: 0.01, ttfb: 50 } }).poor).toEqual([]);
    expect(vitalsVerdict({ settled: true, vitals: { lcp: 5200, cls: 0.01, ttfb: 50 } }).poor[0]).toContain('LCP 5200ms');
    expect(vitalsVerdict({ settled: true, vitals: { lcp: 900, cls: 0.4, ttfb: 50 } }).poor[0]).toContain('CLS 0.4');
  });

  it('only CLEARLY-BAD values are flagged — a middling number is not an alarm', () => {
    // These are measured on a 2-vCPU sandbox against a cold dev server. Treating "needs improvement"
    // as a finding would frighten people about an app that is fine on their users' devices.
    expect(vitalsVerdict({ settled: true, vitals: { lcp: 3200, cls: 0.15, ttfb: 50 } }).poor).toEqual([]);
  });

  it('no measurement at all is silence, not a pass', () => {
    expect(vitalsVerdict({ settled: true, vitals: null }).note).toBe('');
    expect(vitalsVerdict({ settled: true }).graded).toBe(false);
  });
});

describe('performance is reported ALONGSIDE the render verdict, never as one', () => {
  it('a slow page still counts as rendered', () => {
    const r = { ...classifyPage({ route: '/a', status: 200, text: 50, errors: [] }), settled: true, vitals: { lcp: 6000, cls: 0, ttfb: 10 } };
    const s = summarizePageCheck([r]);
    expect(s.ok).toBe(true);                       // failing a build over a sandbox number is a false alarm
    expect(s.summary).toContain('rendered');
    expect(s.summary).toContain('LCP 6000ms');
  });

  it('says WHERE it was measured, so a sandbox number is not read as the user\'s experience', () => {
    const r = { ...classifyPage({ route: '/a', status: 200, text: 50, errors: [] }), settled: true, vitals: { lcp: 6000, cls: 0, ttfb: 10 } };
    expect(summarizePageCheck([r]).summary).toContain("preview sandbox (not your users' devices)");
  });

  it('a healthy page adds no performance noise at all', () => {
    const r = { ...classifyPage({ route: '/a', status: 200, text: 50, errors: [] }), settled: true, vitals: { lcp: 800, cls: 0, ttfb: 10 } };
    expect(summarizePageCheck([r]).summary).not.toContain('sandbox');
  });
});

describe('parsePageCheck carries the measurement, and refuses a partial one', () => {
  it('reads settled and vitals', () => {
    const line = 'NBAI_PAGE:{"route":"/a","status":200,"text":9,"errors":[],"settled":true,"vitals":{"lcp":1200,"cls":0.02,"ttfb":40}}';
    const [r] = parsePageCheck(line);
    expect(r.settled).toBe(true);
    expect(r.vitals).toEqual({ lcp: 1200, cls: 0.02, ttfb: 40 });
  });

  it('a half-filled vitals object is not a measurement', () => {
    const line = 'NBAI_PAGE:{"route":"/a","status":200,"text":9,"errors":[],"settled":true,"vitals":{"lcp":1200}}';
    expect(parsePageCheck(line)[0].vitals).toBeNull();
  });

  it('an older line without the new fields still parses', () => {
    const [r] = parsePageCheck('NBAI_PAGE:{"route":"/a","status":200,"text":9,"errors":[]}');
    expect(r.verdict).toBe('ok');
    expect(r.settled).toBe(false);
    expect(r.vitals).toBeNull();
  });
});
