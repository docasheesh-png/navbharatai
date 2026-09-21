/**
 * 🔴 FOUR VARIABLES HELD ONE FACT, AND THE TWO PRODUCERS DID NOT AGREE (autopsy 697b38ee, 7th
 * appearance of the evidence-ledger root cause).
 *
 * "A real browser opened this app and it rendered" is the strongest evidence this platform can
 * produce, and it was written to LOCAL VARIABLES and to nothing else. The render rescue set two of
 * the three and not `buildObs.previewRendered` — the copy the `result` event's `appRendered` is built
 * from — so `appRanDespiteFailedVerdict` could never fire for a rescued build whose verdict a later
 * flip turned back to `ok: false`, and the user was offered a "finish/fix the build" button for an
 * app the platform had just watched working.
 *
 * These cases cover the WRITE half (`renderProof.ts`), the READ half's new fact
 * (`provenFromTimeline`), the wiring, and — since the defect WAS a missing assignment rather than a
 * wrong one — reversion guards that read the route's source for the invariant "one writer per copy".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appRenderedRecord, APP_RENDERED_CODE } from '../src/server/AgentV3/renderProof';
import { provenFromTimeline } from '../src/server/AgentV3/provenFromTimeline';
import { emptyBuildFailureSummary } from '../src/server/routes/agentv3';
import { appRanDespiteFailedVerdict } from '../src/components/agentv3/failedButRunning';

const ROUTE = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/** The writer's body, so a wiring case cannot be satisfied by an identically-named field elsewhere. */
function writerBody(): string {
  const start = ROUTE.indexOf('const markAppRendered = (');
  expect(start).toBeGreaterThan(-1);
  const end = ROUTE.indexOf('\n      };', start);
  expect(end).toBeGreaterThan(start);
  return ROUTE.slice(start, end);
}

describe('the write half — only a real browser is proof', () => {
  it('a browser render produces a record carrying the one code', () => {
    const r = appRenderedRecord('browser', 'render rescue');
    expect(r).not.toBeNull();
    expect(r!.code).toBe(APP_RENDERED_CODE);
    expect(r!.phase).toBe('preview');
  });

  it('it is info + autoResolved, so it can never be counted as a problem with the app', () => {
    // `shippingIssueCount` filters by severity and `buildFindingSuggestions` skips resolved findings —
    // a proof must not arrive at either as a finding.
    const r = appRenderedRecord('browser', 'preview verify loop')!;
    expect(r.severity).toBe('info');
    expect(r.autoResolved).toBe(true);
  });

  it('a curl fallback is NOT proof — nothing is recorded rather than a weaker fact', () => {
    expect(appRenderedRecord('curl', 'render rescue')).toBeNull();
  });

  it('an unknown source is not proof either — the safe answer to a shape we do not know is silence', () => {
    expect(appRenderedRecord(undefined, 'render rescue')).toBeNull();
    // @ts-expect-error — a caller on the boundary may hand us anything at runtime.
    expect(appRenderedRecord('BROWSER', 'x')).toBeNull();
    // @ts-expect-error — same.
    expect(appRenderedRecord(null, 'x')).toBeNull();
  });

  it('names which pass saw it, in the detail only — no reader parses that sentence', () => {
    expect(appRenderedRecord('browser', 'render rescue')!.detail).toContain('render rescue');
    expect(appRenderedRecord('browser', '')!.detail).toBeUndefined();
    expect(appRenderedRecord('browser', 'x'.repeat(400))!.detail!.length).toBeLessThan(120);
  });

  it('WHITE-LABEL LAW — the message names no vendor, because the admin report is not the only reader', () => {
    const text = `${appRenderedRecord('browser', 'preview verify loop')!.message}`;
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Grok', 'OpenAI', 'Moonshot']) {
      expect(text.toLowerCase()).not.toContain(vendor.toLowerCase());
    }
  });
});

describe('the read half — the ledger answers for every consumer', () => {
  it('ROUND TRIP: what the writer records is what the reader accepts, with no literal in between', () => {
    // The anti-drift case. A reader holding its own copy of a writer's string is the class this repo
    // has paid for repeatedly; if either side is renamed and the other is not, this is what fails.
    const written = appRenderedRecord('browser', 'preview verify loop')!;
    expect(provenFromTimeline([written]).preview).toBe('passed');
  });

  it('a render on the timeline settles `preview`', () => {
    expect(provenFromTimeline([{ code: APP_RENDERED_CODE, severity: 'info' }]).preview).toBe('passed');
  });

  it('a WARNING carrying the same code is not proof — a weaker sense of the word must not pass', () => {
    expect(provenFromTimeline([{ code: APP_RENDERED_CODE, severity: 'warning' }]).preview).toBeUndefined();
  });

  it('an absent key means "the timeline does not answer this" — never a silent negative', () => {
    expect(provenFromTimeline([]).preview).toBeUndefined();
    expect(provenFromTimeline(null).preview).toBeUndefined();
    expect(provenFromTimeline([{ code: 'PREVIEW_NOT_RENDERED', severity: 'warning' }]).preview).toBeUndefined();
  });

  it('it PROMOTES only — there is no input that makes it say `failed` or `not-run`', () => {
    for (const f of [
      { code: APP_RENDERED_CODE, severity: 'info' },
      { code: APP_RENDERED_CODE, severity: 'error' },
      { code: 'PREVIEW_ERROR', severity: 'error' },
    ]) {
      const out = provenFromTimeline([f]);
      expect(out.preview === undefined || out.preview === 'passed').toBe(true);
    }
  });

  it('an address that is listening is NOT an app that painted — the two facts stay apart', () => {
    const published = provenFromTimeline([{ code: 'PREVIEW_PUBLISHED', severity: 'info' }]);
    expect(published.previewUrlPublished).toBe(true);
    expect(published.preview).toBeUndefined();
  });

  it('the facts the reader already settled are unchanged', () => {
    expect(provenFromTimeline([{ code: 'RUNTIME_VERIFIED', severity: 'info' }]).pages).toBe('passed');
  });
});

describe('the defect, at the two producers', () => {
  it('BOTH producers go through the one writer', () => {
    expect(ROUTE).toContain("markAppRendered(shot.source, 'render rescue')");
    expect(ROUTE).toContain("markAppRendered(shot.source, 'preview verify loop')");
  });

  it('the writer sets every copy — this is the assignment the render rescue was missing', () => {
    const body = writerBody();
    expect(body).toContain('previewVerifiedRendered = true');
    expect(body).toContain('buildObs.previewRendered = true');
    expect(body).toContain('browserRenderProven = true');
    expect(body).toContain('appRenderedRecord(source');
  });

  it('REVERSION GUARD — each copy has exactly ONE writer in the whole route', () => {
    // The bug was a missing hand-assignment, so the durable fix is that hand-assigning is gone. If a
    // later change re-introduces one at a producer, the copies can silently diverge again and this
    // fails — which no behavioural case above could catch.
    expect(ROUTE.split('previewVerifiedRendered = true').length - 1).toBe(1);
    expect(ROUTE.split('buildObs.previewRendered = true').length - 1).toBe(1);
    expect(ROUTE.split('browserRenderProven = true').length - 1).toBe(1);
  });

  it('only a real browser sets the strict copy, inside the writer', () => {
    expect(writerBody()).toContain("if (source === 'browser') browserRenderProven = true");
  });
});

describe('the consumers', () => {
  it('the gate fill is FILL-ONLY — a preview recorded as failed keeps its failure', () => {
    expect(ROUTE).toContain("if (gateEvidence.preview === 'not-run' && seen.preview) gateEvidence.preview = seen.preview;");
  });

  it('the runtime verdict asks the ledger, not one pass’s local memory', () => {
    // ⚠️ SUPERSEDED 2026-09-21, and this case is STRONGER than it was, not weaker. It used to pin
    // `let renderProven = previewVerifiedRendered;` — a ledger read declared INSIDE one `else if`
    // block, so the two neighbouring verdicts (`claimAudit`, `verifiedNoChangeSummary`) could not
    // have used it even had they wanted to. Three consumers of one fact, two sources. The answer is
    // now one hoisted function every consumer calls, and `oneLedgerEveryVerdictReadsFrom.test.ts`
    // holds all three of them.
    const at = ROUTE.indexOf('const renderProvenNow = (): boolean =>');
    expect(at).toBeGreaterThan(-1);
    const near = ROUTE.slice(at, at + 700);
    expect(near).toContain("provenFromTimeline(buildDiag.report().issues).preview === 'passed'");
    expect(ROUTE).toContain('{ previewRendered: renderProvenNow() }');
    expect(ROUTE).toContain('runtimeUncheckedRecord({ previewRendered: renderProvenNow() })');
  });

  it('WHAT THE MISSING COPY COST: the failure card needs `appRendered` true to stand down', () => {
    const facts = { ok: false, summary: 'Build did not fully succeed.', running: false, hasError: false };
    // Before the fix a rescued build reached the client with this field false…
    expect(appRanDespiteFailedVerdict({ ...facts, appRendered: false })).toBe(false);
    // …and true is what makes the platform stop offering to "fix" an app it watched working.
    expect(appRanDespiteFailedVerdict({ ...facts, appRendered: true })).toBe(true);
  });

  it('the result event and the cancelled bill both read that same copy', () => {
    expect(ROUTE).toContain('appRendered: buildObs.previewRendered === true');
  });

  it('…and `emptyBuildFailureSummary` was NOT one of the affected readers — stated, not assumed', () => {
    // `renderRescueEligible` requires filesWritten > 0, and this summary returns null on fileCount > 0
    // BEFORE it reads the render — so the argument is dead on the rescue path either way.
    expect(emptyBuildFailureSummary(true, 4, false, false)).toBeNull();
    expect(emptyBuildFailureSummary(true, 4, false, true)).toBeNull();
    // It still does its own job on a genuinely empty build.
    expect(emptyBuildFailureSummary(true, 0, false, false)).toContain('no files');
    expect(emptyBuildFailureSummary(true, 0, false, true)).toBeNull();
  });
});
