/**
 * 🔴 THE EVIDENCE LEDGER, SIXTH APPEARANCE (autopsy 697b38ee; open since 2026-09-14).
 *
 * CLAUDE.md names this as the missing subsystem in its own words — *"there is no shared EVIDENCE
 * LEDGER … the gates trust only their own"* — and `PROGRESS.md` records it six separate times. The
 * report that named it carried `RELEASE_GATE` saying the typecheck had not run after two clean `tsc`
 * runs, and `RUNTIME_UNCHECKED` after three successful browser console reads.
 *
 * `agentRunEvidence.ts` closed the SHELL-COMMAND half and its docblock states what it left:
 * *"That proof does not live in the shell-command log at all — it is held by the page checks."*
 *
 * 🔑 The write half already existed: every actor that proves something records it (`RUNTIME_VERIFIED`,
 * `PREVIEW_PUBLISHED`, `PLATFORM_PREVIEW_UP`). **Nothing read it back.** These pin the read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { provenFromTimeline } from '../src/server/AgentV3/provenFromTimeline';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { runtimeVerifiedRecord, runtimeRecordFromPageChecks } from '../src/server/AgentV3/AutoFix';

const code = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

/** A build that ran and was never checked — the shape the gate calls UNKNOWN. */
const unproven: RuntimeEvidence = {
  buildOk: true, preview: 'not-run', pages: 'not-run', journeys: 'not-run',
  typecheck: 'not-run', tests: 'not-run',
};
const clean = { blockers: 0, highSeverity: 0, warnings: 0 };
const noQuality = { a11yIssues: 0, slowRoutes: 0 };

describe('🔑 the proof the actors were already writing', () => {
  it('BOTH real producers of RUNTIME_VERIFIED settle "the pages rendered in a real browser"', () => {
    // Not a hand-written fixture: the actual records the engine emits.
    const fromConsole = runtimeVerifiedRecord();
    const fromPages = runtimeRecordFromPageChecks(3, []);
    expect(fromPages?.code).toBe('RUNTIME_VERIFIED');
    expect(provenFromTimeline([fromConsole]).pages).toBe('passed');
    expect(provenFromTimeline([fromPages!]).pages).toBe('passed');
  });

  it('a published address is read back, from either publisher', () => {
    expect(provenFromTimeline([{ code: 'PREVIEW_PUBLISHED' }]).previewUrlPublished).toBe(true);
    expect(provenFromTimeline([{ code: 'PLATFORM_PREVIEW_UP' }]).previewUrlPublished).toBe(true);
  });

  it('a timeline that settles nothing returns nothing — never a silent negative', () => {
    expect(provenFromTimeline([{ code: 'HEARTBEAT' }, { code: 'TOOL_CALL' }])).toEqual({});
    expect(provenFromTimeline([])).toEqual({});
    expect(provenFromTimeline(null)).toEqual({});
    expect(provenFromTimeline(undefined)).toEqual({});
  });

  it('⚠️ a RUNTIME_VERIFIED that is not an `info` record is NOT proof', () => {
    // Both producers emit `info`. A warning carrying the code would be some new, weaker sense of the
    // word; the safe answer to a shape we do not recognise is to say nothing.
    expect(provenFromTimeline([{ code: 'RUNTIME_VERIFIED', severity: 'warning' }]).pages).toBeUndefined();
  });

  it('🔒 RUNTIME_UNCHECKED and RUNTIME_ERRORS_REMAIN prove nothing — they are the opposite record', () => {
    expect(provenFromTimeline([{ code: 'RUNTIME_UNCHECKED', severity: 'info' }]).pages).toBeUndefined();
    expect(provenFromTimeline([{ code: 'RUNTIME_ERRORS_REMAIN', severity: 'warning' }]).pages).toBeUndefined();
  });

  it('malformed entries cannot throw or invent a fact', () => {
    expect(() => provenFromTimeline([{}, { code: null }, { code: '' }] as never)).not.toThrow();
    expect(provenFromTimeline([{}, { code: null }, { code: '' }] as never)).toEqual({});
  });
});

describe('🔴 the sentence the gate used to print about an app it had watched run', () => {
  it('without the read, the gate says nothing was ever proven to RUN', () => {
    const v = releaseGate(unproven, clean, noQuality);
    expect(v.state).toBe('unknown');
    expect(v.headline).toContain('nothing here was ever proven to RUN');
  });

  it('with it, the gate says what actually happened', () => {
    const seen = provenFromTimeline([runtimeRecordFromPageChecks(4, [])!]);
    const v = releaseGate({ ...unproven, pages: seen.pages ?? 'not-run' }, clean, noQuality);
    expect(v.state).not.toBe('unknown');
    expect(v.proven).toContain('every page route rendered in a real browser');
    expect(v.headline).not.toContain('nothing here was ever proven to RUN');
  });

  it('a published address changes the EXPLANATION of an unproven preview, not the verdict', () => {
    const silent = releaseGate(unproven, clean, noQuality);
    const known = releaseGate({ ...unproven, previewUrlPublished: true }, clean, noQuality);
    expect(known.state).toBe(silent.state);                       // verdict untouched
    expect(known.unproven).not.toEqual(silent.unproven);          // wording improved
  });
});

describe('🔒 it cannot change a bill — checked, not assumed', () => {
  it('a RED build stays RED: promotion removes no failure', () => {
    const failing: RuntimeEvidence = { ...unproven, preview: 'failed' };
    const before = releaseGate(failing, clean, noQuality);
    const after = releaseGate({ ...failing, pages: 'passed' }, clean, noQuality);
    expect(before.state).toBe('red');
    expect(after.state).toBe('red');
  });

  it('a build that did not succeed stays RED however much rendered', () => {
    expect(releaseGate({ ...unproven, buildOk: false, pages: 'passed' }, clean, noQuality).state).toBe('red');
  });

  it('blockers still make it RED — this reader adds no failure and removes none', () => {
    const v = releaseGate({ ...unproven, pages: 'passed' }, { ...clean, blockers: 2 }, noQuality);
    expect(v.state).toBe('red');
  });

  it('⚠️ and it does NOT reach GREEN on its own — rendering is necessary, not sufficient', () => {
    // GREEN needs a journey to have held up. An app that paints beautifully and saves nothing must
    // not be graded shippable by this change.
    expect(releaseGate({ ...unproven, pages: 'passed' }, clean, noQuality).state).toBe('yellow');
  });
});

describe('🔒 the wiring — a reader nothing calls is not a fix', () => {
  const route = code('../src/server/routes/agentv3.ts');

  it('the gate assembly asks the timeline, beside the command log', () => {
    expect(route).toContain('provenFromTimeline(buildDiag.report().issues)');
    expect(route).toContain("if (gateEvidence.pages === 'not-run' && seen.pages)");
  });

  it('🔒 it FILLS a gap and never overwrites real evidence — the same discipline as the command log', () => {
    // A check the build genuinely ran and recorded as `failed` must survive this pass untouched.
    expect(route).toContain("gateEvidence.pages === 'not-run'");
    expect(route).toContain('gateEvidence.previewUrlPublished === undefined');
  });

  it('⚠️ it is a SIBLING of agentRunEvidence, not a branch inside it — two sources, two names', () => {
    const cmdLog = code('../src/server/AgentV3/agentRunEvidence.ts');
    expect(cmdLog).not.toContain('RUNTIME_VERIFIED');
    expect(code('../src/server/AgentV3/provenFromTimeline.ts')).not.toContain('parseTestOutcome');
  });
});
