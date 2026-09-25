/**
 * ⏱ EXAM MODE SETTINGS — the timer and the paper's language (admin 2026-09-25).
 *
 * Admin, verbatim: *"setting option bhi do … user language select kar sakta hai … aur time bhi user
 * select kare. 30 sec/question, 1 min/question or 2 min per question (default timer off). user yeh bhi
 * select kare ki time per question chalega ya total."*
 *
 * Everything here is a PURE function of (the settings, the paper, the clock), so every rule below is
 * testable without a browser. `ExamMode.tsx` owns the ticking; it decides nothing this file decides.
 *
 * ## The two timer shapes, exactly as the admin described them
 *
 * 1. **Whole paper** (the default when a timer is on). The paper gets `questions × pace` in total —
 *    10 questions at 1 min each is a 10:00 clock counting down to 0:00. At 0:00 the paper ENDS and the
 *    result appears; every question not yet answered counts as skipped (0 marks, never −1). Time spent
 *    reading an explanation is exam time, as it would be in a real hall.
 * 2. **Each question.** Every question gets its own `pace`. When it runs out, that question counts as
 *    skipped and the next one appears. Answering early stops that question's clock and the student
 *    moves on whenever they press Next — "00:20 me answer laga kar next question par bhi ja sakta hai".
 *
 * 🔒 **A skip caused by the clock is scored exactly like a skip the student chose: 0.** Never −1. The
 * clock may take the chance to answer away; it may not take marks the student had already earned.
 */
import type { ExamAnswer, ExamQuestion } from '../../server/professionals/examMode';

/** Seconds per question, or `off`. */
export type ExamTimerPace = 'off' | '30' | '60' | '120';
export type ExamTimerScope = 'paper' | 'question';

export interface ExamSettings {
  /** An id from `EXAM_LANGUAGES` (server/professionals/examMode.ts). `auto` is today's behaviour. */
  language: string;
  pace: ExamTimerPace;
  scope: ExamTimerScope;
}

export const DEFAULT_EXAM_SETTINGS: ExamSettings = { language: 'auto', pace: 'off', scope: 'paper' };

export const EXAM_TIMER_PACES: readonly { id: ExamTimerPace; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: '30', label: '30 sec' },
  { id: '60', label: '1 min' },
  { id: '120', label: '2 min' },
];

export const EXAM_TIMER_SCOPES: readonly { id: ExamTimerScope; label: string; hint: string }[] = [
  { id: 'paper', label: 'Whole paper', hint: 'One clock for the full paper.' },
  { id: 'question', label: 'Each question', hint: 'A fresh clock on every question.' },
];

/** Where the settings are remembered between papers, in this browser only. */
export const EXAM_SETTINGS_STORAGE_KEY = 'nbai.examSettings.v1';

/**
 * Clean whatever was stored (or nothing) into valid settings.
 *
 * ⚠️ An unreadable pace falls back to OFF, never to a timer: a corrupted value must not start a clock
 * the student never asked for. The language is kept as a string here and validated by the server,
 * which is the authority on which languages exist.
 */
export function normalizeExamSettings(raw: unknown): ExamSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pace = EXAM_TIMER_PACES.some((p) => p.id === r.pace) ? (r.pace as ExamTimerPace) : 'off';
  const scope: ExamTimerScope = r.scope === 'question' ? 'question' : 'paper';
  const language = typeof r.language === 'string' && /^[a-z]{2,20}$/.test(r.language) ? r.language : 'auto';
  return { language, pace, scope };
}

/** Milliseconds per question, or `null` when the timer is off. */
export function paceMs(pace: ExamTimerPace): number | null {
  if (pace === 'off') return null;
  const s = Number(pace);
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

/** The whole paper's budget: questions × pace. `null` when the timer is off. */
export function paperBudgetMs(pace: ExamTimerPace, questionCount: number): number | null {
  const per = paceMs(pace);
  if (per === null) return null;
  return per * Math.max(1, Math.floor(questionCount) || 1);
}

/** `10:00`, `1:05`, `0:09`. Never negative: an expired clock reads 0:00. Rounds UP, so 0:01 is real. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Time TAKEN (`Answered in 0:12`, `Time taken: 7:42`). Rounds DOWN — the opposite of `formatClock`,
 * which counts down and must never show 0:00 while a second remains. 12.3 seconds taken is 0:12.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * How urgent the clock looks. `critical` in the last 10 seconds; `low` in the last fifth of the
 * budget or the last 30 seconds, whichever is longer — but never more than HALF the budget, so a
 * 30-second question does not open already amber.
 */
export function clockTone(remainingMs: number, budgetMs: number): 'normal' | 'low' | 'critical' {
  if (remainingMs <= 10_000) return 'critical';
  if (remainingMs <= Math.max(budgetMs * 0.2, Math.min(30_000, budgetMs / 2))) return 'low';
  return 'normal';
}

/**
 * When the whole-paper clock runs out: every question with no answer yet is recorded as SKIPPED.
 *
 * Answers already given are kept exactly as they were — including the one on screen if it was
 * answered before the clock hit zero. Returns a new list; the old one is not changed.
 */
export function skipUnanswered(questions: readonly ExamQuestion[], answers: readonly ExamAnswer[]): ExamAnswer[] {
  const given = new Map<number, ExamAnswer>();
  for (const a of answers) if (a && Number.isInteger(a.n)) given.set(a.n, a);
  return questions.map((q) => given.get(q.n) ?? { n: q.n, chosen: null });
}

/** How many questions the clock skipped: those with no answer when the paper ended. */
export function unansweredCount(questions: readonly ExamQuestion[], answers: readonly ExamAnswer[]): number {
  const answered = new Set(answers.filter((a) => a && Number.isInteger(a.n)).map((a) => a.n));
  return questions.filter((q) => !answered.has(q.n)).length;
}

/** The one-line summary shown on the setup screen, so the active settings are never a surprise. */
export function settingsSummary(settings: ExamSettings, languageLabel: string): string {
  const lang = settings.language === 'auto' ? '' : `Language: ${languageLabel}`;
  const pace = EXAM_TIMER_PACES.find((p) => p.id === settings.pace)?.label ?? 'Off';
  const timer = settings.pace === 'off'
    ? 'Timer off'
    : `Timer: ${pace} per question, ${settings.scope === 'paper' ? 'whole paper' : 'each question'}`;
  return [lang, timer].filter(Boolean).join(' · ');
}

/**
 * What the chosen timer will actually do, in words, for THIS paper. Shown under the timer controls,
 * so the student knows the rule before the clock starts rather than discovering it at 0:00.
 */
export function timerExplainer(settings: ExamSettings, questionCount: number): string {
  if (settings.pace === 'off') return 'No clock. Take as long as you need on every question.';
  const per = paceMs(settings.pace)!;
  if (settings.scope === 'paper') {
    const n = Math.max(1, Math.floor(questionCount) || 1);
    return `${n} question${n === 1 ? '' : 's'} × ${formatClock(per)} = ${formatClock(per * n)} for the whole paper. When it reaches 0:00 the paper ends, and any question you have not answered counts as skipped (0 marks).`;
  }
  return `Each question gets ${formatClock(per)}. If it runs out, that question counts as skipped (0 marks) and the next one appears. Answer early and you can move on straight away.`;
}

/** The note on the result screen when the clock ended or skipped anything. '' when it did not. */
export function timeUpNote(scope: ExamTimerScope, paperTimedOut: boolean, skippedByClock: number): string {
  if (scope === 'paper' && paperTimedOut) {
    return skippedByClock > 0
      ? `Time was up. ${skippedByClock} question${skippedByClock === 1 ? '' : 's'} you had not answered ${skippedByClock === 1 ? 'was' : 'were'} counted as skipped.`
      : 'Time was up just as you finished.';
  }
  if (scope === 'question' && skippedByClock > 0) {
    return `${skippedByClock} question${skippedByClock === 1 ? '' : 's'} ran out of time and ${skippedByClock === 1 ? 'was' : 'were'} counted as skipped.`;
  }
  return '';
}

/**
 * What the clock must do at this instant — the ONE decision the component's tick acts on.
 *
 * - `end-paper`: whole-paper clock at or past its deadline.
 * - `skip-question`: each-question clock at or past this question's deadline, and the question is
 *   still unanswered. An answered question's clock has stopped, so it is never skipped.
 * - `none`: nothing to do (no clock, or time left).
 */
export function clockDecision(input: {
  scope: ExamTimerScope;
  perQMs: number | null;
  paperDeadline: number | null;
  shownAt: number;
  answered: boolean;
  now: number;
}): 'none' | 'end-paper' | 'skip-question' {
  if (input.perQMs === null) return 'none';
  if (input.scope === 'paper') {
    return input.paperDeadline !== null && input.now >= input.paperDeadline ? 'end-paper' : 'none';
  }
  if (input.answered) return 'none';
  return input.now >= input.shownAt + input.perQMs ? 'skip-question' : 'none';
}
