import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  inBuildGreenEnabled,
  isProvenGreenRender,
  shouldAttemptInBuildProof,
  attemptOutcome,
  inBuildGreenNote,
  inBuildGreenNarration,
  snapshotIsFromThisBuild,
  MIN_ATTEMPT_GAP_MS,
} from '../src/server/AgentV3/inBuildGreen';
import { decideGreenGuard } from '../src/server/AgentV3/GreenGuard';
import {
  greenGuardSummaryCorrection,
  withGreenGuardCorrection,
  GREEN_GUARD_MARK,
  IN_BUILD_GREEN_MARK,
} from '../src/server/AgentV3/greenGuardHonesty';

/**
 * ADMIN 2026-09-18: "navbharatai dwara app banne ke baad tutni nahi chahiye!!!!!"
 *
 * GreenGuard restores a PREVIOUS build's green snapshot. On a first build — app rendering at minute
 * 2, broken by a later step at minute 6 — there was nothing to restore from. This records the build's
 * OWN first proven render as the last known good, to the same key, so the existing end-of-build
 * restore covers the case the admin actually described.
 */

const ok = { rendered: true, inconclusive: false, serverDown: false };

describe('the evidence bar is the one the late check already uses', () => {
  it('a real browser render is a proof', () => {
    expect(isProvenGreenRender({ source: 'browser' }, ok)).toBe(true);
  });
  it('🔒 a curl capture never is — it never ran the app', () => {
    expect(isProvenGreenRender({ source: 'curl' }, ok)).toBe(false);
    expect(isProvenGreenRender({}, ok)).toBe(false);
  });
  it('🔒 inconclusive is ignorance, and server-down is the machine', () => {
    expect(isProvenGreenRender({ source: 'browser' }, { ...ok, inconclusive: true })).toBe(false);
    expect(isProvenGreenRender({ source: 'browser' }, { ...ok, serverDown: true })).toBe(false);
    expect(isProvenGreenRender({ source: 'browser' }, { ...ok, rendered: false })).toBe(false);
  });
});

describe('when an attempt is worth a browser open', () => {
  const base = { enabled: true, previewUrl: 'https://5173-x.e2b.app', hasBrowser: true, proven: false, inFlight: false, aborted: false, lastAttemptAt: 0 };
  it('yes, once a preview exists and nothing else is in the way', () => {
    expect(shouldAttemptInBuildProof(base, 1_000_000)).toBe(true);
  });
  it('never twice at once, never after it is proven, never after an abort', () => {
    expect(shouldAttemptInBuildProof({ ...base, inFlight: true }, 1_000_000)).toBe(false);
    expect(shouldAttemptInBuildProof({ ...base, proven: true }, 1_000_000)).toBe(false);
    expect(shouldAttemptInBuildProof({ ...base, aborted: true }, 1_000_000)).toBe(false);
  });
  it('never without a preview URL or a browser', () => {
    expect(shouldAttemptInBuildProof({ ...base, previewUrl: '' }, 1_000_000)).toBe(false);
    expect(shouldAttemptInBuildProof({ ...base, hasBrowser: false }, 1_000_000)).toBe(false);
  });
  it('💸 bounded: a chatty loop cannot buy a browser open every second', () => {
    const now = 1_000_000;
    expect(shouldAttemptInBuildProof({ ...base, lastAttemptAt: now - MIN_ATTEMPT_GAP_MS + 1 }, now)).toBe(false);
    expect(shouldAttemptInBuildProof({ ...base, lastAttemptAt: now - MIN_ATTEMPT_GAP_MS }, now)).toBe(true);
  });
  it('the kill switch turns it off, and unset means on', () => {
    expect(inBuildGreenEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(inBuildGreenEnabled({ AGENTV3_IN_BUILD_GREEN: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAttemptInBuildProof({ ...base, enabled: false }, 1_000_000)).toBe(false);
  });
});

describe('🔒 the snapshot must be of the tree that RENDERED', () => {
  it('a write during the proof discards the attempt — a snapshot that was never proven is worse than none', () => {
    const o = attemptOutcome({ shot: { source: 'browser' }, verdict: ok, writesBefore: 7, writesAfter: 8 });
    expect(o.kind).toBe('raced');
  });
  it('no write during the proof, a real render: proven', () => {
    expect(attemptOutcome({ shot: { source: 'browser' }, verdict: ok, writesBefore: 7, writesAfter: 7 }).kind).toBe('proven');
  });
  // ⚠️ REWRITTEN 2026-09-19, NOT DELETED. This case used to assert that a curl capture and an
  // unpainted browser snapshot BOTH return the single kind `'inconclusive'`. That collapsing is the
  // defect `theProofThatCouldNotSayWhatHappened.test.ts` withdraws: the two have different causes and
  // different fixes, and the one line they shared could only hedge between them. What the case was
  // really guarding — that "not rendered yet" is never confused with "could not tell" — still holds
  // and is kept; the three blind causes are now each named.
  it('not rendered yet, and could-not-tell, are named apart', () => {
    expect(attemptOutcome({ shot: { source: 'browser' }, verdict: { ...ok, rendered: false }, writesBefore: 1, writesAfter: 1 }).kind).toBe('not-rendered');
    expect(attemptOutcome({ shot: { source: 'curl' }, verdict: ok, writesBefore: 1, writesAfter: 1 }).kind).toBe('no-browser');
    expect(attemptOutcome({ shot: { source: 'browser' }, verdict: { ...ok, inconclusive: true }, writesBefore: 1, writesAfter: 1 }).kind).toBe('not-painted');
  });
  it('every outcome has an honest admin line; only proven has a user line', () => {
    const proven = inBuildGreenNote({ kind: 'proven' }, { elapsedMs: 128_000, fileCount: 14 });
    expect(proven.code).toBe('IN_BUILD_GREEN');
    expect(proven.message).toContain('128s');
    expect(proven.message).toContain('14 file(s)');
    expect(inBuildGreenNote({ kind: 'raced' }, { elapsedMs: 1000 }).code).toBe('IN_BUILD_GREEN_RACED');
    expect(inBuildGreenNote({ kind: 'not-rendered' }, { elapsedMs: 1000 }).code).toBe('IN_BUILD_GREEN_NOT_YET');
    // The UNCHECKED code is unchanged — what changed is that three different facts no longer share
    // one hedged sentence under it (see the rewritten case above).
    expect(inBuildGreenNote({ kind: 'not-painted' }, { elapsedMs: 1000 }).code).toBe('IN_BUILD_GREEN_UNCHECKED');
    expect(inBuildGreenNote({ kind: 'no-browser' }, { elapsedMs: 1000 }).code).toBe('IN_BUILD_GREEN_UNCHECKED');
    expect(inBuildGreenNote({ kind: 'server-down' }, { elapsedMs: 1000 }).code).toBe('IN_BUILD_GREEN_UNCHECKED');
    expect(inBuildGreenNarration()).toMatch(/protected/);
  });
});

describe('the end-of-build guard knows where the snapshot came from', () => {
  const started = 1_700_000_000_000;
  it('a snapshot recorded by THIS build restores with the sentence a first build needs', () => {
    const d = decideGreenGuard({
      before: { green: true, at: started + 128_000 }, after: { green: false },
      hasSnapshot: true, provenBroken: true, turnStartedAt: started,
    });
    expect(d.action).toBe('restore');
    expect(d.reason).toMatch(/earlier in this build/);
    expect(d.reason).not.toMatch(/before this turn/);
  });
  it('a snapshot from an earlier turn keeps the wording it always had', () => {
    const d = decideGreenGuard({
      before: { green: true, at: started - 60_000 }, after: { green: false },
      hasSnapshot: true, provenBroken: true, turnStartedAt: started,
    });
    expect(d.action).toBe('restore');
    expect(d.reason).toMatch(/before this turn/);
  });
  it('⚠️ without turnStartedAt nothing changes — the field is additive', () => {
    const d = decideGreenGuard({ before: { green: true, at: started + 1 }, after: { green: false }, hasSnapshot: true, provenBroken: true });
    expect(d.reason).toMatch(/before this turn/);
  });
  it('🔒 the rule is untouched: could-not-look is still never undone', () => {
    const d = decideGreenGuard({
      before: { green: true, at: started + 128_000 }, after: { green: false },
      hasSnapshot: true, provenBroken: false, turnStartedAt: started,
    });
    expect(d.action).toBe('none');
  });
  it('snapshotIsFromThisBuild is the same comparison', () => {
    expect(snapshotIsFromThisBuild(started + 1, started)).toBe(true);
    expect(snapshotIsFromThisBuild(started, started)).toBe(true);
    expect(snapshotIsFromThisBuild(started - 1, started)).toBe(false);
    expect(snapshotIsFromThisBuild(undefined, started)).toBe(false);
    expect(snapshotIsFromThisBuild(Number.NaN, started)).toBe(false);
  });
});

describe('the user is told the TRUE sentence', () => {
  it('a first build whose own earlier version came back is not told "your change was not kept"', () => {
    const m = greenGuardSummaryCorrection({ restored: 4, removed: 2, fromThisBuild: true });
    expect(m).toContain(IN_BUILD_GREEN_MARK);
    expect(m).not.toContain(GREEN_GUARD_MARK);
    expect(m).toMatch(/rendering partway through this build/);
    expect(m).toMatch(/4 file\(s\) restored/);
    expect(m).toMatch(/2 later file\(s\) removed/);
    expect(m).toMatch(/saved separately/);
  });
  it('an earlier-turn restore keeps its sentence', () => {
    const m = greenGuardSummaryCorrection({ restored: 1, removed: 0 });
    expect(m).toContain(GREEN_GUARD_MARK);
    expect(m).not.toContain(IN_BUILD_GREEN_MARK);
  });
  it('both variants are idempotent on the settle + watchdog double path', () => {
    const once = withGreenGuardCorrection('✅ built', { restored: 1, removed: 0, fromThisBuild: true });
    const twice = withGreenGuardCorrection(once, { restored: 1, removed: 0, fromThisBuild: true });
    expect(twice).toBe(once);
    expect(twice.split(IN_BUILD_GREEN_MARK).length - 1).toBe(1);
  });
});

/**
 * 🔒 REVERSION GUARD, READ FROM THE ROUTE. Every behavioural case above passes against a route that
 * never calls this module — the defect WAS a question nobody asked. So the wiring is asserted where
 * it lives: the proof exists before the build loop, saves to GreenGuard's own key, checks the write
 * race, and tells the end-of-build guard when this build began.
 */
describe('the wiring in routes/agentv3.ts', () => {
  const src = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
  const loopEnd = src.indexOf('result = await runner.run(buildPrompt);');
  const attempt = src.indexOf('const attemptInBuildGreen = async');

  it('the proof is armed BEFORE the build loop runs, so it can fire during it', () => {
    expect(attempt).toBeGreaterThan(0);
    expect(loopEnd).toBeGreaterThan(0);
    expect(attempt).toBeLessThan(loopEnd);
  });
  it('it saves to the SAME key the end-of-build GreenGuard reads — one store, one rule', () => {
    const body = src.slice(attempt, loopEnd);
    expect(body).toMatch(/saveWorkspaceFiles\(greenWorkspaceKey\(workspaceId\), files\)/);
  });
  it('🔒 the write race is checked with the counter every captured write bumps', () => {
    const body = src.slice(attempt, loopEnd);
    expect(body).toMatch(/writesAfter: inBuildWriteTick/);
    const onFileWrite = src.indexOf('const onFileWrite = (path: string, content: string) => {');
    expect(onFileWrite).toBeGreaterThan(0);
    expect(src.slice(onFileWrite, onFileWrite + 400)).toMatch(/inBuildWriteTick\+\+/);
  });
  it('the trigger listens to the build stream and stops once proven', () => {
    const body = src.slice(attempt, loopEnd);
    expect(body).toMatch(/events\.subscribe\(/);
    expect(body).toMatch(/if \(inBuildGreenAt > 0\) stopInBuildGreen\(\)/);
  });
  it('the end-of-build guard is told when this build began, and the honesty facts carry the origin', () => {
    expect(src).toMatch(/before: \{ green: hasSnapshot, at: inBuildGreenAt > 0 \? inBuildGreenAt : undefined \},\s*turnStartedAt: buildStartedAt,/);
    expect(src).toMatch(/fromThisBuild: snapshotIsFromThisBuild\(/);
  });
});
