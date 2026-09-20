/**
 * 🔴 A BUILD THAT DID NOTHING TOLD THE USER IT HAD MADE THEIR CHANGE — AND BILLED THEM FOR IT.
 *
 * ## The report this encodes (build `586295b7`, 2026-09-20)
 *
 * The user typed *"Add pagination or infinite scroll to the main list"*, then pressed Stop. The build
 * lasted **10.5 seconds**. Three independent facts in that one report say nothing happened:
 * `writtenFiles.size === 0` (the zero-bill branch it took requires it), `LADDER_DEPTH matched=0`, and
 * `realCostUsd: 0` with no `llmCalls` at all. `UPSELL_SUPPRESSED` says it in words — *"no engine was
 * ever asked to build anything"*.
 *
 * The user was nonetheless told, in their own chat:
 *
 *   ⚠️ "I made your change, but I could not open your app to confirm it works this time.
 *       Your change is saved…"
 *   🧾 "I could not confirm your app running here, so you have been charged only what this build
 *       actually cost to run…"
 *
 * **No change was made. They were charged ₹0.** And the same report's `summary` said the opposite two
 * lines away: *"Nothing had been written yet, so nothing was lost."*
 *
 * ## One root cause, four doors — a fact with more cases than the code tests for
 *
 * | # | The code asked | The honest question | What it cost |
 * |---|---|---|---|
 * | 1 | `hasSnapshot && !previewGreen` | did this turn write anything? | "I made your change" |
 * | 2 | is the bill waived? | is the bill FINAL? | "you have been charged" on a ₹0 build |
 * | 3 | is this line `severity: error`? | is this a measurement or a repeated sentence? | 3 errors, 2 self-heals, on a build that did neither |
 * | 4 | is this an import turn? | did we write this code? | a warning about the user's own untouched file counted as one of 4 "unresolved" |
 *
 * 🔑 **Door 1 is the third meaning of a distinction this repo had already drawn once.**
 * `provenBroken` exists precisely because `green: false` meant BOTH *"we looked and it is broken"* and
 * *"we could not look"*. Nobody split the third: **there was nothing to look at.**
 *
 * 🔑 **Door 3 is the fourth time this tally has counted something that is not a heal** — heartbeats,
 * import observations, provider fallbacks, and now NavBharatAI's own honest notices to the user,
 * classified `error` because they contain the words "could not".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideGreenGuard, greenGuardShouldTellUnverified } from '../src/server/AgentV3/GreenGuard';
import { findingAboutUntouchedCode, importTurnObservation, isNarrationEntry, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';

const root = join(__dirname, '..');
const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');

describe('🔴 door 1 — "I made your change" on a turn that made none', () => {
  const stopped = { hasSnapshot: true, previewGreen: false, filesWrittenThisTurn: 0 };

  it('says NOTHING when the turn wrote nothing', () => {
    expect(greenGuardShouldTellUnverified(stopped)).toBe(false);
  });

  it('still says it when a real change could not be checked — the case it exists for', () => {
    expect(greenGuardShouldTellUnverified({ ...stopped, filesWrittenThisTurn: 3 })).toBe(true);
  });

  it('is silent on a green preview and with no snapshot to fall back to', () => {
    expect(greenGuardShouldTellUnverified({ hasSnapshot: true, previewGreen: true, filesWrittenThisTurn: 3 })).toBe(false);
    expect(greenGuardShouldTellUnverified({ hasSnapshot: false, previewGreen: false, filesWrittenThisTurn: 3 })).toBe(false);
  });

  it('the recorded REASON stops claiming changes that do not exist', () => {
    const none = decideGreenGuard({
      before: { green: true }, after: { green: false },
      hasSnapshot: true, provenBroken: false, filesWrittenThisTurn: 0,
    });
    expect(none.action).toBe('none');
    expect(none.reason).toContain('Nothing was written this turn');
    expect(none.reason).not.toContain('changes were kept');
    // …and the ordinary case is untouched.
    const kept = decideGreenGuard({
      before: { green: true }, after: { green: false },
      hasSnapshot: true, provenBroken: false, filesWrittenThisTurn: 2,
    });
    expect(kept.reason).toContain('changes were kept');
  });

  it('🔒 the route holds NO private copy of the rule', () => {
    // It used to be `} else if (hasSnapshot && !previewGreen) {` — two of the three questions.
    expect(route).not.toMatch(/\}\s*else if \(hasSnapshot && !previewGreen\)/);
    expect(route).toContain('greenGuardShouldTellUnverified({ hasSnapshot, previewGreen, filesWrittenThisTurn: writtenFiles.size })');
    expect(route).toContain('filesWrittenThisTurn: writtenFiles.size,');
  });
});

describe('🔴 door 2 — a money statement is made once, after the money is final', () => {
  it('the waiver still computes the same reduced bill', () => {
    // The ARITHMETIC must not move: it runs before the zeroing rules on purpose.
    const d = decideMarkupOnProof({
      decidedBilledUsd: 0.0019, realCostUsd: 0, sandboxUsd: 0.000482,
      previewProven: false, expectsArtifacts: true, enabled: true,
    });
    expect(d.markupApplied).toBe(false);
    expect(d.billedUsd).toBeCloseTo(0.000482, 6);
    expect(d.userMessage).toContain('charged only what this build');
  });

  it('🔒 the sentence is HELD, not emitted where the bill is still provisional', () => {
    // Four later rules can zero the bill; the reported build hit one of them and the user was told
    // they had been charged, then charged nothing.
    expect(route).toContain('let waivedMarkupNotice: string | null = null;');
    expect(route).toContain('if (markupDecision.userMessage) waivedMarkupNotice = markupDecision.userMessage;');
  });

  it('🔒 …and emitted only when the waived amount is STILL what the user pays', () => {
    expect(route).toContain('if (waivedMarkupNotice && effectiveBilledUsd > 0 && effectiveBilledUsd === markupDecision.billedUsd)');
    // The emit must come AFTER every rule that can change the bill.
    const emitAt = route.indexOf('waivedMarkupNotice && effectiveBilledUsd > 0');
    for (const zeroer of [
      'if (expectsArtifacts && writtenFiles.size === 0) {',
      'if (zeroBillForUnrenderedPreview(expectsArtifacts, previewVerifiedFailed)) {',
      '} else if (zeroBillForFailedBuild(result.ok) && effectiveBilledUsd > 0) {',
    ]) {
      const at = route.indexOf(zeroer);
      expect(at, `missing zeroing rule: ${zeroer}`).toBeGreaterThan(-1);
      expect(at, `the notice is emitted before: ${zeroer}`).toBeLessThan(emitAt);
    }
  });
});

describe('🔴 door 3 — narration is not a finding', () => {
  it('recognises the engine repeating a sentence', () => {
    expect(isNarrationEntry({ code: 'AGENT_NOTE' })).toBe(true);
    expect(isNarrationEntry({ code: 'AGENT_STEP' })).toBe(true);
    expect(isNarrationEntry({ code: 'RELEASE_GATE' })).toBe(false);
    expect(isNarrationEntry({ code: 'ACCESSIBILITY' })).toBe(false);
    expect(isNarrationEntry({})).toBe(false);
  });

  it('🔴 the reported build: 2 notices counted as 2 self-heals AND 2 errors', () => {
    const d = new BuildDiagnostics({ prompt: 'Add pagination to the main list' });
    // The two sentences NavBharatAI itself wrote, exactly as the classifier filed them.
    d.record({ phase: 'build', severity: 'error', code: 'AGENT_NOTE', autoResolved: true,
      message: '⚠️ I made your change, but I could not open your app to confirm it works this time.' });
    d.record({ phase: 'build', severity: 'error', code: 'AGENT_NOTE', autoResolved: true,
      message: '🧾 I could not confirm your app running here, so you have been charged only what this build actually cost to run.' });
    const c = d.report().counts;
    expect(c.errors).toBe(0);         // was 2 — a build that hit no error
    expect(c.autoResolved).toBe(0);   // was 2 — a build that healed nothing
    expect(c.unresolved).toBe(0);
  });

  it('a REAL finding still counts, in every tally', () => {
    const d = new BuildDiagnostics({ prompt: 'x' });
    d.record({ phase: 'build', severity: 'error', code: 'BUILD_ERROR', message: 'tsc failed', autoResolved: false });
    d.record({ phase: 'build', severity: 'warning', code: 'SYNTAX_HEALED', message: 'fixed', autoResolved: true });
    const c = d.report().counts;
    expect(c.errors).toBe(1);
    expect(c.warnings).toBe(1);
    expect(c.autoResolved).toBe(1);
    expect(c.unresolved).toBe(1);
  });

  it('🔒 narration stays on the TIMELINE — nothing is hidden, it just stops moving the numbers', () => {
    const d = new BuildDiagnostics({ prompt: 'x' });
    d.record({ phase: 'build', severity: 'error', code: 'AGENT_NOTE', message: 'could not open', autoResolved: true });
    expect(d.report().issues.some((i) => i.code === 'AGENT_NOTE')).toBe(true);
  });
});

describe('🔴 door 4 — a finding about code we did not write is an OBSERVATION', () => {
  it('a zero-write turn marks it, with wording that does not borrow the import caveat', () => {
    const o = findingAboutUntouchedCode('no-writes', 'Accessibility 70/100 (C): 6 form fields with no label.');
    expect(o.observation).toBe(true);
    expect(o.autoResolved).toBe(true);
    expect(o.message).toContain('this turn changed nothing');
    // The import turn's caveat is about a knowingly PARTIAL file map; on a zero-write turn the map is
    // the real project, so claiming it "may not be accurate" would be a different untruth.
    expect(o.message).not.toContain('too large to import');
  });

  it('the import case keeps its own caveat, exactly as the mitrify autopsy wrote it', () => {
    const o = importTurnObservation(true, 'Unused dependency: date-fns');
    expect(o.observation).toBe(true);
    expect(o.message).toContain('too large to import');
  });

  it('a turn that DID write is ours to own — unchanged', () => {
    expect(findingAboutUntouchedCode(null, 'x')).toEqual({ autoResolved: false, message: 'x' });
    expect(importTurnObservation(false, 'x')).toEqual({ autoResolved: false, message: 'x' });
  });

  it('🔒 an observation moves neither the unresolved nor the self-heal tally', () => {
    const d = new BuildDiagnostics({ prompt: 'x' });
    d.record({ phase: 'build', severity: 'warning', code: 'ACCESSIBILITY',
      ...findingAboutUntouchedCode('no-writes', 'Accessibility 70/100 (C).') });
    const c = d.report().counts;
    expect(c.unresolved).toBe(0);
    expect(c.autoResolved).toBe(0);
    expect(c.observations).toBe(1);
  });

  it('🔒 the route asks "did we write this?", not "how did this turn begin?"', () => {
    expect(route).toContain("(writtenFiles.size === 0 ? 'no-writes' : null)");
    expect(route).toContain('const obs = (message: string) => findingAboutUntouchedCode(untouchedReason, message);');
  });
});
