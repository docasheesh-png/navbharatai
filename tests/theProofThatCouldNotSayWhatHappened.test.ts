// A PROOF THAT CANNOT SAY WHAT HAPPENED TO IT IS NOT A PROOF — it is a silence.
//
// `IN_BUILD_GREEN` shipped on 2026-09-18 to answer the admin's "navbharatai dwara app banne ke baad
// tutni nahi chahiye!!!!!". Reading the code the day after, three separate ways for it to vanish from
// its own report were found — none of which touches the app, and all of which make the check
// impossible to diagnose from a build report:
//
//   1. The attempt is wrapped in `withTimeout(…, 35s)` while `browseUrl`'s OWN bounds add up to about
//      120s (a 60s wait for the sandbox's browser tooling, a 30s browse command, a 30s curl
//      fallback). When our budget runs out first, the rejection landed in a bare `catch {}` — so a
//      proof that timed out and a proof that never fired produced the SAME report: nothing.
//   2. `proven` with an empty file set fell between `if (proven && files > 0)` and
//      `else if (kind !== 'proven')`, so a real render that could not be snapshotted also recorded
//      nothing.
//   3. One kind, `inconclusive`, carried three unrelated facts — a curl fallback, an unpainted
//      browser snapshot, and a dead server — so even when it DID record, its message had to hedge
//      ("no real-browser capture, or the server was down") and named no cause anybody could fix.
//
// The older sibling of this very proof already does all three correctly: `LAST_CHANCE_PROOF` names
// `rendered/inconclusive/serverDown` in its detail, has a separate `LAST_CHANCE_PROOF_UNAVAILABLE`
// for "could not open it at all", and a `LAST_CHANCE_PROOF_SKIPPED` for "not attempted, and why".
// This is that discipline applied to the copy written second — the drifted-sibling class.
//
// 🔒 NOTHING HERE CHANGES A VERDICT OR A BILL. Every line stays `severity: 'info'`, and
// `shippingIssueCount` filters on `error` / `warning` and never reads an `info` line.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  attemptOutcome,
  inBuildGreenNote,
  IN_BUILD_PROOF_BUDGET_MS,
  type AttemptOutcome,
} from '../src/server/AgentV3/inBuildGreen';

const ok = { rendered: true, inconclusive: false, serverDown: false };
const src = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the three blind causes are three facts, not one hedge', () => {
  it('a capture that never ran the app JavaScript is named as such', () => {
    const o = attemptOutcome({ shot: { source: 'curl' }, verdict: { rendered: false, inconclusive: true }, writesBefore: 3, writesAfter: 3 });
    expect(o.kind).toBe('no-browser');
    const note = inBuildGreenNote(o, { elapsedMs: 42_000 });
    expect(note.detail ?? '').toMatch(/without running its JavaScript/i);
    // It must NOT blame the app, and must not blame the server either — neither was observed.
    expect(note.message).not.toMatch(/server was down/i);
  });

  it('a dead server is the machine, and says so', () => {
    const o = attemptOutcome({ shot: { source: 'browser' }, verdict: { rendered: false, serverDown: true }, writesBefore: 1, writesAfter: 1 });
    expect(o.kind).toBe('server-down');
    expect(inBuildGreenNote(o, { elapsedMs: 9_000 }).message).toMatch(/the machine, not the app/i);
  });

  it('a real browser that saw nothing painted is ignorance, stated as ignorance', () => {
    const o = attemptOutcome({ shot: { source: 'browser' }, verdict: { rendered: false, inconclusive: true }, writesBefore: 1, writesAfter: 1 });
    expect(o.kind).toBe('not-painted');
    const note = inBuildGreenNote(o, { elapsedMs: 9_000 });
    expect(note.message).toMatch(/NOT evidence the app is broken/i);
  });

  it('serverDown is judged BEFORE the paint verdict, so the machine never reads as an unpainted app', () => {
    // `analyzePreviewHtml` returns serverDown from an early exit, so the two never arrive together in
    // practice — but if they ever did, the machine is the more specific fact and must win.
    const o = attemptOutcome({ shot: { source: 'browser' }, verdict: { rendered: false, inconclusive: true, serverDown: true }, writesBefore: 1, writesAfter: 1 });
    expect(o.kind).toBe('server-down');
  });

  it('the real defect signal is still separate from all three', () => {
    // A browser that looked and found an error overlay / empty root is evidence, not ignorance.
    const o = attemptOutcome({ shot: { source: 'browser' }, verdict: { rendered: false }, writesBefore: 1, writesAfter: 1 });
    expect(o.kind).toBe('not-rendered');
    expect(inBuildGreenNote(o, { elapsedMs: 1_000 }).code).toBe('IN_BUILD_GREEN_NOT_YET');
  });

  it('every blind cause produces a DIFFERENT sentence — the hedge is gone', () => {
    const kinds: AttemptOutcome[] = [{ kind: 'no-browser' }, { kind: 'server-down' }, { kind: 'not-painted' }, { kind: 'gave-up' }];
    const messages = kinds.map((k) => inBuildGreenNote(k, { elapsedMs: 5_000 }).message);
    expect(new Set(messages).size).toBe(kinds.length);
    // …and they all still land on the one code, so no new report vocabulary was invented.
    for (const k of kinds) expect(inBuildGreenNote(k, { elapsedMs: 5_000 }).code).toBe('IN_BUILD_GREEN_UNCHECKED');
  });
});

describe('an attempt that could not finish is recorded, not swallowed', () => {
  it('gave-up carries the reason it was handed, and names the budget', () => {
    const note = inBuildGreenNote({ kind: 'gave-up', why: 'in-build-green timed out after 35000ms' }, { elapsedMs: 61_000 });
    expect(note.code).toBe('IN_BUILD_GREEN_UNCHECKED');
    expect(note.detail ?? '').toContain('in-build-green timed out after 35000ms');
    expect(note.detail ?? '').toContain(`budget ${Math.round(IN_BUILD_PROOF_BUDGET_MS / 1000)}s`);
    expect(note.message).toMatch(/never a verdict about the app/i);
  });

  it('gave-up with no reason still records a line', () => {
    expect(inBuildGreenNote({ kind: 'gave-up' }, { elapsedMs: 1_000 }).message).toMatch(/could not complete/i);
  });

  // 🔒 REVERSION GUARD. The behavioural cases above pass whether or not the ROUTE actually records
  // the give-up — the bug was never in the pure module, it was the bare `catch {}` at the call site.
  // This reads the call site itself.
  it('the route records the give-up instead of swallowing it', () => {
    const route = src('src/server/routes/agentv3.ts');
    const block = route.slice(route.indexOf('const attemptInBuildGreen'));
    const body = block.slice(0, block.indexOf('const stopInBuildGreen'));
    expect(body).toContain("inBuildGreenNote({ kind: 'gave-up', why }");
    // The budget is a named constant, so the reason 35s is smaller than `browseUrl`'s own worst case
    // lives beside the number instead of being an anonymous literal nobody can question.
    expect(body).toContain('IN_BUILD_PROOF_BUDGET_MS');
    expect(body).not.toContain('35_000');
  });

  it('the attempt records exactly ONE line whatever happens — no branch can skip it', () => {
    const route = src('src/server/routes/agentv3.ts');
    const block = route.slice(route.indexOf('const attemptInBuildGreen'));
    const body = block.slice(0, block.indexOf('const stopInBuildGreen'));
    // The old shape was `if (proven && files > 0) { …record… } else if (kind !== 'proven') { …record… }`,
    // which recorded nothing for a proven render with no files.
    expect(body).not.toContain("else if (outcome.kind !== 'proven')");
    expect(body).toContain("judged.kind === 'proven' && Object.keys(files).length === 0");
  });
});

describe('a proven render with nothing to save is not reported as protection', () => {
  it('has its own outcome and never claims the app is protected', () => {
    const note = inBuildGreenNote({ kind: 'nothing-to-save' }, { elapsedMs: 120_000 });
    expect(note.code).toBe('IN_BUILD_GREEN_UNCHECKED');
    expect(note.autoResolved).toBe(false);
    expect(note.message).toMatch(/nothing was protected/i);
    // It must not read like a failure of the APP — the render was real.
    expect(note.message).toMatch(/rendered/i);
  });
});

describe('autoResolved tells the truth', () => {
  it('only a proven snapshot is auto-resolved', () => {
    expect(inBuildGreenNote({ kind: 'proven' }, { elapsedMs: 1_000, fileCount: 3 }).autoResolved).toBe(true);
    const failures: AttemptOutcome[] = [
      { kind: 'raced' }, { kind: 'not-rendered' }, { kind: 'no-browser' },
      { kind: 'server-down' }, { kind: 'not-painted' }, { kind: 'nothing-to-save' }, { kind: 'gave-up' },
    ];
    for (const f of failures) expect(inBuildGreenNote(f, { elapsedMs: 1_000 }).autoResolved, f.kind).toBe(false);
  });

  it('every outcome stays `info`, so no count and no gate can move', () => {
    const all: AttemptOutcome[] = [
      { kind: 'proven' }, { kind: 'raced' }, { kind: 'not-rendered' }, { kind: 'no-browser' },
      { kind: 'server-down' }, { kind: 'not-painted' }, { kind: 'nothing-to-save' }, { kind: 'gave-up' },
    ];
    for (const o of all) expect(inBuildGreenNote(o, { elapsedMs: 1_000 }).severity, o.kind).toBe('info');
  });
});
