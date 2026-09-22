/**
 * 🎓 EXAM MODE — the view's own rules, kept out of the component so they can be tested.
 *
 * Everything here is a pure function of (the paper, what the student chose, whether the answer has
 * been revealed). The component renders; it decides nothing.
 *
 * ## 🔒 Two rules that are accessibility, not styling
 *
 * 1. **Never colour alone.** Every state below carries an ICON and a WORD as well as a tone. A red
 *    tint and a green tint are the same tint to a red-green colour-blind student, which is roughly
 *    one boy in twelve — and this screen's entire job is to tell them which of those two happened.
 * 2. **The right answer is always shown once revealed**, even when the student got it wrong. A cross
 *    on its own says "you failed" and not "this was the answer", so the next attempt is the same
 *    guess. `reveal-correct` exists for exactly that case.
 */

export type ExamOptionTone = 'idle' | 'correct' | 'wrong' | 'reveal' | 'muted';

export interface ExamOptionView {
  tone: ExamOptionTone;
  /** A word, so the state survives without colour. '' for the states that need none. */
  label: string;
  /** Is this option still pressable? */
  pressable: boolean;
}

/**
 * How one option looks right now.
 *
 * `chosen === null` before an answer, and `revealed` is what separates *"I have not answered"* from
 * *"I skipped"* — a skip reveals the paper without any option being chosen.
 */
export function optionView(
  index: number,
  correctIndex: number,
  chosen: number | null,
  revealed: boolean,
): ExamOptionView {
  if (!revealed) return { tone: 'idle', label: '', pressable: true };
  if (index === correctIndex) {
    // The student's own correct answer, or the answer they missed. Both are green and both say so.
    return { tone: chosen === correctIndex ? 'correct' : 'reveal', label: chosen === correctIndex ? 'Correct' : 'Correct answer', pressable: false };
  }
  if (index === chosen) return { tone: 'wrong', label: 'Your answer', pressable: false };
  return { tone: 'muted', label: '', pressable: false };
}

/** What this question did to the score, as the student sees it the instant they answer. */
export type ExamOutcome = 'correct' | 'wrong' | 'skipped';

export function outcomeOf(chosen: number | null, correctIndex: number): ExamOutcome {
  if (chosen === null) return 'skipped';
  return chosen === correctIndex ? 'correct' : 'wrong';
}

/**
 * The floating mark change. **A minus sign, not a hyphen** — this is a number, and on a result screen
 * a hyphen reads as a dash between two figures.
 */
export function deltaLabel(outcome: ExamOutcome): string {
  if (outcome === 'correct') return '+4';
  if (outcome === 'wrong') return '−1';
  return '0';
}

/** The one-line note beside the delta, so the arithmetic is never a mystery. */
export function deltaWhy(outcome: ExamOutcome): string {
  if (outcome === 'correct') return 'Correct — four marks.';
  if (outcome === 'wrong') return 'Wrong — one mark deducted.';
  return 'Skipped — no marks gained, none lost.';
}

/** `Question 3 of 10`. Spelled out rather than `3/10`, which reads as a score. */
export function progressLabel(n: number, total: number): string {
  return `Question ${Math.max(1, n)} of ${Math.max(1, total)}`;
}

export function progressPct(answeredOrRevealed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((answeredOrRevealed / total) * 100)));
}

/**
 * A keypress to an option index, or `null`.
 *
 * 🔑 **1–4 and A–D both work**, because a student who has sat a real paper reaches for the letter and
 * a student on a laptop reaches for the digit. Costs nothing to accept both.
 */
export function keyToOptionIndex(key: string): number | null {
  const k = String(key || '');
  if (k >= '1' && k <= '4') return k.charCodeAt(0) - '1'.charCodeAt(0);
  const lower = k.toLowerCase();
  if (lower >= 'a' && lower <= 'd' && lower.length === 1) return lower.charCodeAt(0) - 'a'.charCodeAt(0);
  return null;
}

/** The option letter shown on the pill. */
export function optionLetter(index: number): string {
  return ['A', 'B', 'C', 'D'][index] ?? String(index + 1);
}

/**
 * The honest note when the paper came back shorter than asked.
 *
 * ⚠️ It is never silent. Renumbering a 10-question request down to 7 without a word changes the
 * denominator of the student's own score — see `parseExamPaper`, which refuses to pad rather than
 * invent the missing questions.
 */
export function shortPaperNote(asked: number, got: number): string {
  if (!Number.isFinite(asked) || !Number.isFinite(got) || got >= asked) return '';
  return `This paper has ${got} questions, not the ${asked} you asked for — the rest did not come back in a usable form, and I would rather be short than make them up. Your score is out of ${got}.`;
}

/**
 * Is the setup complete enough to start?
 *
 * 🔑 **A chosen exam stands in for the subject.** "Set me a NEET paper" is a complete request — the
 * exam already says what to ask about. This mirrors `examSpecIsUsable` on the server, which is the
 * authority; this one exists only so the Start button can be disabled before a round trip. Keep the
 * two in step: a button that enables where the server refuses is a dead button, and a button that
 * refuses where the server would have worked is a feature the student cannot reach.
 */
export function setupReady(subject: string, targetExamLabel = ''): boolean {
  return String(subject || '').trim().length > 0 || String(targetExamLabel || '').trim().length > 0;
}

/** Same shape as the core's `ExamReading`, restated here so the view layer imports no server type. */
export interface ExamReadingView {
  subject: string;
  topic: string;
}

function sameWord(a: string, b: string): boolean {
  const key = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, '');
  return key(a) === key(b);
}

/**
 * 🔤 "I read that as …" — the visible half of the spelling answer (admin 2026-09-22).
 *
 * Admin: *"student spelling mistacks kar sakte hai … user ko paresani na ho (navbharat ai, galat
 * spelling bhi samajh le)."* The understanding happens inside the paper call itself; this is the
 * student being TOLD what was understood, and it is what keeps the correction honest rather than
 * silent.
 *
 * ## 🔒 Two rules
 *
 * 1. **Silent when it agrees.** A note on every paper would be noise on the 95% of papers where the
 *    student spelled it perfectly well, and noise is how a genuinely useful note stops being read.
 *    Comparison ignores case, spacing and punctuation (and works in Devanagari), because "class 10"
 *    and "Class-10" are not a correction anybody needs telling about.
 * 2. **It never claims a correction that was not made.** '' when the generator said nothing, so the
 *    surface shows nothing rather than an "I read that as" echoing the student back at themselves.
 */
export function readingNote(
  typed: { subject: string; topic: string },
  read: ExamReadingView | null | undefined,
): string {
  if (!read || !read.subject) return '';
  const subjectMoved = !sameWord(typed.subject, read.subject);
  const topicMoved = !!String(typed.topic || '').trim() && !sameWord(typed.topic, read.topic);
  if (!subjectMoved && !topicMoved) return '';
  const scope = read.topic ? `${read.subject} — ${read.topic}` : read.subject;
  return `I read that as ${scope}, and set the paper on it.`;
}

/** How each level reads on its chip — the student's words, not the generator's brief. */
export const LEVEL_LABELS: Record<string, string> = {
  low: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  mix: 'Mixed',
};

/** What picking that level actually gets them, under the chip. */
export const LEVEL_HINTS: Record<string, string> = {
  low: 'Direct recall — warm up or build confidence.',
  medium: 'Two-step application — the usual exam standard.',
  hard: 'Multi-step and traps — competitive-exam standard.',
  mix: 'Easy first, then harder — closest to a real paper.',
};
