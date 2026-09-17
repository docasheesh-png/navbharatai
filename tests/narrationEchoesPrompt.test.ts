// THE AGENT QUOTING THE USER'S OWN REPORTED ERROR IS NOT THE ENGINE STRUGGLING.
//
// 🔴 THE INCIDENT (build e4ebcb5f, 2026-09-17). The user's prompt was
//     "Fix this error and continue building the app: network error"
// and the agent's ordinary narration —
//     "Let me check the current app structure and identify the network error:"
// — was recorded in the report's `problems[]` as a WARNING. It is the agent quoting the symptom it
// was asked to investigate, which is the most normal thing an agent does on a "fix this error" turn.
//
// 🔑 THE CLASS: the classifier asks "does this sentence contain a scary word?" when the question it
// exists to answer is "did the ENGINE fail?". Four separate patches have NARROWED this predicate
// (2026-07-07 ×3, ShopKhata 2026-07-17, PaisaTrack 2026-07-21) and not one has widened it. The
// structural signal was already wired and simply never read: `meta.prompt` is the user's own words.
//
// The damage was never cosmetic — see the three blast-radius tests below. Each is asserted DIRECTLY,
// because the first test alone would still pass if the real harm were reintroduced elsewhere.

import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, narrationEchoesPromptSymptom } from '../src/server/AgentV3/BuildDiagnostics';
import type { AgentEvent } from '../src/server/AgentV3/types';

const PROMPT = 'Fix this error and continue building the app: network error';
const NARRATION = 'Let me check the current app structure and identify the network error:';

const say = (d: BuildDiagnostics, text: string) =>
  d.ingestEvent({ type: 'narration', agent: 'architect', text, ts: 1 } as AgentEvent);

const withPrompt = () => new BuildDiagnostics({ now: () => 1, prompt: PROMPT });

describe('the exact failure, encoded verbatim', () => {
  it('investigating the USER\'s OWN reported error is a step, not a problem', () => {
    const d = withPrompt();
    say(d, NARRATION);
    const r = d.report();
    expect(r.issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(0);
    expect(r.issues.filter((i) => i.code === 'AGENT_STEP')).toHaveLength(1);
    expect(r.problems).toHaveLength(0);
  });
});

describe('the three consequences that made this more than a mislabel', () => {
  // AGENT_NOTE is recorded autoResolved:true, and the heal tally counts autoResolved warnings —
  // so one sentence of prose was reported to the admin as one SELF-HEAL on a build that healed
  // nothing. CLAUDE.md's fifth rule mines that tally ("a self-heal is a RED FLAG"), so a future
  // autopsy would have chased a heal that never happened.
  it('does not manufacture a phantom self-heal in the admin heal tally', () => {
    const d = withPrompt();
    say(d, NARRATION);
    d.finish(true, 'done');
    expect(d.report().counts.autoResolved).toBe(0);
  });

  // deriveRootCause's resolvedOnly fallback is autoResolved-INCLUSIVE and fires whenever ok !== true,
  // and AGENT_NOTE is in neither NEVER_ROOT_CAUSE list — so the admin's headline for a failed build
  // could be the agent announcing it was about to look at something.
  it('never becomes the headline root cause of a failed build', () => {
    const d = withPrompt();
    say(d, NARRATION);
    d.finish(false, 'stopped');
    expect(d.report().rootCause ?? '').not.toContain('identify the network error');
  });

  // The reopen digest rebuilds the assistant turn from AGENT_STEP only, so a misclassified line was
  // DELETED from the user's conversation on reopen — a partial return of the 2026-07-07
  // "na chat recover hui" bug. This mirrors the filter at routes/agentv3.ts verbatim.
  it('survives into the reopen transcript digest (AGENT_STEP only)', () => {
    const d = withPrompt();
    say(d, NARRATION);
    const steps = d.report().issues.filter((i) => i.code === 'AGENT_STEP' && !/^⏱/.test(i.message));
    expect(steps.map((i) => i.message).join('\n')).toContain('identify the network error');
  });
});

describe('over-correction guards — what stops the fix becoming its own bug', () => {
  it('a REAL failure is still an error even when the prompt says "error"', () => {
    const d = withPrompt();
    say(d, 'The dev server failed to start — port 5173 error.');
    expect(d.report().issues.find((i) => i.code === 'AGENT_NOTE')?.severity).toBe('error');
  });

  it('a problem word the user NEVER wrote stays a problem', () => {
    const d = withPrompt();
    say(d, 'The preview is not responding.');
    expect(d.report().issues.find((i) => i.code === 'AGENT_NOTE')?.severity).toBe('warning');
  });

  it('a MIXED line (the user\'s word plus a new one) stays a problem', () => {
    const d = withPrompt();
    say(d, 'The network error is back and the preview is not responding.');
    expect(d.report().issues.find((i) => i.code === 'AGENT_NOTE')?.severity).toBe('warning');
  });

  it('NO prompt ⇒ byte-identical to before this change', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    say(d, NARRATION);
    expect(d.report().issues.find((i) => i.code === 'AGENT_NOTE')?.severity).toBe('warning');
  });
});

describe('narrationEchoesPromptSymptom — the pure helper', () => {
  it('is word-level, every-not-some, and empty-prompt-safe', () => {
    expect(narrationEchoesPromptSymptom('the network error', 'fix this error')).toBe(true);
    expect(narrationEchoesPromptSymptom('the preview is not responding', 'fix this error')).toBe(false);
    expect(narrationEchoesPromptSymptom('error and not responding', 'fix this error')).toBe(false);
    expect(narrationEchoesPromptSymptom('the network error', undefined)).toBe(false);
    expect(narrationEchoesPromptSymptom('the network error', '')).toBe(false);
    expect(narrationEchoesPromptSymptom('all clean', 'fix this error')).toBe(false); // no problem word
  });

  it('never throws on junk', () => {
    for (const [t, p] of [[null, null], [undefined, undefined], ['', ''], [1 as never, {} as never]]) {
      expect(() => narrationEchoesPromptSymptom(t as never, p as never)).not.toThrow();
    }
  });

  // ⚠️ MEASURED HAZARD: `.test()` on a /g regex is STATEFUL — the same string returns
  // true/false/true as lastIndex advances and resets. If a later refactor reuses ONE global regex
  // for both the classifier's `.test()` and this helper's `.match()`, a line's verdict starts
  // depending on how many lines preceded it. This is invisible in a single-call test.
  it('is deterministic across repeated calls (the stateful-/g trap)', () => {
    for (let i = 0; i < 3; i++) {
      expect(narrationEchoesPromptSymptom('the network error', 'fix this error')).toBe(true);
    }
    // ⚠️ THIS IS THE HALF THAT ACTUALLY BITES, and TWO earlier drafts of it did not — both were
    // written from a guess and neither was measured first.
    //   Draft 1 drove the helper only (`.match()`, never stateful) — it passed with the bug installed.
    //   Draft 2 sent the SAME line three times; identical narrations DEDUPE into one issue carrying
    //   `repeatCount: 3`, so the count could never be 3 and it failed against correct code too.
    // Measured: three DISTINCT problem lines record three separate AGENT_NOTEs (warning/error/warning).
    // That is where a shared /g regex does its damage — `lastIndex` survives between `.test()` calls,
    // so a later line starts matching mid-string and its verdict flips. NO prompt here, so the echo
    // rule is out of the way and `problemWord` alone decides.
    const d = new BuildDiagnostics({ now: () => 1 });
    for (const line of [
      'The preview is not responding.',
      'Sandbox unavailable — retrying.',
      'The build is stuck on the port.',
    ]) say(d, line);
    expect(d.report().issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(3);
  });
});

// ⛔ THE TRAP, PINNED SO IT CANNOT BE "TIDIED UP".
//
// The problem-word list matches `error` SINGULAR only — `\berror\b` does not match "errors", because
// the trailing "s" kills the word boundary. So the classifier's verdict on the identical concept
// flips on grammatical number, and that is almost certainly accidental (the compound stripper one
// line below writes `errors?[- ]`, so the author handled plurals there and forgot them here).
//
// DO NOT "COMPLETE" IT BY ADDING `s?`. It was measured against six realistic narration lines — among
// them "Let me verify there are no TypeScript errors:" and "Now let me handle the API errors
// gracefully:" — and ALL SIX would newly flag as problems. The plural blindness is currently acting
// as a noise filter that suppresses roughly half this bug class. Widening it is a SEPARATE change
// needing its own evidence that the extra findings are real.
describe('plural problem words are deliberately NOT matched', () => {
  it('"console errors" is a step — widening this needs its own change and its own evidence', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    say(d, "Now let me check the console errors and see what's happening:");
    expect(d.report().issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(0);
    expect(d.report().issues.filter((i) => i.code === 'AGENT_STEP')).toHaveLength(1);
  });
});
