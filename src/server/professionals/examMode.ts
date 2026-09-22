/**
 * 🎓 EXAM MODE — a real objective test inside Teacher AI (admin 2026-09-22).
 *
 * The admin asked for: subject, topic, level (low / medium / hard / mix) and a question count; then
 * objective questions with 4 clickable options; a green tick and **+4** for a correct answer, a red
 * cross and **−1** for a wrong one; an explanation underneath; a Next button; and the cycle repeating.
 * They also asked for it to be better than they described.
 *
 * ## The four additions that are not decoration, and why each one earns its place
 *
 * 1. **SKIP, worth 0.** With negative marking, *choosing not to answer* is the single most important
 *    skill the exam trains — in NEET, JEE and every UPSC prelim, a guessed wrong answer costs a mark
 *    a skip does not. A test with −1 and no skip button teaches the opposite of what it is for.
 * 2. **The RIGHT option is revealed when you get it wrong.** A red cross alone tells a student they
 *    failed and not what the answer was, so the next attempt is the same guess. This is the whole
 *    difference between a score and a lesson.
 * 3. **A result that names the weak TOPICS, and hands them back to the teacher.** The paper knows
 *    which topic each question came from, so the end of an exam can say *"you lost marks in
 *    Thermodynamics"* and offer one press that asks the teacher to teach exactly those. Without it
 *    this is a quiz toy; with it, it is a teacher.
 * 4. **A blank is not a wrong answer, anywhere in the arithmetic.** `marks`, `accuracy` and the
 *    per-topic breakdown each treat *answered wrongly* and *not answered* as different facts, which
 *    is what makes the numbers match the exam the student is actually preparing for.
 *
 * ## 🔒 What this module refuses to do
 *
 * - **It never invents a question.** A paper that comes back malformed is REPORTED short, never
 *   padded, never silently reduced to a number the user did not ask for — `parseExamPaper` returns
 *   what survived AND how many were dropped, so the surface can say so.
 * - **It never marks on the client's word about correctness.** The client sends which option was
 *   chosen; the marking is arithmetic over the paper this module parsed.
 * - **No vendor name reaches any string here** (the White-Label Law) — every user-facing sentence is
 *   NavBharatAI's own.
 *
 * PURE: no I/O, no clock, no model call, never throws.
 */

/** Marks, exactly as the admin set them. Named so no surface can quietly use a different number. */
export const EXAM_MARK_CORRECT = 4;
export const EXAM_MARK_WRONG = -1;
/** A blank. Zero, and a DIFFERENT fact from a wrong answer everywhere below. */
export const EXAM_MARK_SKIPPED = 0;

/** How hard the paper is. `mix` is a real level, not the absence of one — see `levelBrief`. */
export type ExamLevel = 'low' | 'medium' | 'hard' | 'mix';
export const EXAM_LEVELS: readonly ExamLevel[] = ['low', 'medium', 'hard', 'mix'];

export const EXAM_MIN_QUESTIONS = 1;
/**
 * The ceiling on one paper.
 *
 * ⚠️ It is a COST and QUALITY bound, not a preference. The whole paper is generated in ONE call, so
 * the count decides that call's output size; past roughly this many, a single answer starts running
 * into the output ceiling and the tail of the paper arrives truncated — which this module would then
 * honestly report as dropped questions. Thirty is also longer than any practice set a student
 * finishes in one sitting.
 */
export const EXAM_MAX_QUESTIONS = 30;
export const EXAM_DEFAULT_QUESTIONS = 10;

/** The counts the surface offers as one tap. A student may still type any number in range. */
export const EXAM_COUNT_PRESETS: readonly number[] = [5, 10, 20, 30];

export interface ExamSpec {
  subject: string;
  /** '' is legitimate — a whole-subject paper. Never invented to fill the field. */
  topic: string;
  level: ExamLevel;
  count: number;
}

function text(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Clean a requested spec into one the generator can be held to.
 *
 * ⚠️ An unreadable count falls back to the DEFAULT, never to the maximum: a typo must not spend the
 * largest paper this module allows. A count outside the range is clamped rather than refused, because
 * "40" plainly means "as many as you can" and refusing it teaches nothing.
 */
export function normalizeExamSpec(raw: {
  subject?: unknown; topic?: unknown; level?: unknown; count?: unknown;
} | null | undefined): ExamSpec {
  const r = raw || {};
  const level = EXAM_LEVELS.includes(r.level as ExamLevel) ? (r.level as ExamLevel) : 'mix';
  const asked = Number(r.count);
  const count = Number.isFinite(asked)
    ? Math.min(EXAM_MAX_QUESTIONS, Math.max(EXAM_MIN_QUESTIONS, Math.round(asked)))
    : EXAM_DEFAULT_QUESTIONS;
  return { subject: text(r.subject, 80), topic: text(r.topic, 120), level, count };
}

/** Is there enough here to set a paper at all? A subject is the one thing nothing can substitute. */
export function examSpecIsUsable(spec: ExamSpec): boolean {
  return spec.subject.length > 0;
}

/** How each level reads to the generator. `mix` is a DISTRIBUTION, which is why it is spelled out. */
export function levelBrief(level: ExamLevel): string {
  switch (level) {
    case 'low':
      return 'EASY — direct recall and one-step application. A student who has read the chapter once should get most of these right.';
    case 'medium':
      return 'MEDIUM — understanding and two-step application: the student must connect two ideas or work a short calculation.';
    case 'hard':
      return 'HARD — analysis, multi-step problems, close distinctions and common traps, at competitive-exam standard.';
    case 'mix':
      return 'MIXED — roughly 30% easy, 45% medium and 25% hard, ordered easy-first so the student warms up before the difficult ones.';
  }
}

export interface ExamQuestion {
  /** 1-based, as the student sees it. */
  n: number;
  question: string;
  /** Exactly four. Order is the order shown. */
  options: [string, string, string, string];
  /** 0–3. Exactly one. */
  correctIndex: number;
  /** Why that option is right — and, where it matters, why the tempting one is wrong. */
  explanation: string;
  /** The sub-topic this question tests, so the result can name what to revise. '' when unstated. */
  topic: string;
  /** The generator's own difficulty label, for a mixed paper's own honesty. */
  level?: 'low' | 'medium' | 'hard';
}

/** What a paper came back as. `dropped` is never hidden — see the module header. */
export interface ExamPaper {
  questions: ExamQuestion[];
  /** Malformed entries that were refused. > 0 means the surface must say the paper is short. */
  dropped: number;
}

/**
 * The contract the generator is held to.
 *
 * 🔒 Every rule here exists because its absence produces a specific bad question. They are stated as
 * requirements rather than suggestions because the parser below REFUSES anything that breaks them —
 * a prompt that asks nicely and a parser that insists is the combination that cannot ship a
 * three-option question.
 */
export function examPaperInstruction(spec: ExamSpec): string {
  const scope = spec.topic ? `${spec.subject} — specifically: ${spec.topic}` : `${spec.subject} (cover the subject broadly)`;
  return [
    `Set an objective (multiple-choice) test paper. Return ONLY JSON — no prose before or after, no markdown fence.`,
    ``,
    `SCOPE: ${scope}`,
    `DIFFICULTY: ${levelBrief(spec.level)}`,
    `NUMBER OF QUESTIONS: exactly ${spec.count}.`,
    ``,
    `SHAPE — a JSON object: { "questions": [ { "question": string, "options": [string, string, string, string], "correctIndex": 0-3, "explanation": string, "topic": string, "level": "low" | "medium" | "hard" } ] }`,
    ``,
    `RULES, all of them required:`,
    `1. EXACTLY four options per question. Never three, never five.`,
    `2. EXACTLY one option is correct, and "correctIndex" points at it. Never two defensible answers.`,
    `3. The three wrong options must be PLAUSIBLE — the mistakes a real student actually makes. Never filler, never obviously absurd, never "None of the above" as the answer.`,
    `4. Vary which position is correct across the paper. Do not favour any one index.`,
    `5. "explanation" says why the right option is right AND, when one wrong option is tempting, why that one is wrong. Two to four sentences. This is the part the student learns from.`,
    `6. "topic" is the specific sub-topic tested (e.g. "Thermodynamics — first law"), so the student can be told what to revise.`,
    `7. Each option is a standalone answer, under about 120 characters. Do not number or letter them — the surface does that.`,
    `8. Factually correct, at the stated standard, and answerable without a diagram unless the question text itself contains everything needed.`,
    `9. No duplicate or near-duplicate questions.`,
    `10. Write in the language the student has been using with you.`,
  ].join('\n');
}

/** Pull the JSON object out of a reply that may still be wrapped in a fence or prose. */
function extractJson(raw: string): unknown {
  const s = String(raw ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : s).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function optionText(v: unknown): string {
  // A leading "A)" / "(b)." / "3." is stripped: the surface numbers the options itself, and a label
  // printed inside one reads as a typo next to the real one.
  return text(v, 200).replace(/^\s*[(\[]?[A-Da-d1-4][)\].:-]\s+/, '').trim();
}

/** A question is valid or it is refused — never repaired into something the generator did not say. */
function validQuestion(raw: unknown, n: number): ExamQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const question = text(q.question, 600);
  const explanation = text(q.explanation, 1200);
  const list = Array.isArray(q.options) ? q.options.map(optionText) : [];
  const idx = Number(q.correctIndex);
  if (!question || !explanation) return null;
  if (list.length !== 4 || list.some((o) => !o)) return null;
  // Two identical options make the answer ambiguous even when `correctIndex` is one of them.
  if (new Set(list.map((o) => o.toLowerCase())).size !== 4) return null;
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return null;
  const level = q.level === 'low' || q.level === 'medium' || q.level === 'hard' ? q.level : undefined;
  return {
    n,
    question,
    options: [list[0], list[1], list[2], list[3]],
    correctIndex: idx,
    explanation,
    topic: text(q.topic, 120),
    ...(level ? { level } : {}),
  };
}

/**
 * Read a generated paper. Returns the questions that are genuinely usable, and how many were not.
 *
 * ⚠️ **A short paper is reported, never padded.** Silently handing back 7 questions for a request of
 * 10 makes the score's denominator a number the student did not choose; inventing the missing 3 would
 * be worse still. `dropped` is the count the surface says out loud.
 */
export function parseExamPaper(raw: string, cap = EXAM_MAX_QUESTIONS): ExamPaper {
  const parsed = extractJson(raw);
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
    ? (parsed as { questions: unknown[] }).questions
    : [];
  const out: ExamQuestion[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= Math.max(1, cap)) { dropped += 1; continue; }
    const q = validQuestion(item, out.length + 1);
    if (!q) { dropped += 1; continue; }
    const key = q.question.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, '');
    if (key && seen.has(key)) { dropped += 1; continue; }
    if (key) seen.add(key);
    out.push(q);
  }
  return { questions: out, dropped };
}

/**
 * One answer as the student gave it.
 *
 * `chosen: null` IS the skip, and it is a value rather than an absent key so a paper can distinguish
 * *"not reached"* (no entry at all) from *"deliberately left blank"*.
 */
export interface ExamAnswer {
  n: number;
  chosen: number | null;
}

export interface ExamTopicScore {
  topic: string;
  asked: number;
  correct: number;
}

export interface ExamScore {
  total: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Not reached at all — a paper abandoned half way is not a paper of wrong answers. */
  unseen: number;
  marks: number;
  maxMarks: number;
  /** Of the questions ATTEMPTED. A paper of one right answer and 29 skips is not 100% — see below. */
  accuracyPct: number;
  perTopic: ExamTopicScore[];
  /** Topics where the student got less than half right. Ordered worst first. */
  weakTopics: string[];
}

/**
 * The scoreboard. Arithmetic over the paper, never over anything the client asserted.
 *
 * 🔒 **`accuracyPct` is over ATTEMPTED, and `marks` is over the whole paper.** Those are two honest
 * numbers that answer two different questions ("how good were my answers?" and "what would this exam
 * have scored?"), and collapsing them into one is how a student who skipped 29 of 30 sees "100%".
 * The surface shows both, and the result screen says which is which.
 */
export function scoreExam(
  questions: readonly ExamQuestion[],
  answers: readonly ExamAnswer[],
): ExamScore {
  const byN = new Map<number, ExamAnswer>();
  for (const a of answers || []) {
    if (a && Number.isInteger(a.n)) byN.set(a.n, a);
  }
  const topics = new Map<string, ExamTopicScore>();
  let correct = 0, wrong = 0, skipped = 0, unseen = 0, marks = 0;
  for (const q of questions) {
    const a = byN.get(q.n);
    const isCorrect = !!a && a.chosen === q.correctIndex;
    if (!a) unseen += 1;
    else if (a.chosen === null) { skipped += 1; marks += EXAM_MARK_SKIPPED; }
    else if (isCorrect) { correct += 1; marks += EXAM_MARK_CORRECT; }
    else { wrong += 1; marks += EXAM_MARK_WRONG; }
    const name = q.topic || 'General';
    const row = topics.get(name) ?? { topic: name, asked: 0, correct: 0 };
    row.asked += 1;
    if (isCorrect) row.correct += 1;
    topics.set(name, row);
  }
  const attempted = correct + wrong;
  const perTopic = [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic));
  return {
    total: questions.length,
    attempted,
    correct,
    wrong,
    skipped,
    unseen,
    marks,
    maxMarks: questions.length * EXAM_MARK_CORRECT,
    accuracyPct: attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
    perTopic,
    weakTopics: perTopic
      .filter((t) => t.asked > 0 && t.correct * 2 < t.asked)
      .sort((a, b) => (a.correct / a.asked) - (b.correct / b.asked))
      .map((t) => t.topic),
  };
}

/**
 * The honest closing line. Encouraging without lying about the number — a student who scored 20% is
 * not told "great work", and a student who scored 90% is not given a lecture.
 *
 * ⚠️ It reads MARKS against the maximum, not accuracy, because that is the number an exam gives you.
 * A paper with nothing attempted gets its own sentence rather than "0%" — those are different days.
 */
export function examVerdict(score: ExamScore): string {
  if (score.total === 0) return 'No questions were set, so there is nothing to score.';
  if (score.attempted === 0) {
    return `You did not attempt any of the ${score.total}. Nothing is lost — skipping costs no marks. Try a few at an easier level to get started.`;
  }
  const pct = Math.round((score.marks / Math.max(1, score.maxMarks)) * 100);
  const head = `${score.marks} out of ${score.maxMarks} marks · ${score.accuracyPct}% of what you attempted was right.`;
  if (pct >= 85) return `${head} This is exam-ready. Keep the pace and move to a harder level.`;
  if (pct >= 65) return `${head} A solid paper. The marks you lost are worth one careful revision, not a re-read of everything.`;
  if (pct >= 40) return `${head} The base is there and the gaps are specific — work through the explanations below before the next paper.`;
  if (pct >= 0) return `${head} This topic needs teaching before testing. Ask me to explain the ones you got wrong and then take it again.`;
  return `${head} Negative marks mean the guesses cost more than they earned — on the next paper, skip what you truly do not know. Then let me teach these.`;
}

/**
 * The message the result screen hands back to the chat, so the exam ENDS IN TEACHING.
 *
 * 🔑 This is the feature's point: a score tells a student where they are and changes nothing. Naming
 * the exact questions they lost marks on turns the paper into the lesson plan. Returns '' when there
 * is nothing to teach, so the surface can hide the button rather than offer an empty one.
 */
export function teachMyMistakesPrompt(
  questions: readonly ExamQuestion[],
  answers: readonly ExamAnswer[],
  spec: ExamSpec,
): string {
  const byN = new Map<number, ExamAnswer>();
  for (const a of answers || []) if (a && Number.isInteger(a.n)) byN.set(a.n, a);
  const missed = questions.filter((q) => {
    const a = byN.get(q.n);
    return !a || a.chosen === null || a.chosen !== q.correctIndex;
  });
  if (missed.length === 0) return '';
  const lines = missed.slice(0, 10).map((q) => {
    const a = byN.get(q.n);
    const mine = !a || a.chosen === null ? 'left it blank' : `chose "${q.options[a.chosen as number]}"`;
    return `${q.n}. ${q.question} — I ${mine}; the answer was "${q.options[q.correctIndex]}"${q.topic ? ` (${q.topic})` : ''}`;
  });
  const scope = spec.topic ? `${spec.subject} (${spec.topic})` : spec.subject;
  return [
    `I just took an exam-mode test on ${scope} and got these wrong or left them blank:`,
    '',
    ...lines,
    missed.length > 10 ? `…and ${missed.length - 10} more.` : '',
    '',
    'Teach me these properly — the concept behind each one, why the option I picked is wrong, and a memory hook so I do not make the same mistake again.',
  ].filter((l) => l !== '').join('\n');
}
