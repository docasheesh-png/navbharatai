import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateQuizIntegration, QUIZ_SERVICE_SOURCE } from './QuizGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateQuizIntegration (wiring)', () => {
  it('emits the quiz service, routes and README', () => {
    const out = generateQuizIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/quizzes/quizService.ts');
    expect(paths).toContain('server/quizzes/routes.ts');
    expect(paths).toContain('server/quizzes/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/quizzes/routes.ts']).toContain('export const quizRouter');
    expect(out.files['server/quizzes/routes.ts']).toContain('/submit');
  });
});

// Materialize + execute the emitted domain logic — the grading + pass-mark + answer-key-privacy rules are real
// business rules, verified against the actual emitted code.
describe('emitted QuizService — exact grading + pass mark + answer-key privacy (real logic)', () => {
  const artifact = join(here, `._quiz_emitted_${process.pid}.ts`);
  writeFileSync(artifact, QUIZ_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Quiz { id: string; title: string; passMarkPercent: number; questions: Array<{ id: string; text: string; points: number; options: Array<{ id: string; text: string; correct: boolean }> }> }
  interface PublicQuiz { id: string; title: string; passMarkPercent: number; totalPoints: number; questions: Array<{ id: string; text: string; points: number; options: Array<{ id: string; text: string }> }> }
  interface GradeResult { quizId: string; scorePoints: number; totalPoints: number; percent: number; passed: boolean; perQuestion: Array<{ questionId: string; correct: boolean; awarded: number; possible: number }> }
  interface Service {
    create(input: { title: string; passMarkPercent?: number; questions: Array<{ text: string; points?: number; options: Array<{ text: string; correct?: boolean }> }> }): Quiz;
    get(id: string): Quiz | undefined;
    publicView(id: string): PublicQuiz | undefined;
    grade(id: string, answers: Record<string, string>): GradeResult;
  }
  interface Emitted { QuizService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  function sampleQuiz(svc: Service): Quiz {
    return svc.create({
      title: 'Geography',
      passMarkPercent: 60,
      questions: [
        { text: 'Capital of France?', points: 1, options: [{ text: 'Paris', correct: true }, { text: 'Berlin' }, { text: 'Rome' }] },
        { text: 'Largest ocean?', points: 2, options: [{ text: 'Atlantic' }, { text: 'Pacific', correct: true }] },
      ],
    });
  }

  it('grades a submission to an EXACT score, percent and pass/fail', async () => {
    const { QuizService } = await load();
    const svc = new QuizService();
    const quiz = sampleQuiz(svc);
    const q1 = quiz.questions[0];
    const q2 = quiz.questions[1];
    const correctOpt = (q: typeof q1) => q.options.find((o) => o.correct)!.id;
    // all correct -> 3/3 = 100%
    const perfect = svc.grade(quiz.id, { [q1.id]: correctOpt(q1), [q2.id]: correctOpt(q2) });
    expect(perfect.scorePoints).toBe(3);
    expect(perfect.totalPoints).toBe(3);
    expect(perfect.percent).toBe(100);
    expect(perfect.passed).toBe(true);
    // only q1 right -> 1/3 = 33.3% -> fail (below 60)
    const wrongOpt = q2.options.find((o) => !o.correct)!.id;
    const partial = svc.grade(quiz.id, { [q1.id]: correctOpt(q1), [q2.id]: wrongOpt });
    expect(partial.scorePoints).toBe(1);
    expect(partial.percent).toBe(33.3);
    expect(partial.passed).toBe(false);
    expect(partial.perQuestion.find((p) => p.questionId === q1.id)?.correct).toBe(true);
    expect(partial.perQuestion.find((p) => p.questionId === q2.id)?.correct).toBe(false);
  });

  it('weights questions by points and honours the pass mark exactly at the boundary', async () => {
    const { QuizService } = await load();
    const svc = new QuizService();
    const quiz = sampleQuiz(svc); // q1=1pt, q2=2pt, total 3, pass 60%
    const q1 = quiz.questions[0];
    const q2 = quiz.questions[1];
    // only the 2-point q2 right -> 2/3 = 66.7% -> pass
    const r = svc.grade(quiz.id, { [q2.id]: q2.options.find((o) => o.correct)!.id });
    expect(r.scorePoints).toBe(2);
    expect(r.percent).toBe(66.7);
    expect(r.passed).toBe(true);
    // unanswered -> 0
    const zero = svc.grade(quiz.id, {});
    expect(zero.scorePoints).toBe(0);
    expect(zero.passed).toBe(false);
  });

  it('THE INVARIANT: the public view NEVER exposes the correct-answer key', async () => {
    const { QuizService } = await load();
    const svc = new QuizService();
    const quiz = sampleQuiz(svc);
    const view = svc.publicView(quiz.id)!;
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('correct'); // no 'correct' field anywhere in the taker view
    for (const q of view.questions) {
      for (const o of q.options) {
        expect(o).not.toHaveProperty('correct');
        expect(o).toHaveProperty('id');
        expect(o).toHaveProperty('text');
      }
    }
    expect(view.totalPoints).toBe(3);
  });

  it('validates quiz structure on create', async () => {
    const { QuizService } = await load();
    const svc = new QuizService();
    expect(() => svc.create({ title: '', questions: [] })).toThrow(/title is required/);
    expect(() => svc.create({ title: 'x', questions: [] })).toThrow(/at least one question/);
    expect(() => svc.create({ title: 'x', questions: [{ text: 'q', options: [{ text: 'a' }] }] })).toThrow(/at least two options/);
    // zero correct options
    expect(() => svc.create({ title: 'x', questions: [{ text: 'q', options: [{ text: 'a' }, { text: 'b' }] }] })).toThrow(/exactly one correct/);
    // two correct options
    expect(() => svc.create({ title: 'x', questions: [{ text: 'q', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }] })).toThrow(/exactly one correct/);
    expect(() => svc.create({ title: 'x', passMarkPercent: 150, questions: [{ text: 'q', options: [{ text: 'a', correct: true }, { text: 'b' }] }] })).toThrow(/between 0 and 100/);
    expect(() => svc.grade('nope', {})).toThrow(/quiz not found/);
  });
});
