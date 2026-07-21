import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSurveyIntegration, SURVEY_SERVICE_SOURCE } from './SurveyGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateSurveyIntegration (wiring)', () => {
  it('emits the survey service, routes and README', () => {
    const out = generateSurveyIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/surveys/surveyService.ts');
    expect(paths).toContain('server/surveys/routes.ts');
    expect(paths).toContain('server/surveys/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/surveys/routes.ts']).toContain('export const surveyRouter');
    expect(out.files['server/surveys/routes.ts']).toContain('/results');
  });
});

// Materialize + execute the emitted domain logic — the response-validation + aggregation rules are real
// business rules, verified against the actual emitted code.
describe('emitted SurveyService — schema-validated responses + exact aggregation (real logic)', () => {
  const artifact = join(here, `._survey_emitted_${process.pid}.ts`);
  writeFileSync(artifact, SURVEY_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type QuestionType = 'single_choice' | 'multi_choice' | 'rating' | 'text';
  type AnswerValue = string | string[] | number;
  interface Option { id: string; label: string }
  interface Question { id: string; type: QuestionType; prompt: string; required: boolean; options: Option[] }
  interface Survey { id: string; title: string; questions: Question[]; createdAt: string }
  interface SurveyResponse { id: string; surveyId: string; answers: Record<string, AnswerValue>; submittedAt: string }
  interface Service {
    create(input: { title: string; questions: Array<{ type: QuestionType; prompt: string; required?: boolean; options?: string[] }> }, now?: Date): Survey;
    get(id: string): Survey | undefined;
    submit(surveyId: string, answers: Record<string, AnswerValue>, now?: Date): SurveyResponse;
    responseCount(surveyId: string): number;
    aggregate(surveyId: string): Record<string, { type: string; counts?: Record<string, number>; average?: number; count?: number; answers?: string[] }>;
  }
  interface Emitted { SurveyService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  function sample(svc: Service): Survey {
    return svc.create({
      title: 'Product feedback',
      questions: [
        { type: 'single_choice', prompt: 'Favorite plan?', required: true, options: ['Free', 'Pro'] },
        { type: 'rating', prompt: 'How likely to recommend?', required: true },
        { type: 'text', prompt: 'Anything else?', required: false },
      ],
    });
  }

  it('creates a typed survey and validates the spec', async () => {
    const { SurveyService } = await load();
    const svc = new SurveyService();
    const s = sample(svc);
    expect(s.questions.length).toBe(3);
    expect(s.questions[0].options.length).toBe(2);
    expect(() => svc.create({ title: '', questions: [] })).toThrow(/title is required/);
    expect(() => svc.create({ title: 'x', questions: [] })).toThrow(/at least one question/);
    expect(() => svc.create({ title: 'x', questions: [{ type: 'single_choice', prompt: 'q', options: ['only'] }] })).toThrow(/at least two options/);
    expect(() => svc.create({ title: 'x', questions: [{ type: 'bogus' as QuestionType, prompt: 'q' }] })).toThrow(/invalid question type/);
  });

  it('THE INVARIANT: an invalid response is REJECTED, never stored', async () => {
    const { SurveyService } = await load();
    const svc = new SurveyService();
    const s = sample(svc);
    const [q1, q2] = s.questions;
    // missing a required answer
    expect(() => svc.submit(s.id, { [q1.id]: q1.options[0].id })).toThrow(/missing required answer/);
    // invalid option id for a choice question
    expect(() => svc.submit(s.id, { [q1.id]: 'bogus', [q2.id]: 5 })).toThrow(/invalid option/);
    // rating out of range
    expect(() => svc.submit(s.id, { [q1.id]: q1.options[0].id, [q2.id]: 9 })).toThrow(/rating must be 1..5/);
    // none of the above were stored
    expect(svc.responseCount(s.id)).toBe(0);
  });

  it('stores a valid response and aggregates each question EXACTLY', async () => {
    const { SurveyService } = await load();
    const svc = new SurveyService();
    const s = sample(svc);
    const [q1, q2, q3] = s.questions;
    svc.submit(s.id, { [q1.id]: q1.options[0].id, [q2.id]: 4, [q3.id]: 'love it' });   // Free, 4
    svc.submit(s.id, { [q1.id]: q1.options[1].id, [q2.id]: 5 });                        // Pro, 5, no text
    svc.submit(s.id, { [q1.id]: q1.options[0].id, [q2.id]: 3, [q3.id]: 'needs work' }); // Free, 3
    expect(svc.responseCount(s.id)).toBe(3);
    const agg = svc.aggregate(s.id);
    // single_choice counts: Free=2, Pro=1
    expect(agg[q1.id].counts?.[q1.options[0].id]).toBe(2);
    expect(agg[q1.id].counts?.[q1.options[1].id]).toBe(1);
    // rating average: (4+5+3)/3 = 4
    expect(agg[q2.id].average).toBe(4);
    expect(agg[q2.id].count).toBe(3);
    // text answers list (only the 2 provided)
    expect(agg[q3.id].answers).toEqual(['love it', 'needs work']);
    expect(agg[q3.id].count).toBe(2);
  });

  it('multi_choice dedups and counts each selected option; unknown survey throws', async () => {
    const { SurveyService } = await load();
    const svc = new SurveyService();
    const s = svc.create({ title: 'T', questions: [{ type: 'multi_choice', prompt: 'Pick', required: true, options: ['A', 'B', 'C'] }] });
    const q = s.questions[0];
    svc.submit(s.id, { [q.id]: [q.options[0].id, q.options[1].id, q.options[0].id] }); // A,B,A -> dedup A,B
    svc.submit(s.id, { [q.id]: [q.options[1].id] });                                    // B
    const agg = svc.aggregate(s.id);
    expect(agg[q.id].counts?.[q.options[0].id]).toBe(1); // A once (deduped)
    expect(agg[q.id].counts?.[q.options[1].id]).toBe(2); // B twice
    expect(agg[q.id].counts?.[q.options[2].id]).toBe(0); // C never
    expect(() => svc.submit('nope', {})).toThrow(/survey not found/);
    expect(() => svc.aggregate('nope')).toThrow(/survey not found/);
  });

  it('an optional unanswered question is simply omitted (no error, not aggregated)', async () => {
    const { SurveyService } = await load();
    const svc = new SurveyService();
    const s = svc.create({ title: 'T', questions: [{ type: 'text', prompt: 'Optional note', required: false }] });
    const q = s.questions[0];
    svc.submit(s.id, {}); // nothing answered -> ok because optional
    expect(svc.responseCount(s.id)).toBe(1);
    expect(svc.aggregate(s.id)[q.id].count).toBe(0);
  });
});
