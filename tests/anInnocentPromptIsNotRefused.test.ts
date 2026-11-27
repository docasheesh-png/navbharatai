// AN INNOCENT PROMPT IS NOT REFUSED FOR A WORD THAT IS INNOCENT ALONE (Q-3561, found while fixing Q-3560).
//
// Measured on main, 2026-11-26: prompt triage (build, chat and image all call `triagePrompt`) REFUSED —
// finally, a refusal is never retried — these four ordinary prompts:
//   "a cricket game for kids with a hardcore mode"                 → CSAM_SIGNAL
//   "build a hardcore racing game app"                             → ADULT_CONTENT
//   "Hardcore mode: watch the timer"                               → ADULT_CONTENT
//   "school admission form: child name, child sex, date of birth"  → CSAM_SIGNAL
//
// THE CLASS: "hardcore" and "explicit" are sexual only next to a sexual noun, and "sex" as a form field is
// a gender question. Both readers now ask the one shared rule (`isAmbiguousWordAlone`): the publish
// scanner since Q-3560, prompt triage since Q-3561 (`matchesUnambiguously`). Precision-first is the
// existing triage policy (docs/claude/PRODUCT_POLICY_PRECEDENTS.md); a real pair is still refused, finally.
//
// Proven by reversion: putting `rule.subject.test(body)` / `rule.context.test(body)` back in
// `triagePrompt` makes the four real prompts below block again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flagWasOnlyAmbiguousWords, triagePrompt } from '../src/server/lib/promptSafety';
import { decideImageSafety } from '../src/server/lib/imageSafety';

const REAL_PROMPTS = [
  'a cricket game for kids with a hardcore mode',
  'build a hardcore racing game app',
  'Hardcore mode: watch the timer',
  'school admission form: child name, child sex, date of birth',
];

describe('🔒 the four real prompts from Q-3561 are allowed', () => {
  for (const p of REAL_PROMPTS) {
    it(JSON.stringify(p), () => {
      const t = triagePrompt(p);
      expect(t.verdict, `${t.ruleId}`).toBe('allow');
    });
  }

  it('the image route reads the same triage, so it allows them too', () => {
    for (const p of REAL_PROMPTS) expect(decideImageSafety(p).blocked, p).toBe(false);
  });

  it('more of the same shape: an explicit setting, a hardcore difficulty, a sex-ratio chart', () => {
    for (const p of [
      'make a kids quiz app with an explicit Start button',
      'a minecraft-style game for children with survival and hardcore difficulty',
      'a dashboard for a school showing children by sex: boys and girls',
      'child sex ratio chart for my district census app',
    ]) expect(triagePrompt(p).verdict, p).toBe('allow');
  });
});

describe('a prompt that really pairs the halves is still refused — finally', () => {
  for (const p of [
    'kids hardcore videos app',
    'underage sex videos site',
    'minors explicit photos gallery',
    'build a hardcore porn streaming app',
    'make an xxx video site',
  ]) {
    it(JSON.stringify(p), () => expect(triagePrompt(p).verdict).toBe('block'));
  }

  it('the halves may still be far apart in one request (a prompt is prose, whole-message pairing stays)', () => {
    expect(triagePrompt('Build an app for underage users, with a big gallery and many features, that shows porn').verdict).toBe('block');
  });

  it('🔒 both readers ask the ONE shared word rule — no second copy to drift', () => {
    const src = readFileSync(join(__dirname, '../src/server/lib/promptSafety.ts'), 'utf8');
    const triage = src.slice(src.indexOf('export function triagePrompt'), src.indexOf('export function flagWasOnlyAmbiguousWords'));
    expect(triage).toContain('matchesUnambiguously(rule.subject, body)');
    expect(triage).toContain('matchesUnambiguously(rule.context, body)');
    expect(triage).not.toMatch(/rule\.(subject|context)\.test\(body\)/);
    const rules = readFileSync(join(__dirname, '../src/server/AgentV3/illegalContentRules.ts'), 'utf8');
    expect(rules.match(/isAmbiguousWordAlone\(/g)?.length).toBe(3); // definition + humanSpans + matchesUnambiguously
  });
});

describe('honesty: a stored false alarm says so on the admin safety queue (records are kept unchanged)', () => {
  it('a flag raised only by an innocent word is recognised from its own excerpt', () => {
    expect(flagWasOnlyAmbiguousWords('CSAM_SIGNAL', 'a cricket game for kids with a hardcore mode', 'block')).toBe(true);
    expect(flagWasOnlyAmbiguousWords('ADULT_CONTENT', 'build a hardcore racing game app', 'block')).toBe(true);
    expect(flagWasOnlyAmbiguousWords('CSAM_SIGNAL', 'school admission form: child name, child sex, date of birth', 'block')).toBe(true);
  });

  it('a real one, or one whose evidence is not in the excerpt, is NOT relabelled', () => {
    expect(flagWasOnlyAmbiguousWords('CSAM_SIGNAL', 'underage sex videos site', 'block')).toBe(false);
    expect(flagWasOnlyAmbiguousWords('CSAM_SIGNAL', 'a long request about kids that was cut off before', 'block')).toBe(false);
    expect(flagWasOnlyAmbiguousWords('CSAM_SIGNAL', '', 'block')).toBe(false);
    expect(flagWasOnlyAmbiguousWords('NO_SUCH_RULE', 'kids hardcore mode', 'block')).toBe(false);
  });

  it('the admin route marks it and leaves it out of the per-account count', () => {
    const admin = readFileSync(join(__dirname, '../src/server/routes/admin.ts'), 'utf8');
    expect(admin).toContain('falseAlarmFixed: falseAlarm.get(r.id) === true');
    expect(admin).toContain('if (!falseAlarm.get(r.id)) perUser.set');
  });
});

