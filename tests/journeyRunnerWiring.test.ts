// The journey check's three fixes, asserted where they actually take effect.
//
// AUTOPSY e706e068 RESIDUE (2026-09-17). `journeyScript` built its own run line and omitted
// PLAYWRIGHT_BROWSERS_PATH, so Chromium — which exists ONLY under /home/user/.e-tools/.browsers —
// was never found and `chromium.launch()` threw before the first journey, on every build since the
// check shipped. The same line's `2>&1 | grep '^NBAI_JOURNEY ' || true` folded stderr in, dropped it,
// and hid the exit code, so the failure was unobservable. And `summarizeJourneys([])` returned
// `ok: true`, which the route turned into code JOURNEY_PASSED at severity info.
//
// The unit behaviour is pinned beside each module. What is pinned HERE is the wiring: the route must
// hand over what the summaries need and must not code a check that never ran as one that passed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('the route hands the checks what they need to explain themselves', () => {
  it('the journey summary is told how many were ATTEMPTED and what the runner said', () => {
    // Without `attempted` it cannot tell "nothing to run" from "the runner died"; without the raw
    // output it can report THAT it produced nothing but never WHY.
    expect(ROUTE).toContain('summarizeJourneys(journeyResults, journeys.length, out.stdout)');
  });

  it('the page-render summary is told what the runner said', () => {
    expect(ROUTE).toContain('summarizePageCheck(pageResults, pageRoutes.length, out.stdout)');
  });
});

describe('a check that did not run is coded as neither pass nor failure', () => {
  it('JOURNEY_NOT_RUN exists and is chosen by `ran`, not by `ok`', () => {
    expect(ROUTE).toContain("code: !verdict.ran ? 'JOURNEY_NOT_RUN' : verdict.ok ? 'JOURNEY_PASSED' : 'JOURNEY_FAILED'");
  });

  it('and is never marked auto-resolved, which is what made the old code read green', () => {
    expect(ROUTE).toContain('autoResolved: verdict.ok && verdict.ran');
  });

  it('JOURNEY_PASSED is never recorded on a verdict that did not run', () => {
    // A reversion guard with teeth: any spelling that reaches JOURNEY_PASSED without consulting `ran`
    // re-opens the exact defect. There is one such expression and it must test `ran` first.
    const passSites = ROUTE.split('\n').filter((l) => l.includes("'JOURNEY_PASSED'"));
    expect(passSites.length).toBe(1);
    expect(passSites[0]).toContain('verdict.ran');
  });
});

describe('the new code is classified as OUR process, never the app’s fault', () => {
  it('it measures our own check, so it can never make a build look unshippable', () => {
    const diag = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
    const processOnly = /const PROCESS_ONLY_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(diag)?.[1] ?? '';
    expect(processOnly).toContain('JOURNEY_NOT_RUN');
  });

  it('and is never offered to the user as something to fix in their app', () => {
    const sugg = readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8');
    const never = /const NEVER_SUGGEST = new Set\(\[([\s\S]*?)\]\)/.exec(sugg)?.[1] ?? '';
    expect(never).toContain('JOURNEY_NOT_RUN');
  });
});
