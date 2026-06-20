import { describe, it, expect } from 'vitest';
import { detectLanguage, languageDirective } from '../src/server/Guider/LanguageDetect';
import {
  Guider, extractJsonObject, parsePlanResponse, parseGradeResponse, composePrompt,
} from '../src/server/Guider/Guider';
import type { GenResult, GuiderPlan } from '../src/server/Guider/GuiderTypes';

describe('detectLanguage', () => {
  it('detects Devanagari Hindi', () => expect(detectLanguage('एक app banao')).toBe('hi'));
  it('detects romanized Hinglish by markers', () => expect(detectLanguage('mujhe ek app banao jaldi karo')).toBe('hinglish'));
  it('defaults to English', () => expect(detectLanguage('build me a finance tracker app')).toBe('en'));
  it('languageDirective covers hi + en', () => {
    expect(languageDirective('hi')).toMatch(/Hindi/);
    expect(languageDirective('en')).toMatch(/English/);
  });
});

describe('JSON parsing helpers', () => {
  it('extractJsonObject strips fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('parsePlanResponse parses a valid plan and keeps confirmation on by default', () => {
    const raw = JSON.stringify({
      language: 'hi', summary: 's', requirements: ['r1'],
      acceptanceCriteria: [{ id: 'c1', text: 'crit' }], outOfScope: [],
      designProposal: 'योजना', clarifyingQuestions: ['क्या रंग?'],
    });
    const plan = parsePlanResponse(raw, 'app banao');
    expect(plan.language).toBe('hi');
    expect(plan.spec.acceptanceCriteria[0].id).toBe('c1');
    expect(plan.designProposal).toBe('योजना');
    expect(plan.confirmationRequired).toBe(true);
    expect(plan.clarifyingQuestions).toEqual(['क्या रंग?']);
  });

  it('parsePlanResponse falls back safely on garbage and still requires confirmation', () => {
    const plan = parsePlanResponse('not json at all', 'मुझे app chahiye');
    expect(plan.confirmationRequired).toBe(true);
    expect(plan.language).toBe('hi'); // heuristic from Devanagari in the prompt
    expect(plan.spec.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('parseGradeResponse reads pass/score/gaps; bad JSON is a conservative non-pass', () => {
    const spec = { summary: '', requirements: [], acceptanceCriteria: [{ id: 'c1', text: 'x' }], outOfScope: [] };
    const good = parseGradeResponse('{"pass":true,"score":92,"gaps":[],"summary":"ok"}', spec, 85);
    expect(good.pass).toBe(true);
    expect(good.score).toBe(92);
    const bad = parseGradeResponse('garbage', spec, 85);
    expect(bad.pass).toBe(false);
    expect(bad.gaps.length).toBe(1);
  });

  it('composePrompt switches to a targeted fix prompt on later attempts', () => {
    const spec = { summary: 'S', requirements: ['r'], acceptanceCriteria: [{ id: 'c1', text: 'x' }], outOfScope: [] };
    expect(composePrompt(spec, [], 1)).toContain('Requirements:');
    const fix = composePrompt(spec, [{ criterionId: 'c1', issue: 'missing button' }], 2);
    expect(fix).toContain('still NOT satisfied');
    expect(fix).toContain('missing button');
  });
});

function gen(okText: string): (p: string, a: number) => Promise<GenResult> {
  return async () => ({ ok: true, gradeContext: okText });
}
const planWith = (confirmationRequired: boolean): GuiderPlan => ({
  language: 'en',
  spec: { summary: 'S', requirements: ['r'], acceptanceCriteria: [{ id: 'c1', text: 'x' }], outOfScope: [] },
  designProposal: 'plan', confirmationRequired, clarifyingQuestions: [],
});

describe('Guider.run — confirmation gate + honest loop', () => {
  it('refuses to implement an unconfirmed design (the core safety rule)', async () => {
    const g = new Guider({ callModel: async () => '{}', generate: gen('built') });
    await expect(g.run(planWith(true))).rejects.toThrow(/confirmation/i);
  });

  it('runs once confirmed, and passes when the grader is satisfied', async () => {
    const g = new Guider({ callModel: async () => '{"pass":true,"score":95,"gaps":[],"summary":"great"}', generate: gen('built') });
    const res = await g.run(planWith(true), { confirmed: true });
    expect(res.status).toBe('passed');
    expect(res.iterations).toBe(1);
  });

  it('stops at the budget when requirements are never fully met', async () => {
    let n = 0;
    const scores = [40, 60, 70, 80]; // improving but never reaching passScore (85)
    const g = new Guider({
      callModel: async () => `{"pass":false,"score":${scores[Math.min(n++, 3)]},"gaps":[{"criterionId":"c1","issue":"more"}],"summary":"x"}`,
      generate: gen('built'),
      maxIterations: 4,
    });
    const res = await g.run(planWith(false), { confirmed: true });
    expect(res.status).toBe('budget_exhausted');
    expect(res.iterations).toBe(4);
    expect(res.finalGrade?.score).toBe(80); // best score retained
  });

  it('stops early (no_progress) when the score stops improving', async () => {
    const g = new Guider({
      callModel: async () => '{"pass":false,"score":50,"gaps":[{"criterionId":"c1","issue":"flat"}],"summary":"x"}',
      generate: gen('built'),
      maxIterations: 6,
    });
    const res = await g.run(planWith(false), { confirmed: true });
    expect(res.status).toBe('no_progress');
    expect(res.iterations).toBeLessThan(6);
  });
});

describe('Guider.plan', () => {
  it('produces a plan and never implements (returns a proposal needing confirmation)', async () => {
    const raw = JSON.stringify({ language: 'hi', summary: 's', requirements: ['r'], acceptanceCriteria: [{ id: 'c1', text: 'c' }], outOfScope: [], designProposal: 'योजना', confirmationRequired: true, clarifyingQuestions: [] });
    const g = new Guider({ callModel: async () => raw, generate: gen('x') });
    const plan = await g.plan('मुझे ek todo app banao');
    expect(plan.confirmationRequired).toBe(true);
    expect(plan.designProposal).toBe('योजना');
  });
});
