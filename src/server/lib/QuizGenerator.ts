// Roadmap breadth — quiz / assessment starter (a packaged domain vertical).
//
// An edtech / assessment primitive: multiple-choice quizzes that get GRADED. The real feature is GRADING
// INTEGRITY: a submission is scored against the stored answer key, producing an EXACT score (points earned /
// total) and per-question correctness, and a configurable pass mark decides pass/fail — the correct-answer key
// is NEVER leaked to the taker (the public quiz view strips it; only grading uses it server-side). This emits a
// dependency-free QuizService (no crypto/deps) + an Express router + a README. Real logic, not a stub — the
// grading + pass-mark + answer-key-privacy rules are unit-tested against the emitted code. Pure builder → the
// caller writes the files. Distinct from generate_polls (opinion tally, no right answer) and generate_feedback.

export const QUIZ_SERVICE_SOURCE = `// Quiz / assessment domain logic. The core guarantees: (1) a submission is GRADED against the stored answer key
// into an EXACT score (points earned out of total) plus per-question correctness; (2) a configurable pass mark
// (percent) decides pass/fail; and (3) the correct-answer key is NEVER exposed to the taker — publicView()
// strips 'correct' from every option, and only grade() reads the key (server-side). In-memory here; swap the
// Map for your database, keeping the same method contracts.

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean; // server-only — stripped from the public view
}

export interface QuizQuestion {
  id: string;
  text: string;
  points: number;      // weight of this question (default 1)
  options: QuizOption[];
}

export interface Quiz {
  id: string;
  title: string;
  passMarkPercent: number; // 0..100
  questions: QuizQuestion[];
}

// The public (taker-facing) shapes — no 'correct' flag anywhere.
export interface PublicOption { id: string; text: string }
export interface PublicQuestion { id: string; text: string; points: number; options: PublicOption[] }
export interface PublicQuiz { id: string; title: string; passMarkPercent: number; totalPoints: number; questions: PublicQuestion[] }

export interface GradedQuestion { questionId: string; correct: boolean; awarded: number; possible: number }
export interface GradeResult {
  quizId: string;
  scorePoints: number;   // points earned
  totalPoints: number;   // max possible
  percent: number;       // 0..100, rounded to 1 dp
  passed: boolean;
  perQuestion: GradedQuestion[];
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return prefix + '_' + counter.toString(36);
}

export class QuizService {
  private quizzes = new Map<string, Quiz>();

  /**
   * Create a quiz. Each question needs exactly one correct option (validated). passMarkPercent defaults to 60.
   */
  create(input: {
    title: string;
    passMarkPercent?: number;
    questions: Array<{ text: string; points?: number; options: Array<{ text: string; correct?: boolean }> }>;
  }): Quiz {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('title is required');
    if (!Array.isArray(input?.questions) || input.questions.length === 0) throw new Error('a quiz needs at least one question');
    const passMarkPercent = input.passMarkPercent === undefined ? 60 : Number(input.passMarkPercent);
    if (!Number.isFinite(passMarkPercent) || passMarkPercent < 0 || passMarkPercent > 100) {
      throw new Error('passMarkPercent must be between 0 and 100');
    }
    const questions: QuizQuestion[] = input.questions.map((q) => {
      const text = String(q?.text ?? '').trim();
      if (!text) throw new Error('each question needs text');
      if (!Array.isArray(q?.options) || q.options.length < 2) throw new Error('each question needs at least two options');
      const points = q.points === undefined ? 1 : Number(q.points);
      if (!Number.isFinite(points) || points <= 0) throw new Error('points must be a positive number');
      const options: QuizOption[] = q.options.map((o) => ({
        id: nextId('opt'),
        text: String(o?.text ?? '').trim(),
        correct: Boolean(o?.correct),
      }));
      const correctCount = options.filter((o) => o.correct).length;
      if (correctCount !== 1) throw new Error('each question needs exactly one correct option');
      return { id: nextId('q'), text, points, options };
    });
    const quiz: Quiz = { id: nextId('quiz'), title, passMarkPercent, questions };
    this.quizzes.set(quiz.id, quiz);
    return quiz;
  }

  get(id: string): Quiz | undefined {
    return this.quizzes.get(String(id ?? '').trim());
  }

  totalPoints(quiz: Quiz): number {
    return quiz.questions.reduce((s, q) => s + q.points, 0);
  }

  /** The taker-facing view — the correct-answer key is stripped from every option. */
  publicView(id: string): PublicQuiz | undefined {
    const quiz = this.quizzes.get(String(id ?? '').trim());
    if (!quiz) return undefined;
    return {
      id: quiz.id,
      title: quiz.title,
      passMarkPercent: quiz.passMarkPercent,
      totalPoints: this.totalPoints(quiz),
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.text,
        points: q.points,
        options: q.options.map((o) => ({ id: o.id, text: o.text })), // NO 'correct'
      })),
    };
  }

  /**
   * Grade a submission. answers = { [questionId]: optionId }. Returns the EXACT score, percent, pass/fail and
   * per-question correctness. Unanswered or wrong questions earn 0; only the stored correct option earns points.
   */
  grade(id: string, answers: Record<string, string>): GradeResult {
    const quiz = this.quizzes.get(String(id ?? '').trim());
    if (!quiz) throw new Error('quiz not found');
    const submitted = answers && typeof answers === 'object' ? answers : {};
    let scorePoints = 0;
    const perQuestion: GradedQuestion[] = quiz.questions.map((q) => {
      const chosen = String(submitted[q.id] ?? '');
      const correctOption = q.options.find((o) => o.correct);
      const isCorrect = Boolean(correctOption && chosen === correctOption.id);
      const awarded = isCorrect ? q.points : 0;
      scorePoints += awarded;
      return { questionId: q.id, correct: isCorrect, awarded, possible: q.points };
    });
    const totalPoints = this.totalPoints(quiz);
    const percent = totalPoints === 0 ? 0 : Math.round((scorePoints / totalPoints) * 1000) / 10;
    return { quizId: quiz.id, scorePoints, totalPoints, percent, passed: percent >= quiz.passMarkPercent, perQuestion };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const quizzes = new QuizService();
`;

export const QUIZ_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { quizzes } from './quizService';

// REST endpoints for quizzes. Mount with: app.use('/api/quizzes', quizRouter).
// IMPORTANT: the public GET returns the taker-facing view WITHOUT the answer key; guard the create route with auth.
export const quizRouter = Router();

// Create a quiz. { title, passMarkPercent?, questions:[{text, points?, options:[{text, correct}]}] }. Guard with auth.
quizRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; passMarkPercent?: unknown; questions?: unknown };
  try {
    const quiz = quizzes.create({
      title: String(body.title ?? ''),
      passMarkPercent: body.passMarkPercent === undefined ? undefined : Number(body.passMarkPercent),
      questions: Array.isArray(body.questions) ? (body.questions as Array<{ text: string; points?: number; options: Array<{ text: string; correct?: boolean }> }>) : [],
    });
    // Return the public view so a create response never leaks the answer key back either.
    return res.status(201).json(quizzes.publicView(quiz.id));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Public taker view (NO answer key).
quizRouter.get('/:id', (req: Request, res: Response) => {
  const view = quizzes.publicView(req.params.id);
  if (!view) return res.status(404).json({ error: 'quiz not found' });
  return res.status(200).json(view);
});

// Submit answers and get graded. { answers: { [questionId]: optionId } }.
quizRouter.post('/:id/submit', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { answers?: unknown };
  try {
    const answers = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, string>) : {};
    return res.status(200).json(quizzes.grade(req.params.id, answers));
  } catch (err) {
    return res.status(err instanceof Error && err.message === 'quiz not found' ? 404 : 400)
      .json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});
`;

const QUIZ_README = `# Quiz / assessment

A real multiple-choice quiz/assessment backend. The core guarantees: a submission is **graded** against the
stored answer key into an **exact score** (points earned / total) plus per-question correctness, a configurable
**pass mark** (percent) decides pass/fail, and the **correct-answer key is never exposed to the taker** — the
public view strips it and only server-side grading reads it. Files:

- \`quizService.ts\` — the domain logic (\`QuizService\` + a \`quizzes\` singleton). Dependency-free. In-memory;
  swap the Map for your DB. Each question is validated to have exactly one correct option.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { quizRouter } from './server/quizzes/routes';
app.use('/api/quizzes', quizRouter);
\`\`\`

Endpoints:
- \`POST /api/quizzes\` \`{ title, passMarkPercent?, questions:[{text, points?, options:[{text, correct}]}] }\` → create (**guard with auth**). Returns the taker view (no key).
- \`GET  /api/quizzes/:id\` → the taker-facing quiz **without** the answer key (**404** if unknown).
- \`POST /api/quizzes/:id/submit\` \`{ answers: { [questionId]: optionId } }\` → \`{ scorePoints, totalPoints, percent, passed, perQuestion }\`.

Distinct from \`generate_polls\` (opinion tally, no right answer) and \`generate_feedback\` (feature voting).
`;

export interface QuizConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Quiz / assessment starter wired under server/quizzes/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is GRADING INTEGRITY: create() validates each question has exactly one correct option; ' +
  'grade(id, answers) scores a submission against the stored key into an EXACT score (points earned / total), a ' +
  'percent, pass/fail against a configurable passMarkPercent, and per-question correctness; publicView() returns ' +
  'the taker-facing quiz with the correct-answer key STRIPPED from every option (only grade() reads the key, ' +
  'server-side) so answers never leak. routes.ts exposes POST /api/quizzes (create, guard with auth — returns ' +
  'the keyless view), GET /api/quizzes/:id (taker view, no key) and POST /api/quizzes/:id/submit ({answers}). ' +
  'Mount at app.use("/api/quizzes", quizRouter). Distinct from generate_polls (opinion tally) and ' +
  'generate_feedback. In-memory by default — swap the Map for your DB.';

export function generateQuizIntegration(): QuizConfig {
  return {
    files: {
      'server/quizzes/quizService.ts': QUIZ_SERVICE_SOURCE,
      'server/quizzes/routes.ts': QUIZ_ROUTES_SOURCE,
      'server/quizzes/README.md': QUIZ_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
