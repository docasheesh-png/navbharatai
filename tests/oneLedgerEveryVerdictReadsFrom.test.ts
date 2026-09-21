/**
 * 🔴 THE EVIDENCE LEDGER — one definition of *"a real browser saw this app render"*, read by every
 * verdict (autopsy 697b38ee, EIGHTH appearance; admin 2026-09-21: *"fir yeh ek ek kar ke pura karro"*).
 *
 * ## What `CLAUDE.md` says, and what reading the code actually found
 *
 * CLAUDE.md records this as a wholly OPEN root cause — *"there is no shared EVIDENCE LEDGER … until
 * one ledger exists that any actor writes a proven fact into and every verdict reads from, this class
 * returns"*. It is not open. It is **half built, and the half that is built is what makes it hard to
 * see**:
 *
 * | reader | reads | answers |
 * |---|---|---|
 * | `provenFromTimeline` | `APP_RENDERED`, `RUNTIME_VERIFIED`, `PREVIEW_PUBLISHED` | preview / pages |
 * | `appWasSeenRunning` | `GREEN_GUARD_SAVE`, `PREVIEW_PUBLISHED` | was the app seen running |
 * | `agentRunEvidence` | the shell command log | typecheck / tests |
 *
 * Three readers of one build, three different code-sets, and **not one of them read `IN_BUILD_GREEN`**
 * — a pass that opens the app in a real browser, refuses a curl capture outright, and records *"The
 * app rendered in a real browser Ns into this build"*. An actor proved the fact, wrote it down, and
 * no verdict in the engine asked. That is the root cause in one sentence: **not a missing store, a
 * missing shared VOCABULARY.**
 *
 * ## The second finding, which is why the READ half looked fine and was not
 *
 * `APP_RENDERED`'s only writer is `appRenderedRecord`, called from exactly two places, both inside
 * `markAppRendered` — which sets the route's local `previewVerifiedRendered` flag **first**. So
 * `provenFromTimeline(…).preview === 'passed'` could never be true while that flag was false. **The
 * ledger could not answer a question the local boolean could not already answer.** It looked like a
 * ledger and behaved like a mirror, which is why six autopsies could name the subsystem and still
 * leave the defect in place.
 *
 * ## What this suite locks
 *
 * 1. The vocabulary is ONE set, and every member is browser-only **by its producer's own guard** —
 *    asserted against those producers, not against their messages.
 * 2. `IN_BUILD_GREEN` reaches the verdicts. `IN_BUILD_GREEN_RACED` does not, and must not.
 * 3. The three consumers in `routes/agentv3.ts` ask ONE function. A source-level guard, because
 *    `tsc` and `vitest` cannot see that two call sites answer one question from two sources — which
 *    is exactly how this survived its own fix.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  RENDER_PROVEN_CODES, renderProvenByAnyActor, appRenderedRecord, APP_RENDERED_CODE,
} from '../src/server/AgentV3/renderProof';
import { IN_BUILD_GREEN_CODE, inBuildGreenNote } from '../src/server/AgentV3/inBuildGreen';
import { provenFromTimeline } from '../src/server/AgentV3/provenFromTimeline';
import { appWasSeenRunning } from '../src/server/AgentV3/BuildDiagnostics';

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const RENDER_PROOF = readFileSync('src/server/AgentV3/renderProof.ts', 'utf8');
const IN_BUILD_GREEN = readFileSync('src/server/AgentV3/inBuildGreen.ts', 'utf8');

/** Comments are prose. A guard that matches one proves nothing — this repo has paid for that twice. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const fact = (c: string, severity = 'info') => ({ code: c, severity });

describe('🔑 THE VOCABULARY — one set, and every member earns its place', () => {
  it('holds exactly the two codes whose producers refuse a non-browser capture', () => {
    expect([...RENDER_PROVEN_CODES].sort()).toEqual(['APP_RENDERED', 'IN_BUILD_GREEN']);
  });

  it('APP_RENDERED is browser-only at its producer, not merely in its wording', () => {
    expect(appRenderedRecord('browser', 'verify loop')?.code).toBe(APP_RENDERED_CODE);
    expect(appRenderedRecord('curl', 'verify loop')).toBeNull();
    expect(appRenderedRecord(undefined, 'verify loop')).toBeNull();
  });

  it('IN_BUILD_GREEN is browser-only at its producer too — asserted on the SOURCE guard', () => {
    // The behavioural half lives in inBuildGreen's own suite; what matters here is that the guard
    // this set's membership rests on still exists. Remove it and a curl render joins the ledger.
    expect(code(IN_BUILD_GREEN)).toMatch(/shot\.source\s*!==\s*'browser'/);
  });

  it('🔴 PREVIEW_PUBLISHED and GREEN_GUARD_SAVE are deliberately OUT', () => {
    // An address that listens is not an app that painted; and GREEN_GUARD_SAVE is written from
    // `previewGreen`, which its producers set on `verdict.rendered` alone — curl included.
    expect(RENDER_PROVEN_CODES.has('PREVIEW_PUBLISHED')).toBe(false);
    expect(RENDER_PROVEN_CODES.has('GREEN_GUARD_SAVE')).toBe(false);
  });

  it('the set is the one place membership is decided — no reader keeps its own copy', () => {
    const src = code(RENDER_PROOF);
    expect(src).toContain("import { IN_BUILD_GREEN_CODE } from './inBuildGreen'");
    // provenFromTimeline must ask the set, never re-test a literal.
    const pft = code(readFileSync('src/server/AgentV3/provenFromTimeline.ts', 'utf8'));
    expect(pft).toContain('RENDER_PROVEN_CODES.has(code)');
    expect(pft).not.toMatch(/code === APP_RENDERED_CODE/);
  });
});

describe('renderProvenByAnyActor — the read', () => {
  it('answers for BOTH actors', () => {
    expect(renderProvenByAnyActor([fact('APP_RENDERED')])).toBe(true);
    expect(renderProvenByAnyActor([fact('IN_BUILD_GREEN')])).toBe(true);
  });

  it('🔴 the proof `inBuildGreen` really writes is the one this reads', () => {
    // Not a hand-typed string: the REAL producer's output, so a reworded code fails here.
    const note = inBuildGreenNote({ kind: 'proven' } as never, { elapsedMs: 42_000, fileCount: 9 });
    expect(renderProvenByAnyActor([note])).toBe(true);
    expect(note.code).toBe(IN_BUILD_GREEN_CODE);
  });

  it('🔒 a RACED attempt is NOT proof — the tree that rendered is not the tree on disk', () => {
    const raced = inBuildGreenNote({ kind: 'raced' } as never, { elapsedMs: 9_000 });
    expect(renderProvenByAnyActor([raced])).toBe(false);
    for (const kind of ['not-rendered', 'not-painted']) {
      expect(renderProvenByAnyActor([inBuildGreenNote({ kind } as never, { elapsedMs: 1 })])).toBe(false);
    }
  });

  it('a WARNING carrying the same code is a weaker sense of the word and does not pass', () => {
    expect(renderProvenByAnyActor([fact('IN_BUILD_GREEN', 'warning')])).toBe(false);
    expect(renderProvenByAnyActor([fact('APP_RENDERED', 'error')])).toBe(false);
  });

  it('says nothing rather than no — an empty timeline is not a denial', () => {
    expect(renderProvenByAnyActor([])).toBe(false);
    expect(renderProvenByAnyActor(undefined)).toBe(false);
    expect(renderProvenByAnyActor(null)).toBe(false);
    expect(renderProvenByAnyActor([{ code: null, severity: null }])).toBe(false);
  });

  it('never throws on a shape it does not recognise', () => {
    expect(() => renderProvenByAnyActor([{} as never, undefined as never])).not.toThrow();
  });
});

describe('🔴 THE GAP THAT WAS OPEN — an IN_BUILD_GREEN app now reaches every verdict', () => {
  const onlyInBuildGreen = [
    { code: 'IN_BUILD_GREEN', severity: 'info', autoResolved: true },
    { code: 'SOMETHING_ELSE', severity: 'info', autoResolved: true },
  ];

  it('provenFromTimeline now calls its preview proven', () => {
    expect(provenFromTimeline(onlyInBuildGreen).preview).toBe('passed');
  });

  it('appWasSeenRunning now counts it — it read neither of this build’s codes before', () => {
    expect(appWasSeenRunning(onlyInBuildGreen)).toBe(true);
  });

  it('the two weak codes still answer appWasSeenRunning — kept on purpose, not overlooked', () => {
    // Removing them would move the admin's failure-vs-mislabelling number on a session's judgement.
    expect(appWasSeenRunning([{ code: 'GREEN_GUARD_SAVE' }])).toBe(true);
    expect(appWasSeenRunning([{ code: 'PREVIEW_PUBLISHED' }])).toBe(true);
    expect(appWasSeenRunning([{ code: 'PROD_BUILD_OK' }])).toBe(false);
  });

  it('a build with no runtime evidence is still not "seen running"', () => {
    expect(appWasSeenRunning([{ code: 'IN_BUILD_GREEN_RACED', severity: 'info' }])).toBe(false);
    expect(appWasSeenRunning([])).toBe(false);
  });
});

describe('🔒 ONE QUESTION, ONE ANSWER — source guards over routes/agentv3.ts', () => {
  const src = code(ROUTE);

  it('the shared answer exists and reads the ledger', () => {
    expect(src).toContain('const renderProvenNow = (): boolean =>');
    expect(src).toContain('provenFromTimeline(buildDiag.report().issues).preview');
  });

  it('🔴 all THREE consumers ask it — not two of them', () => {
    expect(src).toContain('previewRendered: renderProvenNow()');          // the runtime verdict
    expect(src).toContain('previewVerified: renderProvenNow()');          // claimAudit
    expect(src).toContain('appRendered: renderProvenNow()');              // verifiedNoChangeSummary
  });

  it('🔴 no consumer reads the narrow local flag again — that IS the bug', () => {
    // These two lines are what shipped: one verdict asking the ledger while its neighbours asked a
    // boolean. Nothing tsc or vitest can see; only the source says which source a call site used.
    expect(src).not.toContain('previewVerified: previewVerifiedRendered');
    expect(src).not.toContain('appRendered: previewVerifiedRendered,');
  });

  it('the ledger answer is not re-declared inside a block, where its neighbours cannot reach it', () => {
    expect(src).not.toMatch(/let renderProven\s*=\s*previewVerifiedRendered/);
  });

  it('the local flag still answers FIRST — the ledger fills a gap, it does not replace the fast path', () => {
    expect(src).toMatch(/renderProvenNow[\s\S]{0,200}if \(previewVerifiedRendered\) return true;/);
  });
});
