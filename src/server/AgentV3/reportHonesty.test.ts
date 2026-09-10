import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTestOutcome, reportedNoTestResults } from './testRunner';
import { BuildDiagnostics, isRecoverableOnSuccess, classifyProviderFailure } from './BuildDiagnostics';
import { isSpaMountShell, analyzeHtmlPage, analyzeDesignCoverage } from './DesignCoverage';
import { journeyCandidates, noJourneyReason } from './journeyDerivation';

/**
 * FOUR THINGS THE 2026-08-12 REPORT SAID THAT WERE NOT TRUE.
 *
 * None of them broke an app. All of them told the admin something false about one — which is the same
 * class of harm, because a report that is wrong in small ways is a report nobody reads carefully, and
 * then the one that matters goes unread too.
 */

describe('a recovered preview failure is not a successful build\'s root cause', () => {
  it('PREVIEW_NOT_RENDERED is forgiven when the build ultimately succeeded', () => {
    // The real report: the preview went down mid-build, was restarted, was then verified rendering by a
    // real browser — and "nothing is listening on that port" was still printed as the ROOT CAUSE.
    expect(isRecoverableOnSuccess('PREVIEW_NOT_RENDERED')).toBe(true);
  });

  it('the TERMINAL preview failure is NOT forgiven — those are different findings', () => {
    // OUTCOME_PREVIEW_FAILED means the heal budget was spent and it still did not render. Forgiving
    // that would turn a genuinely broken preview into a clean report.
    expect(isRecoverableOnSuccess('OUTCOME_PREVIEW_FAILED')).toBe(false);
  });

  it('on a FAILED build it stays unresolved — success is what earns the forgiveness', () => {
    const d = new BuildDiagnostics({});
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'closed port', autoResolved: false });
    d.finish(false);
    expect(d.report().issues.find((i) => i.code === 'PREVIEW_NOT_RENDERED')?.autoResolved).toBe(false);
  });

  it('on a SUCCESSFUL build it is resolved and cannot be the root cause', () => {
    const d = new BuildDiagnostics({});
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'closed port', autoResolved: false });
    d.finish(true, 'The app is built and the preview renders.');
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'PREVIEW_NOT_RENDERED')?.autoResolved).toBe(true);
    expect(r.rootCause ?? '').not.toContain('closed port');
  });
});

describe('a bare FAIL with no evidence must say what it cannot rule out', () => {
  const vitest = { framework: 'vitest' as const, command: 'npx vitest run', reason: 'x' };

  it('THE VERDICT DOES NOT CHANGE — a failure stays a failure', () => {
    // My first attempt made "no tally" mean "could not run". The existing suite rejected it for a
    // better reason than the one I had: hiding genuinely failing tests behind a reassuring
    // "unverified" is the opposite mistake and a more damaging one.
    const o = parseTestOutcome(vitest, 1, 'something went wrong', '');
    expect(o.ran).toBe(true);
    expect(o.ok).toBe(false);
  });

  it('but it now admits it cannot tell a failing test from a dead runner', () => {
    // The real defect in `playwright: FAIL (exit=1)` was never the verdict — it was the silence.
    const o = parseTestOutcome(vitest, 1, 'something went wrong', '');
    expect(o.summary).toContain('reported no test results');
    expect(o.summary).toContain('failing to start');
  });

  it('a run WITH counts says nothing extra — no noise on a clear result', () => {
    const o = parseTestOutcome(vitest, 1, 'Tests  2 failed | 5 passed (7)', '');
    expect(o.summary).toContain('FAIL');
    expect(o.summary).not.toContain('reported no test results');
  });

  it('a PASSING run is never annotated', () => {
    expect(parseTestOutcome(vitest, 0, 'Tests  5 passed (5)', '').summary).not.toContain('reported no test results');
  });

  it('an explicit infra signature still downgrades, and says more', () => {
    const o = parseTestOutcome(vitest, 1, "Executable doesn't exist at /root/.cache/ms-playwright", '');
    expect(o.ran).toBe(false);
    expect(o.summary).toContain('COULD NOT RUN');
  });

  it('reportedNoTestResults reads a tally in every runner\'s dialect', () => {
    for (const out of ['2 passed, 1 failed', 'Tests: 3 failed, 5 passed', '1 passing', '4/7 tests passed']) {
      expect(reportedNoTestResults(out), out).toBe(false);
    }
    expect(reportedNoTestResults('Error: boom')).toBe(true);
  });
});

describe('the build says how long it waited before it started thinking', () => {
  it('records the gap on the first model call', () => {
    // 227 seconds of that build happened before the first call, with heartbeats saying "still working"
    // and SETUP_TIMING claiming "Workspace ready in 0s".
    let now = 1_000_000;
    const d = new BuildDiagnostics({});
    (d as unknown as { now: () => number }).now = () => now;
    (d as unknown as { startedAt: number }).startedAt = now;
    now += 227_000;
    d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    const issue = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(issue?.message).toContain('227s');
    expect(issue?.severity).toBe('warning');
  });

  it('a quick start is recorded too, quietly — the number nobody records is the one that grows', () => {
    let now = 1_000_000;
    const d = new BuildDiagnostics({});
    (d as unknown as { now: () => number }).now = () => now;
    (d as unknown as { startedAt: number }).startedAt = now;
    now += 8_000;
    d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    const issue = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(issue?.severity).toBe('info');
    expect(issue?.autoResolved).toBe(true);
  });

  it('it is recorded ONCE, not on every call', () => {
    const d = new BuildDiagnostics({});
    for (let i = 0; i < 5; i += 1) {
      d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    }
    expect(d.report().issues.filter((i) => i.code === 'TIME_TO_FIRST_CALL')).toHaveLength(1);
  });
});

describe('the E2E decision judges the project, not this turn\'s writes', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('it loads the real project before deciding', () => {
    // An edit build that wrote one `.env` was judged on that one file and skipped with the reason
    // "this project has no user interface for a browser to load" — for a React app. The decision was
    // arguably right; the REASON was false, which is worse, because it tells the user something untrue
    // about their own app.
    expect(routes).toContain('const projectFiles = await loadWorkspaceFiles(workspaceId)');
    expect(routes).toContain('{ ...projectFiles, ...Object.fromEntries(writtenFiles) }');
  });
});

/**
 * TWO FALSE REASONS THE FIRST REAL BUILD PRODUCED (2026-08-12).
 *
 * Neither broke anything. Both told the admin something untrue about his own app, which is how a report
 * stops being read.
 */
describe('an SPA mount shell is not a page', () => {
  const SHELL = `<!doctype html><html><head><title>Game</title></head><body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
    <meta a><meta b><meta c><meta d><meta e>
  </body></html>`;

  it('index.html is not judged for having no heading — React renders the heading', () => {
    // This fired on the very first build: "index.html does not match the app's own design standard
    // (NO_HEADING; 0% of its elements carry a class)". It would fire on essentially every app this
    // platform builds, about the one file that is SUPPOSED to look like that.
    expect(isSpaMountShell(SHELL)).toBe(true);
    expect(analyzeHtmlPage('index.html', SHELL)).toBeNull();
  });

  it('nor is it COUNTED — otherwise "1 of 1 pages fall short" is still wrong', () => {
    const r = analyzeDesignCoverage({ 'index.html': SHELL });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a REAL static page with no stylesheet is still caught — this is what the check is for', () => {
    const bare = '<html><body><h1>About</h1><p>a</p><p>b</p><p>c</p><p>d</p><p>e</p></body></html>';
    expect(isSpaMountShell(bare)).toBe(false);
    expect(analyzeHtmlPage('about.html', bare)?.defects).toContain('NO_STYLESHEET');
  });

  it('BOTH signals are required — a mount root alone is not an SPA shell', () => {
    // A genuine static page may contain a div#app, and a page may load a module. Neither alone means
    // the visible content arrives from JavaScript.
    expect(isSpaMountShell('<div id="app"></div>')).toBe(false);
    expect(isSpaMountShell('<script type="module" src="/x.js"></script>')).toBe(false);
  });
});

describe('the journey reason describes the search that actually happened', () => {
  it('a single-file app is NOT "no page components were found"', () => {
    // The first build said exactly that about a React game whose whole UI lives in src/App.tsx — a
    // file deriveJourneys looks at and noJourneyReason did not. One candidate list now serves both.
    const game = { 'src/App.tsx': '<canvas /><div>Score</div>' };
    expect(journeyCandidates(game)).toEqual(['src/App.tsx']);
    expect(noJourneyReason(game)).toContain('no form');
  });

  it('a project with genuinely no pages still says so', () => {
    expect(noJourneyReason({ 'src/util.ts': 'export const x = 1;' })).toContain('no page components');
  });

  it('the candidate list is deterministic and shared', () => {
    const files = { 'src/pages/B.tsx': 'x', 'src/pages/A.tsx': 'x', 'src/App.tsx': 'x' };
    expect(journeyCandidates(files)).toEqual(['src/pages/A.tsx', 'src/pages/B.tsx', 'src/App.tsx']);
  });
});

/**
 * "GLM: 21" WITH NO REASON IS A NUMBER YOU CAN ONLY WORRY ABOUT (BENCHMARK 0, 2026-08-12).
 *
 * That report carried `providerFailures: {GLM: 21, KIMI: 3}` and FOUR timeline entries, because
 * record() collapses consecutive identical messages and every one reads "Provider GLM failed — falling
 * back to the next provider". Twenty of the twenty-four error messages were thrown away, so the largest
 * struggle signal in the whole build could not be diagnosed at all.
 */
describe('a provider failure keeps its reason, not just its count', () => {
  it('buckets the reasons so 21 failures become one readable line', () => {
    const d = new BuildDiagnostics({});
    for (let i = 0; i < 18; i += 1) d.recordProviderFailure('GLM', new Error('429 Too Many Requests'));
    for (let i = 0; i < 2; i += 1) d.recordProviderFailure('GLM', new Error('socket timeout'));
    d.recordProviderFailure('GLM', new Error('400 invalid request'));
    expect(d.providerFailureBreakdown().GLM).toBe('18 rate-limit, 2 timeout, 1 bad-request');
  });

  it('the count still works, and the breakdown reaches the report', () => {
    const d = new BuildDiagnostics({});
    d.recordProviderFailure('KIMI', new Error('429'));
    const r = d.report();
    expect(r.providerFailures).toEqual({ KIMI: 1 });
    expect(r.providerFailureReasons).toEqual({ KIMI: '1 rate-limit' });
  });

  it('an UNRECOGNISED failure keeps its own text — a new failure mode must not vanish into "other"', () => {
    // The example changed on 2026-09-01 and the assertion did NOT. 'model glm-9 has been retired' used
    // to land here, and now classifies as `model-unavailable` — a real improvement, not a regression:
    // a retired model is the one failure a retry can never fix, and it was previously indistinguishable
    // from a passing blip. So this keeps testing the fallback branch, with an input that genuinely has
    // no bucket.
    expect(classifyProviderFailure(new Error('flux capacitor desynchronised at stage 3')))
      .toContain('flux capacitor desynchronised');
  });

  it('a model that can NEVER answer is its own bucket, not "other"', () => {
    // From a real build: 40 model calls, 57 KIMI failures, all "404 Not found the model kimi-k2.5 or
    // Permission denied" — the first rung of the free ladder, unreachable on this account. Landing in
    // `other:` is what let 56 of that build's 59 "self-heals" be one misconfiguration nobody saw.
    for (const m of [
      'model glm-9 has been retired',
      '404 Not found the model kimi-k2.5 or Permission denied',
      'no such model: gpt-legacy',
    ]) {
      expect(classifyProviderFailure(new Error(m)), m).toBe('model-unavailable');
    }
  });

  it('classifies the shapes that actually occur', () => {
    const cases: Array<[string, string]> = [
      ['429 Too Many Requests', 'rate-limit'],
      ['Request timed out after 60000ms', 'timeout'],
      ['401 Unauthorized: invalid api key', 'auth'],
      ['400 Bad Request', 'bad-request'],
      ['503 Service Unavailable', 'server-error'],
      ['ECONNRESET', 'network'],
      ['context length exceeded', 'context-length'],
    ];
    for (const [text, bucket] of cases) expect(classifyProviderFailure(new Error(text)), text).toBe(bucket);
  });

  it('a failure with no reason still counts — the tally never regresses', () => {
    const d = new BuildDiagnostics({});
    d.recordProviderFailure('GLM');
    expect(d.report().providerFailures).toEqual({ GLM: 1 });
    expect(d.report().providerFailureReasons).toBeUndefined();
  });

  it('the build passes the real error through, not just the name', () => {
    const routes = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
    ) as string;
    expect(routes).toContain('buildDiag.recordProviderFailure(name, err)');
  });
});
