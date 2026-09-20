import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describeJudgeVerdict, judgeEngineLabel, judgeBuild } from '../src/server/AgentV3/BuildJudge';

/**
 * A judge that never ran did not pass.
 *
 * 🔴 FOUND WHILE THE ADMIN WAS CONFIGURING NEMOTRON (autopsy 31dc61fd follow-up, 2026-09-20).
 * `NEMOTRON_BASE_URL` was set to NVIDIA's own endpoint while the model ids kept their OpenRouter
 * spelling — a mismatch `nemotron.ts`'s own docblock warns about. Chasing what that would DO found a
 * reporting bug older and wider than Nemotron:
 *
 *   • `judgeBuild` catches a provider failure and returns `pass: true` ON PURPOSE — a judge must never
 *     fail a user's app over its own outage — and puts the truth in `findings`.
 *   • `recordVerdict` printed PASS/FAIL from `pass`, and appended `findings` ONLY when pass was false.
 *
 * So a judge that could not run was filed as:  `Sonnet review: PASS (score 0)`
 * — a pass, with the explanation discarded, under the name of an engine that had not run (the
 * `reviewerName` ternary had no `nemotron` branch and fell through to 'Sonnet').
 *
 * Nothing broke. That is the point: a misconfigured judge would have looked like a passing review on
 * every build, for ever.
 */

describe('three outcomes, not two', () => {
  it('🔴 a judge that could not run is NOT RUN, never PASS', () => {
    const d = describeJudgeVerdict({ pass: true, score: 0, reviewed: false, findings: ['The build review could not be completed, so this build has not been reviewed.'] });
    expect(d.label).toBe('NOT RUN');
    expect(d.label).not.toBe('PASS');
  });

  it('…and it is a WARNING — a gate that silently stopped existing must be visible', () => {
    expect(describeJudgeVerdict({ pass: true, score: 0, reviewed: false, findings: ['x'] }).severity).toBe('warning');
  });

  it('any verdict carrying reviewed:false is NOT RUN, whatever its findings say', () => {
    // ⚠️ TITLE CORRECTED AT THE MERGE: this case passes `reviewed: false` in by hand, so it tests the
    // DESCRIBER, not what `judgeBuild` returns for an empty workspace — which is `reviewed: true`,
    // decided below. Leaving the old title would have made this file contradict itself.
    expect(describeJudgeVerdict({ pass: true, score: 0, reviewed: false, findings: ['There were no files to review'] }).label).toBe('NOT RUN');
  });

  it('a genuine pass is still PASS and still info', () => {
    const d = describeJudgeVerdict({ pass: true, score: 92, findings: [] });
    expect(d.label).toBe('PASS');
    expect(d.severity).toBe('info');
  });

  it('a genuine failure is still FAIL and still a warning', () => {
    const d = describeJudgeVerdict({ pass: false, score: 40, findings: ['the save button does nothing'] });
    expect(d.label).toBe('FAIL');
    expect(d.severity).toBe('warning');
  });

  it('🔴 the detail survives on EVERY outcome, including a pass', () => {
    // The old line appended findings only on failure, throwing away the sentence the judge had
    // already written to explain itself.
    expect(describeJudgeVerdict({ pass: true, score: 0, reviewed: false, findings: ['could not be completed'] }).detail)
      .toContain('could not be completed');
    expect(describeJudgeVerdict({ pass: true, score: 88, findings: ['minor: add a label'] }).detail)
      .toContain('minor: add a label');
  });

  it('a real verdict that legitimately scores 0 is a FAIL, not "not run"', () => {
    // The reader must never infer "did not run" from score 0 — the judge states it instead.
    expect(describeJudgeVerdict({ pass: false, score: 0, findings: ['nothing works'] }).label).toBe('FAIL');
  });

  it('a producer that says nothing about `reviewed` keeps today\'s meaning', () => {
    expect(describeJudgeVerdict({ pass: true, score: 100, findings: [] }).label).toBe('PASS');
  });
});

describe('the engine is named correctly, or not at all', () => {
  it('🔴 nemotron is named — the ternary this replaces fell through to "Sonnet"', () => {
    expect(judgeEngineLabel('nemotron')).toBe('Nemotron');
    expect(judgeEngineLabel('nemotron')).not.toBe('Sonnet');
  });

  it.each([['grok', 'Grok'], ['glm', 'GLM'], ['opus', 'Opus'], ['sonnet', 'Sonnet']] as const)(
    '%s → %s', (kind, label) => {
      expect(judgeEngineLabel(kind)).toBe(label);
    });
});

describe('the judge itself reports whether it reviewed', () => {
  it('a provider that throws yields reviewed:false — and still never blocks the build', async () => {
    const v = await judgeBuild('make a todo app', [{ path: 'a.ts', content: 'x' }],
      async () => { throw new Error('404 model not found'); }, 'some-model');
    expect(v.reviewed).toBe(false);
    expect(v.pass, 'a judge outage must never fail a user\'s app').toBe(true);
    expect(describeJudgeVerdict(v).label).toBe('NOT RUN');
  });

  /**
   * 🔴 THE ONE PLACE THE TWO SESSIONS DISAGREED, decided at the merge and recorded here rather than
   * quietly flipped (2026-09-20). This PR set the empty-workspace verdict to `reviewed: false`;
   * #3143 — which fixed the other half of this same root cause and landed first — set it TRUE, with
   * its reasoning in the code: `reviewed` answers *"did OUR instrument run?"*, and for an empty
   * project it did. We looked; there was nothing to look at. That is a finding about the APP, which
   * is the opposite of a judge that could not be reached.
   *
   * It matters because `judgeActuallyRan` gates `CHEAP_REVIEW_NOT_RUN`, a PROCESS_ONLY code that says
   * the PLATFORM's reviewer did not run — filing an empty project under it would blame our instrument
   * for the user's app being absent.
   *
   * ⚠️ The complaint behind this PR's original choice was real and is NOT dropped: a bare `PASS` for
   * an app that does not exist. That is fixed by this PR's OTHER half, which is kept — the detail is
   * now printed on EVERY outcome, so the report reads `PASS (score 0) — There were no files to
   * review …` instead of a naked PASS. The wording is honest; the flag stays with its owner's meaning.
   */
  it('an empty workspace is reviewed:true — we DID look, and the honest reason is printed', async () => {
    const v = await judgeBuild('make a todo app', [], async () => ({ text: 'PASS 100' }), 'm');
    expect(v.reviewed).toBe(true);
    expect(v.score).toBe(0);
    const d = describeJudgeVerdict(v);
    expect(d.label).toBe('PASS');
    expect(d.detail).toMatch(/no files to review/i);
  });
});

describe('the wiring — asserted from source, comments stripped', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('the report goes through the shared describer, not a local ternary', () => {
    expect(route).toContain('describeJudgeVerdict(v)');
    expect(route).not.toContain("v.pass ? 'PASS' : 'FAIL'");
  });

  it('and through the shared label, so a new engine cannot fall through to a lie', () => {
    expect(route).toContain('judgeEngineLabel(judge.kind)');
    expect(route).not.toContain("judge.kind === 'grok' ? 'Grok'");
  });
});
