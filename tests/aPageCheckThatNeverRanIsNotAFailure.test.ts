// Autopsy c6e4c6ff (2026-09-18) — one build report carried two contradicting sentences about ONE check:
//
//   PAGE_RENDER_FAILED  "The page-render check could not be completed for 6 routes — it produced no
//                        result, so nothing about those pages was verified."
//   RELEASE_GATE        "NOT established: the page-render check needs a running app and was skipped"
//
// The gate was the one telling the truth: it guards its own read on `pageResults.length > 0`. The
// report line could only read `ok`, so "we could not measure" was coded as "your pages failed".
//
// This is the JOURNEY_PASSED bug mirrored — there zero results were coded as a PASS, here as a
// FAILURE. Same two-state verdict for a three-state fact, same fix.
import { describe, it, expect } from 'vitest';
import { summarizePageCheck, type PageResult } from '../src/server/AgentV3/PageRouteCheck';

const ok = (route: string): PageResult => ({ route, verdict: 'ok', note: `${route} rendered` } as PageResult);
const bad = (route: string): PageResult => ({ route, verdict: 'error', note: `${route} threw` } as PageResult);

describe('the three outcomes are distinguishable', () => {
  it('the browser produced NOTHING for routes we attempted — not a failure of the app', () => {
    const s = summarizePageCheck([], 6);
    expect(s.ran).toBe(false);
    expect(s.ok).toBe(false);
    expect(s.summary).toContain('produced no result');
  });

  it('there was nothing to check — not a pass either', () => {
    const s = summarizePageCheck([], 0);
    expect(s.ran).toBe(false);
    // ok stays true so it is not a warning, but `ran` false means it can never be coded as evidence
    // that the pages work. "All 0 page routes rendered" is the same false claim in reverse.
    expect(s.ok).toBe(true);
    expect(s.summary).toContain('No additional page routes');
  });

  it('real results still pass and fail exactly as before', () => {
    const passed = summarizePageCheck([ok('/'), ok('/cart')], 2);
    expect(passed).toMatchObject({ ok: true, ran: true });
    expect(passed.summary).toContain('rendered');

    const failed = summarizePageCheck([ok('/'), bad('/cart')], 2);
    expect(failed).toMatchObject({ ok: false, ran: true });
    expect(failed.summary).toContain('did not render correctly');
  });
});

describe('the code the route picks — the thing a reader actually scans', () => {
  // Mirrors the route's own expression, so a change there without a change here is visible.
  const codeFor = (s: { ok: boolean; ran: boolean }): string =>
    !s.ran ? 'PAGE_RENDER_NOT_RUN' : s.ok ? 'PAGE_RENDER_PASSED' : 'PAGE_RENDER_FAILED';

  it('the exact case from the report is NOT_RUN, never FAILED', () => {
    expect(codeFor(summarizePageCheck([], 6))).toBe('PAGE_RENDER_NOT_RUN');
  });

  it('nothing to check is NOT_RUN, never PASSED', () => {
    expect(codeFor(summarizePageCheck([], 0))).toBe('PAGE_RENDER_NOT_RUN');
  });

  it('a genuine pass and a genuine failure keep their codes', () => {
    expect(codeFor(summarizePageCheck([ok('/')], 1))).toBe('PAGE_RENDER_PASSED');
    expect(codeFor(summarizePageCheck([bad('/')], 1))).toBe('PAGE_RENDER_FAILED');
  });
});

describe('a check that did not run can never count against the user app', () => {
  const fs = require('node:fs') as typeof import('node:fs');

  it('PAGE_RENDER_NOT_RUN is registered as process-only, beside JOURNEY_NOT_RUN', () => {
    const diag = fs.readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
    const block = diag.slice(diag.indexOf('const PROCESS_ONLY_CODES'), diag.indexOf('const PROCESS_ONLY_CODES') + 2000);
    expect(block).toContain("'PAGE_RENDER_NOT_RUN'");
  });

  it('and is never offered to the user as something to fix', () => {
    const sugg = fs.readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8');
    const block = sugg.slice(sugg.indexOf('const NEVER_SUGGEST'), sugg.indexOf('const NEVER_SUGGEST') + 600);
    expect(block).toContain("'PAGE_RENDER_NOT_RUN'");
  });
});

describe('REVERSION GUARD — the route must read `ran`', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const route = fs.readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the page-render code branches on ran first', () => {
    expect(route).toContain("!pageSummary.ran ? 'PAGE_RENDER_NOT_RUN'");
  });

  it('the release gate still guards its own evidence independently', () => {
    // The gate was already right, and must stay right on its own rather than relying on this fix.
    expect(route).toContain("if (pageResults.length > 0) gateEvidence.pages =");
  });
});
