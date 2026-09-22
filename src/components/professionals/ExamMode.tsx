import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, GraduationCap, ArrowRight, SkipForward, RotateCcw, Sparkles, ListChecks, ChevronLeft } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { auth } from '../../lib/firebase';
import {
  EXAM_COUNT_PRESETS, EXAM_LEVELS, EXAM_MAX_QUESTIONS, EXAM_MIN_QUESTIONS, EXAM_DEFAULT_QUESTIONS,
  EXAM_TARGETS, EXAM_TARGET_OTHER, examTarget, examTargetLabel,
  scoreExam, examVerdict, teachMyMistakesPrompt,
  type ExamAnswer, type ExamLevel, type ExamQuestion, type ExamReading, type ExamSpec,
} from '../../server/professionals/examMode';
import {
  LEVEL_HINTS, LEVEL_LABELS, deltaLabel, deltaWhy, keyToOptionIndex, optionLetter, optionView,
  outcomeOf, progressLabel, progressPct, readingNote, setupReady, shortPaperNote,
} from './examView';

/**
 * 🎓 EXAM MODE — Teacher AI sets a real objective paper (admin 2026-09-22).
 *
 * The admin's brief: subject, topic, level, count → objective questions with 4 clickable options →
 * green tick and +4, red cross and −1 → explanation → Next → repeat. And: make it better than that.
 *
 * ## What is here beyond the brief, and why each one is not decoration
 *
 * - **Skip (0 marks).** With negative marking, deciding NOT to answer is the skill the paper trains.
 * - **The right answer is revealed on a wrong one**, so a cross teaches instead of only scoring.
 * - **Keyboard: A–D or 1–4 to answer, Enter or → for next.** A student doing thirty questions on a
 *   laptop should never have to move their hand to a mouse.
 * - **A result that names the weak TOPICS and hands them back to the teacher in one press** — the
 *   thing that makes this a teacher feature rather than a quiz.
 * - **Two honest numbers, not one**: marks out of the maximum, and accuracy over what was attempted.
 * - **Review every question afterwards**, with the student's own answer beside the right one.
 * - **Which exam you are preparing for** (admin 2026-09-22), because "hard Thermodynamics" is four
 *   different papers for a Class 11 student, a JEE Advanced candidate, a GATE candidate and a UPSC
 *   one. Choosing an exam also offers its real subjects as one tap.
 * - **Wrong spelling is understood, and SAID OUT LOUD** — the paper call itself reads "trignometry"
 *   as Trigonometry (costing nothing extra), and the first question carries "I read that as …" with
 *   one press back to the form if it read wrong.
 *
 * All state lives here and in `examView.ts`; the marking arithmetic is `examMode.ts`, shared with the
 * server that set the paper. Nothing about the score is re-derived in this file.
 */

interface Props {
  professionalId: string;
  /** Hands a message to the chat composer — how "teach me my mistakes" returns to the teacher. */
  onAskTeacher: (message: string) => void;
  onClose: () => void;
}

type Phase = 'setup' | 'loading' | 'running' | 'result' | 'review';

export function ExamMode({ professionalId, onAskTeacher, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<ExamLevel>('mix');
  const [count, setCount] = useState(EXAM_DEFAULT_QUESTIONS);
  const [targetExam, setTargetExam] = useState<string>(EXAM_TARGET_OTHER);
  const [targetExamOther, setTargetExamOther] = useState('');
  const [error, setError] = useState('');

  const [spec, setSpec] = useState<ExamSpec | null>(null);
  const [read, setRead] = useState<ExamReading | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [asked, setAsked] = useState(0);
  const [at, setAt] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<ExamAnswer[]>([]);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  const q = questions[at];
  const score = useMemo(() => scoreExam(questions, answers), [questions, answers]);
  const shortNote = shortPaperNote(asked, questions.length);
  const chosenTarget = examTarget(targetExam);
  const targetLabel = examTargetLabel({ targetExam, targetExamOther });
  const ready = setupReady(subject, targetLabel);
  const note = spec ? readingNote(spec, read) : '';
  // The teacher is told the subject as it was UNDERSTOOD, not as it was mistyped — otherwise the
  // follow-up lesson arrives asking about "trignometry".
  const teachSpec: ExamSpec | null = spec
    ? (read?.subject ? { ...spec, subject: read.subject, topic: read.topic } : spec)
    : null;

  const start = useCallback(async () => {
    if (!ready) { setError('Tell me the subject, or pick the exam you are preparing for.'); return; }
    setError('');
    setPhase('loading');
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      const res = await fetch(`/api/professional/${professionalId}/exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ subject, topic, level, count, targetExam, targetExamOther }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.questions) || data.questions.length === 0) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not set the paper. Please try again.');
        setPhase('setup');
        return;
      }
      setQuestions(data.questions as ExamQuestion[]);
      setSpec((data.spec ?? { subject, topic, level, count, targetExam, targetExamOther }) as ExamSpec);
      setRead((data.read ?? null) as ExamReading | null);
      setAsked(Number(data.asked) || (data.questions as unknown[]).length);
      setAt(0); setChosen(null); setRevealed(false); setAnswers([]);
      setPhase('running');
    } catch {
      setError('Could not reach the teacher. Check your connection and try again.');
      setPhase('setup');
    }
  }, [professionalId, subject, topic, level, count, targetExam, targetExamOther, ready]);

  const answer = useCallback((index: number | null) => {
    if (!q || revealed) return;
    setChosen(index);
    setRevealed(true);
    setAnswers((prev) => [...prev.filter((a) => a.n !== q.n), { n: q.n, chosen: index }]);
  }, [q, revealed]);

  const next = useCallback(() => {
    if (!revealed) return;
    if (at + 1 >= questions.length) { setPhase('result'); return; }
    setAt((i) => i + 1);
    setChosen(null);
    setRevealed(false);
  }, [at, questions.length, revealed]);

  // Keyboard: A–D / 1–4 to answer, Enter or → to move on, S to skip. Only while a question is up.
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!revealed) {
        const idx = keyToOptionIndex(e.key);
        if (idx !== null && q && idx < q.options.length) { e.preventDefault(); answer(idx); return; }
        if (e.key.toLowerCase() === 's') { e.preventDefault(); answer(null); return; }
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, revealed, q, answer, next]);

  // Move the focus to Next the moment an answer is revealed, so Enter works without a click and a
  // screen reader is told the result rather than left on a button that is now inert.
  useEffect(() => { if (revealed) nextRef.current?.focus(); }, [revealed, at]);

  const restart = () => {
    setPhase('setup'); setQuestions([]); setAnswers([]); setAt(0); setChosen(null); setRevealed(false);
    setRead(null);
  };

  return (
    <div className="flex flex-col h-full bg-surface text-body">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-raised hover:bg-raised-hover border border-line flex items-center justify-center" title="Back to chat" aria-label="Back to chat">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <GraduationCap className="w-4 h-4 text-accent-text" />
        <span className="text-sm font-semibold text-ink">Exam mode</span>
        {phase === 'running' && (
          <span className="ml-auto text-[11px] text-muted tabular-nums">
            {score.marks} {score.marks === 1 || score.marks === -1 ? 'mark' : 'marks'}
          </span>
        )}
      </div>

      {phase === 'running' && (
        <div className="px-3 pt-2 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
            <span>{progressLabel(at + 1, questions.length)}</span>
            <span className="tabular-nums">{score.correct} right · {score.wrong} wrong · {score.skipped} skipped</span>
          </div>
          <div className="h-1.5 rounded-full bg-well overflow-hidden" role="progressbar" aria-valuenow={progressPct(at + (revealed ? 1 : 0), questions.length)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-all" style={{ width: `${progressPct(at + (revealed ? 1 : 0), questions.length)}%` }} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {phase === 'setup' && (
          <>
            <p className="text-sm text-body">
              I&apos;ll set you a real objective paper — <strong className="text-ink">+4</strong> for a correct answer,{' '}
              <strong className="text-ink">&minus;1</strong> for a wrong one, and <strong className="text-ink">0</strong> if you skip.
              Every question comes with an explanation.
            </p>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-muted">Preparing for</span>
              <select
                value={targetExam}
                onChange={(e) => setTargetExam(e.target.value)}
                className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-indigo-500/40"
              >
                {EXAM_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <span className="block text-[11px] text-muted mt-1">
                {chosenTarget ? chosenTarget.brief : 'Pick your exam and every question is set at that paper\u2019s own standard.'}
              </span>
            </label>
            {targetExam === EXAM_TARGET_OTHER && (
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  Which exam? <span className="text-faint normal-case tracking-normal">\u2014 optional, only if it is not in the list</span>
                </span>
                <input
                  value={targetExamOther}
                  onChange={(e) => setTargetExamOther(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && ready) void start(); }}
                  placeholder="Your own exam or test\u2026"
                  className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500/40"
                />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                Subject
                {targetLabel && <span className="text-faint normal-case tracking-normal"> \u2014 optional; leave blank for a full {targetLabel} paper</span>}
              </span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ready) void start(); }}
                placeholder="Physics, History, Biology\u2026"
                className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500/40"
                autoFocus
              />
              {/* One tap instead of typing: for the exams with a fixed subject list, this is also what
                  stops the commonest misspelling from ever being typed in the first place. */}
              {chosenTarget?.subjects && chosenTarget.subjects.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {chosenTarget.subjects.map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setSubject(subject === sub ? '' : sub)}
                      aria-pressed={subject === sub}
                      className={`px-2.5 py-1 rounded-full border text-[11px] ${subject === sub ? 'bg-accent text-on-accent border-transparent' : 'bg-card border-line text-body hover:bg-raised'}`}
                    >{sub}</button>
                  ))}
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-muted">Topic <span className="text-faint normal-case tracking-normal">— optional, leave blank for the whole subject</span></span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ready) void start(); }}
                placeholder="Thermodynamics, Mughal Empire…"
                className="mt-1 w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-indigo-500/40"
              />
            </label>
            <div>
              <span className="text-[11px] uppercase tracking-wide text-muted">Level</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {EXAM_LEVELS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLevel(l)}
                    aria-pressed={level === l}
                    className={`text-left px-3 py-2 rounded-xl border text-sm transition-colors ${level === l ? 'bg-accent text-on-accent border-transparent' : 'bg-card border-line text-body hover:bg-raised'}`}
                  >
                    <span className="font-semibold">{LEVEL_LABELS[l]}</span>
                    <span className={`block text-[11px] mt-0.5 ${level === l ? 'text-on-accent/80' : 'text-muted'}`}>{LEVEL_HINTS[l]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wide text-muted">Questions</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {EXAM_COUNT_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCount(c)}
                    aria-pressed={count === c}
                    className={`px-3 py-1.5 rounded-full border text-sm tabular-nums ${count === c ? 'bg-accent text-on-accent border-transparent' : 'bg-card border-line text-body hover:bg-raised'}`}
                  >{c}</button>
                ))}
                <input
                  type="number"
                  min={EXAM_MIN_QUESTIONS}
                  max={EXAM_MAX_QUESTIONS}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) || EXAM_DEFAULT_QUESTIONS)}
                  aria-label="Number of questions"
                  className="w-20 bg-card border border-line rounded-full px-3 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:border-indigo-500/40"
                />
                <span className="text-[11px] text-muted">max {EXAM_MAX_QUESTIONS}</span>
              </div>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              onClick={() => void start()}
              disabled={!ready}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-on-accent text-sm font-bold"
            >Start the paper</button>
          </>
        )}

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-10 text-muted">
            <TirangaLoader className="w-6 h-6 text-accent-text" />
            <p className="text-sm">Setting your paper…</p>
          </div>
        )}

        {phase === 'running' && q && (
          <>
            {at === 0 && note && (
              <div className="text-[12px] text-body bg-well border border-line rounded-xl px-3 py-2 flex items-start gap-2">
                <span className="flex-1">{note}</span>
                <button
                  onClick={restart}
                  className="shrink-0 text-accent-text underline underline-offset-2"
                >Not what I meant</button>
              </div>
            )}
            {at === 0 && shortNote && (
              <p className="text-[12px] text-warn bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">{shortNote}</p>
            )}
            <div className="flex items-start gap-2">
              {q.topic && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-raised border border-line text-muted shrink-0 mt-0.5">{q.topic}</span>}
              {q.level && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-raised border border-line text-muted shrink-0 mt-0.5">{LEVEL_LABELS[q.level]}</span>}
            </div>
            <p className="text-[15px] leading-relaxed text-ink whitespace-pre-wrap">{q.question}</p>
            <div className="space-y-2" role="group" aria-label="Answer options">
              {q.options.map((opt, i) => {
                const v = optionView(i, q.correctIndex, chosen, revealed);
                const tone =
                  v.tone === 'correct' || v.tone === 'reveal' ? 'bg-emerald-500/10 border-emerald-500/40'
                  : v.tone === 'wrong' ? 'bg-red-500/10 border-red-500/40'
                  : v.tone === 'muted' ? 'bg-card border-line opacity-60'
                  : 'bg-card border-line hover:bg-raised';
                return (
                  <button
                    key={i}
                    onClick={() => answer(i)}
                    disabled={!v.pressable}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border flex items-start gap-3 transition-colors ${tone}`}
                  >
                    <span className="shrink-0 w-6 h-6 rounded-lg bg-well border border-line text-[11px] font-bold text-body flex items-center justify-center tabular-nums">{optionLetter(i)}</span>
                    <span className="flex-1 text-sm text-ink">{opt}</span>
                    {(v.tone === 'correct' || v.tone === 'reveal') && <Check className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden />}
                    {v.tone === 'wrong' && <X className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden />}
                    {v.label && <span className={`text-[10px] shrink-0 mt-1 ${v.tone === 'wrong' ? 'text-danger' : 'text-success'}`}>{v.label}</span>}
                  </button>
                );
              })}
            </div>

            {!revealed && (
              <button onClick={() => answer(null)} className="w-full px-3 py-2 rounded-xl bg-raised hover:bg-raised-hover border border-line text-sm text-body flex items-center justify-center gap-2">
                <SkipForward className="w-4 h-4" /> Skip — costs nothing
              </button>
            )}

            {revealed && (
              <>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold tabular-nums ${chosen === null ? 'text-muted' : chosen === q.correctIndex ? 'text-success' : 'text-danger'}`}>
                    {deltaLabel(outcomeOf(chosen, q.correctIndex))}
                  </span>
                  <span className="text-[12px] text-muted">{deltaWhy(outcomeOf(chosen, q.correctIndex))}</span>
                </div>
                <div className="rounded-xl bg-well border border-line px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted mb-1">Explanation</p>
                  <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{q.explanation}</p>
                </div>
                <button
                  ref={nextRef}
                  onClick={next}
                  className="w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-on-accent text-sm font-bold flex items-center justify-center gap-2"
                >
                  {at + 1 >= questions.length ? 'See my result' : 'Next'} <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
            <p className="text-[10px] text-faint text-center">Keyboard: A–D or 1–4 to answer · S to skip · Enter for next</p>
          </>
        )}

        {(phase === 'result' || phase === 'review') && (
          <>
            <div className="rounded-2xl bg-card border border-line p-4 text-center">
              <p className="text-3xl font-bold tabular-nums text-ink">{score.marks}<span className="text-lg text-muted"> / {score.maxMarks}</span></p>
              <p className="text-[11px] uppercase tracking-wide text-muted mt-0.5">Marks</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div><p className="text-lg font-bold tabular-nums text-success">{score.correct}</p><p className="text-[10px] text-muted">Right</p></div>
                <div><p className="text-lg font-bold tabular-nums text-danger">{score.wrong}</p><p className="text-[10px] text-muted">Wrong</p></div>
                <div><p className="text-lg font-bold tabular-nums text-muted">{score.skipped + score.unseen}</p><p className="text-[10px] text-muted">Not answered</p></div>
              </div>
              <p className="text-[12px] text-muted mt-3">
                <strong className="text-body tabular-nums">{score.accuracyPct}%</strong> of what you attempted was right
                {score.attempted < score.total && <> · you attempted {score.attempted} of {score.total}</>}
              </p>
            </div>
            <p className="text-sm text-body leading-relaxed">{examVerdict(score)}</p>

            {score.weakTopics.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-warn mb-1">Revise these first</p>
                <p className="text-sm text-body">{score.weakTopics.join(' · ')}</p>
              </div>
            )}

            {teachSpec && teachMyMistakesPrompt(questions, answers, teachSpec) && (
              <button
                onClick={() => { onAskTeacher(teachMyMistakesPrompt(questions, answers, teachSpec)); onClose(); }}
                className="w-full px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-on-accent text-sm font-bold flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Teach me the ones I got wrong
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={() => setPhase(phase === 'review' ? 'result' : 'review')} className="flex-1 px-3 py-2 rounded-xl bg-raised hover:bg-raised-hover border border-line text-sm text-body flex items-center justify-center gap-2">
                <ListChecks className="w-4 h-4" /> {phase === 'review' ? 'Hide answers' : 'Review answers'}
              </button>
              <button onClick={restart} className="flex-1 px-3 py-2 rounded-xl bg-raised hover:bg-raised-hover border border-line text-sm text-body flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> New paper
              </button>
            </div>

            {phase === 'review' && (
              <div className="space-y-3 pt-1">
                {questions.map((rq) => {
                  const mine = answers.find((a) => a.n === rq.n);
                  const pick = mine ? mine.chosen : null;
                  return (
                    <div key={rq.n} className="rounded-xl bg-card border border-line p-3">
                      <p className="text-[11px] text-muted mb-1">{progressLabel(rq.n, questions.length)}{rq.topic ? ` · ${rq.topic}` : ''}</p>
                      <p className="text-sm text-ink mb-2 whitespace-pre-wrap">{rq.question}</p>
                      <p className="text-[12px] text-success">Correct: {optionLetter(rq.correctIndex)}. {rq.options[rq.correctIndex]}</p>
                      <p className="text-[12px] text-muted">
                        You: {pick === null || pick === undefined
                          ? 'not answered'
                          : `${optionLetter(pick)}. ${rq.options[pick]}${pick === rq.correctIndex ? ' ✓' : ' ✕'}`}
                      </p>
                      <p className="text-[12px] text-body mt-1.5 leading-relaxed whitespace-pre-wrap">{rq.explanation}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
