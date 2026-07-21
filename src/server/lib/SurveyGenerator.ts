// Roadmap breadth — survey starter (a packaged domain vertical).
//
// Multi-question surveys / questionnaires for user research, NPS, feedback drives. The real feature is
// SCHEMA-VALIDATED RESPONSES + EXACT AGGREGATION: a survey has typed questions (single_choice, multi_choice,
// rating, text), a submitted response is VALIDATED against that schema (required questions must be answered,
// choice answers must reference real options, a rating must be 1..5) so garbage is rejected — never stored,
// and aggregate() tallies each question EXACTLY (option counts, rating average, text answers). This emits a
// dependency-free SurveyService (no crypto/deps) + an Express router + a README. Real logic, not a stub — the
// response-validation + aggregation rules are unit-tested against the emitted code. Pure builder → the caller
// writes the files. Distinct from generate_polls (a single fixed-option question) and generate_quiz (graded
// right/wrong answers).

export const SURVEY_SERVICE_SOURCE = `// Survey domain logic. The core guarantees: (1) a survey is a list of typed questions
// (single_choice | multi_choice | rating | text); (2) a submitted response is VALIDATED against the survey
// schema — required questions must be answered, choice answers must reference valid option ids, a rating must
// be 1..5 — so an invalid response is REJECTED, never stored; and (3) aggregate() tallies each question EXACTLY.
// In-memory here; swap the Maps for your database.

export type QuestionType = 'single_choice' | 'multi_choice' | 'rating' | 'text';
export interface Option { id: string; label: string }
export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options: Option[]; // for choice types
}
export interface Survey { id: string; title: string; questions: Question[]; createdAt: string }

// A response answers questions by id. Choice answers are option ids (string for single, string[] for multi),
// rating is a number 1..5, text is a string.
export type AnswerValue = string | string[] | number;
export interface SurveyResponse { id: string; surveyId: string; answers: Record<string, AnswerValue>; submittedAt: string }

let counter = 0;
function nextId(prefix: string, now: Date): string {
  counter += 1;
  return prefix + '_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class SurveyService {
  private surveys = new Map<string, Survey>();
  private responses = new Map<string, SurveyResponse[]>(); // surveyId -> responses

  /** Create a survey from a question spec. Choice questions need >=2 options; rating/text need none. */
  create(input: { title: string; questions: Array<{ type: QuestionType; prompt: string; required?: boolean; options?: string[] }> }, now: Date = new Date()): Survey {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('title is required');
    if (!Array.isArray(input?.questions) || input.questions.length === 0) throw new Error('a survey needs at least one question');
    const questions: Question[] = input.questions.map((q) => {
      const type = q?.type;
      if (!['single_choice', 'multi_choice', 'rating', 'text'].includes(type)) throw new Error('invalid question type');
      const prompt = String(q?.prompt ?? '').trim();
      if (!prompt) throw new Error('each question needs a prompt');
      let options: Option[] = [];
      if (type === 'single_choice' || type === 'multi_choice') {
        const labels = Array.isArray(q?.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
        if (labels.length < 2) throw new Error('a choice question needs at least two options');
        options = labels.map((label) => ({ id: nextId('opt', now), label }));
      }
      return { id: nextId('q', now), type, prompt, required: Boolean(q?.required), options };
    });
    const survey: Survey = { id: nextId('sv', now), title, questions, createdAt: now.toISOString() };
    this.surveys.set(survey.id, survey);
    this.responses.set(survey.id, []);
    return this.get(survey.id) as Survey;
  }

  get(id: string): Survey | undefined {
    const s = this.surveys.get(String(id ?? '').trim());
    if (!s) return undefined;
    return { ...s, questions: s.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })) };
  }

  /** Validate + store a response. Throws (never stores) on a schema violation. Returns the stored response. */
  submit(surveyId: string, answers: Record<string, AnswerValue>, now: Date = new Date()): SurveyResponse {
    const survey = this.surveys.get(String(surveyId ?? '').trim());
    if (!survey) throw new Error('survey not found');
    const provided = answers && typeof answers === 'object' ? answers : {};
    const clean: Record<string, AnswerValue> = {};
    for (const q of survey.questions) {
      const raw = provided[q.id];
      const answered = raw !== undefined && raw !== null && !(typeof raw === 'string' && raw.trim() === '') && !(Array.isArray(raw) && raw.length === 0);
      if (!answered) {
        if (q.required) throw new Error('missing required answer for question ' + q.id);
        continue;
      }
      const validIds = new Set(q.options.map((o) => o.id));
      if (q.type === 'single_choice') {
        const v = String(raw);
        if (!validIds.has(v)) throw new Error('invalid option for question ' + q.id);
        clean[q.id] = v;
      } else if (q.type === 'multi_choice') {
        const arr = Array.isArray(raw) ? raw.map((x) => String(x)) : [String(raw)];
        for (const v of arr) if (!validIds.has(v)) throw new Error('invalid option for question ' + q.id);
        clean[q.id] = [...new Set(arr)]; // dedup
      } else if (q.type === 'rating') {
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error('rating must be 1..5 for question ' + q.id);
        clean[q.id] = n;
      } else { // text
        clean[q.id] = String(raw).trim();
      }
    }
    const response: SurveyResponse = { id: nextId('resp', now), surveyId: survey.id, answers: clean, submittedAt: now.toISOString() };
    (this.responses.get(survey.id) as SurveyResponse[]).push(response);
    return { ...response, answers: { ...response.answers } };
  }

  responseCount(surveyId: string): number {
    return this.responses.get(String(surveyId ?? '').trim())?.length ?? 0;
  }

  /**
   * Aggregate every question's answers EXACTLY. Choice → { optionId: count }; rating → { average, count };
   * text → the list of text answers. Counts reflect only answered responses.
   */
  aggregate(surveyId: string): Record<string, unknown> {
    const survey = this.surveys.get(String(surveyId ?? '').trim());
    if (!survey) throw new Error('survey not found');
    const responses = this.responses.get(survey.id) ?? [];
    const out: Record<string, unknown> = {};
    for (const q of survey.questions) {
      if (q.type === 'single_choice' || q.type === 'multi_choice') {
        const counts: Record<string, number> = {};
        for (const o of q.options) counts[o.id] = 0;
        for (const r of responses) {
          const a = r.answers[q.id];
          if (a === undefined) continue;
          const ids = Array.isArray(a) ? a : [a as string];
          for (const id of ids) if (id in counts) counts[id] += 1;
        }
        out[q.id] = { type: q.type, counts };
      } else if (q.type === 'rating') {
        let sum = 0;
        let count = 0;
        for (const r of responses) {
          const a = r.answers[q.id];
          if (typeof a === 'number') { sum += a; count += 1; }
        }
        out[q.id] = { type: 'rating', count, average: count === 0 ? 0 : Math.round((sum / count) * 100) / 100 };
      } else {
        const texts: string[] = [];
        for (const r of responses) {
          const a = r.answers[q.id];
          if (typeof a === 'string' && a) texts.push(a);
        }
        out[q.id] = { type: 'text', count: texts.length, answers: texts };
      }
    }
    return out;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const surveys = new SurveyService();
`;

export const SURVEY_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { surveys, type AnswerValue, type QuestionType } from './surveyService';

// REST endpoints for surveys. Mount with: app.use('/api/surveys', surveyRouter).
// Creating a survey + reading aggregates are admin; submitting a response is public.
export const surveyRouter = Router();

// Create a survey. { title, questions:[{type, prompt, required?, options?}] }. Admin.
surveyRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; questions?: unknown };
  try {
    const questions = Array.isArray(body.questions) ? (body.questions as Array<{ type: QuestionType; prompt: string; required?: boolean; options?: string[] }>) : [];
    return res.status(201).json(surveys.create({ title: String(body.title ?? ''), questions }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Public survey (to render the form).
surveyRouter.get('/:id', (req: Request, res: Response) => {
  const survey = surveys.get(req.params.id);
  if (!survey) return res.status(404).json({ error: 'survey not found' });
  return res.status(200).json(survey);
});

// Submit a response. { answers: { [questionId]: value } }. 400 on a schema violation.
surveyRouter.post('/:id/responses', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { answers?: unknown };
  try {
    const answers = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, AnswerValue>) : {};
    return res.status(201).json(surveys.submit(req.params.id, answers));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'survey not found' ? 404 : 400).json({ error: message });
  }
});

// Aggregated results. Admin.
surveyRouter.get('/:id/results', (req: Request, res: Response) => {
  try {
    return res.status(200).json({ responseCount: surveys.responseCount(req.params.id), aggregate: surveys.aggregate(req.params.id) });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'survey not found' });
  }
});
`;

const SURVEY_README = `# Surveys

A real multi-question survey / questionnaire backend (user research, NPS, feedback drives). The core guarantees:
a survey has typed questions (\`single_choice\` | \`multi_choice\` | \`rating\` | \`text\`), a submitted response is
**validated** against the schema (required questions must be answered, choice answers must reference real
options, a rating must be 1..5) so garbage is **rejected — never stored**, and \`aggregate()\` tallies each
question **exactly**. Files:

- \`surveyService.ts\` — the domain logic (\`SurveyService\` + a \`surveys\` singleton). Dependency-free. In-memory;
  swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { surveyRouter } from './server/surveys/routes';
app.use('/api/surveys', surveyRouter);
\`\`\`

Endpoints:
- \`POST /api/surveys\` \`{ title, questions:[{type, prompt, required?, options?}] }\` → create (**admin**).
- \`GET  /api/surveys/:id\` → the survey to render the form.
- \`POST /api/surveys/:id/responses\` \`{ answers: { [questionId]: value } }\` → submit (**400** on a schema violation).
- \`GET  /api/surveys/:id/results\` → response count + per-question aggregate (**admin**).

Aggregates: choice → option counts; rating → \`{ average, count }\`; text → the list of answers. Distinct from
\`generate_polls\` (a single fixed-option question) and \`generate_quiz\` (graded right/wrong answers).
`;

export interface SurveyConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Survey starter wired under server/surveys/ (dependency-free domain logic + an Express router). The real ' +
  'guarantee is SCHEMA-VALIDATED RESPONSES + EXACT AGGREGATION: create() builds typed questions ' +
  '(single_choice|multi_choice|rating|text; choice questions need >=2 options); submit() VALIDATES a response ' +
  'against the schema — required questions must be answered, choice answers must reference real option ids, a ' +
  'rating must be 1..5 — and REJECTS (never stores) an invalid response; aggregate() tallies each question ' +
  'EXACTLY (choice → per-option counts, rating → {average, count}, text → the list of answers); ' +
  'responseCount() counts submissions. routes.ts exposes POST /api/surveys (create, admin), GET ' +
  '/api/surveys/:id (render the form), POST /api/surveys/:id/responses (submit, 400 on schema violation) and ' +
  'GET /api/surveys/:id/results (aggregate, admin). Mount at app.use("/api/surveys", surveyRouter). Distinct ' +
  'from generate_polls (a single fixed-option question) and generate_quiz (graded answers). In-memory by ' +
  'default — swap the Maps for your DB.';

export function generateSurveyIntegration(): SurveyConfig {
  return {
    files: {
      'server/surveys/surveyService.ts': SURVEY_SERVICE_SOURCE,
      'server/surveys/routes.ts': SURVEY_ROUTES_SOURCE,
      'server/surveys/README.md': SURVEY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
