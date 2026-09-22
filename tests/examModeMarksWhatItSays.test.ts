/**
 * 🎓 EXAM MODE — a real objective paper inside Teacher AI (admin 2026-09-22).
 *
 * The brief: subject, topic, level (low / medium / hard / mix), a question count; objective questions
 * with 4 clickable options; **+4** and a green tick for correct, **−1** and a red cross for wrong; an
 * explanation underneath; a Next button; repeat. And: *"mere batane se bhi jyada ux sundar ho"*.
 *
 * ## The four additions this suite exists to protect
 *
 * 1. **SKIP is worth 0, and is a different fact from wrong.** With negative marking, choosing not to
 *    answer is the skill the paper trains — in NEET, JEE and UPSC prelims a guess costs a mark a
 *    blank does not. A test with −1 and no skip teaches the opposite of what it is for.
 * 2. **The right option is revealed on a wrong answer.** A cross alone says "you failed" and not
 *    "this was the answer", so the next attempt is the same guess.
 * 3. **Two numbers, never one.** `marks` answers *"what would this exam have scored?"*; `accuracyPct`
 *    answers *"how good were my answers?"*. Collapsing them is how a student who skipped 29 of 30
 *    sees "100%".
 * 4. **A short paper is said out loud, never padded and never renumbered in silence** — that would
 *    change the denominator of the student's own score.
 *
 * Plus the two accessibility rules: **never colour alone**, and a `mix` paper is a real distribution.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  EXAM_MARK_CORRECT, EXAM_MARK_WRONG, EXAM_MARK_SKIPPED, EXAM_LEVELS, EXAM_MAX_QUESTIONS,
  EXAM_DEFAULT_QUESTIONS, normalizeExamSpec, examSpecIsUsable, levelBrief, examPaperInstruction,
  parseExamPaper, scoreExam, examVerdict, teachMyMistakesPrompt,
  type ExamQuestion, type ExamSpec,
} from '../src/server/professionals/examMode';
import {
  optionView, outcomeOf, deltaLabel, deltaWhy, progressLabel, progressPct, keyToOptionIndex,
  optionLetter, shortPaperNote, setupReady, LEVEL_LABELS, LEVEL_HINTS,
} from '../src/components/professionals/examView';

const EXAM_UI = readFileSync('src/components/professionals/ExamMode.tsx', 'utf8');
const ROUTE = readFileSync('src/server/routes/professionals.ts', 'utf8');
const CHAT = readFileSync('src/components/professionals/ProfessionalChat.tsx', 'utf8');
const CONFIGS = readFileSync('src/components/professionals/professionalConfigs.ts', 'utf8');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const q = (n: number, correctIndex: number, topic = 'Topic A'): ExamQuestion => ({
  n, question: `Q${n}?`, options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], correctIndex,
  explanation: `Because ${n}.`, topic,
});
const SPEC: ExamSpec = { subject: 'Physics', topic: 'Thermodynamics', level: 'mix', count: 3, targetExam: 'other', targetExamOther: '' };

describe('the marks are exactly what the admin set', () => {
  it('+4, −1, 0', () => {
    expect(EXAM_MARK_CORRECT).toBe(4);
    expect(EXAM_MARK_WRONG).toBe(-1);
    expect(EXAM_MARK_SKIPPED).toBe(0);
  });

  it('a correct answer is +4 and a wrong one is −1', () => {
    const qs = [q(1, 0), q(2, 1)];
    expect(scoreExam(qs, [{ n: 1, chosen: 0 }]).marks).toBe(4);
    expect(scoreExam(qs, [{ n: 2, chosen: 0 }]).marks).toBe(-1);
  });

  it('🔴 a SKIP is 0 — and is counted as a skip, not as a wrong answer', () => {
    const s = scoreExam([q(1, 0)], [{ n: 1, chosen: null }]);
    expect(s.marks).toBe(0);
    expect(s.skipped).toBe(1);
    expect(s.wrong).toBe(0);
    expect(s.attempted).toBe(0);
  });

  it('🔴 a question never reached is UNSEEN — a paper abandoned half way is not a paper of blanks', () => {
    const s = scoreExam([q(1, 0), q(2, 0), q(3, 0)], [{ n: 1, chosen: 0 }]);
    expect(s.unseen).toBe(2);
    expect(s.skipped).toBe(0);
    expect(s.marks).toBe(4);
  });

  it('marks can go NEGATIVE, and are reported as they are', () => {
    const qs = [q(1, 0), q(2, 0), q(3, 0)];
    expect(scoreExam(qs, [{ n: 1, chosen: 1 }, { n: 2, chosen: 1 }, { n: 3, chosen: 1 }]).marks).toBe(-3);
  });

  it('the maximum is the whole paper at +4', () => {
    expect(scoreExam([q(1, 0), q(2, 0)], []).maxMarks).toBe(8);
  });
});

describe('🔴 TWO NUMBERS, NEVER ONE', () => {
  it('accuracy is over what was ATTEMPTED, marks over the whole paper', () => {
    // One right, 29 untouched. "100% accuracy" is true of the answers and false of the exam.
    const qs = Array.from({ length: 30 }, (_, i) => q(i + 1, 0));
    const s = scoreExam(qs, [{ n: 1, chosen: 0 }]);
    expect(s.accuracyPct).toBe(100);
    expect(s.marks).toBe(4);
    expect(s.maxMarks).toBe(120);
  });

  it('nothing attempted is 0% rather than a divide by zero', () => {
    const s = scoreExam([q(1, 0)], [{ n: 1, chosen: null }]);
    expect(s.accuracyPct).toBe(0);
    expect(Number.isFinite(s.accuracyPct)).toBe(true);
  });

  it('a paper with nothing attempted gets its OWN sentence, not "0%"', () => {
    const s = scoreExam([q(1, 0), q(2, 0)], [{ n: 1, chosen: null }, { n: 2, chosen: null }]);
    expect(examVerdict(s)).toContain('did not attempt');
    expect(examVerdict(s)).toContain('skipping costs no marks');
  });

  it('the verdict never congratulates a bad paper, nor lectures a good one', () => {
    const qs = Array.from({ length: 10 }, (_, i) => q(i + 1, 0));
    const great = scoreExam(qs, qs.map((x) => ({ n: x.n, chosen: 0 })));
    const poor = scoreExam(qs, qs.map((x) => ({ n: x.n, chosen: 1 })));
    expect(examVerdict(great)).toContain('exam-ready');
    expect(examVerdict(poor)).not.toMatch(/great|well done|excellent/i);
    expect(examVerdict(poor)).toContain('skip what you truly do not know');
  });
});

describe('🔴 THE RIGHT ANSWER IS SHOWN, and never by colour alone', () => {
  it('before answering, every option is idle and pressable', () => {
    for (let i = 0; i < 4; i++) {
      expect(optionView(i, 2, null, false)).toEqual({ tone: 'idle', label: '', pressable: true });
    }
  });

  it('a correct answer is green AND says so', () => {
    const v = optionView(2, 2, 2, true);
    expect(v.tone).toBe('correct');
    expect(v.label).toBe('Correct');
  });

  it('🔴 on a WRONG answer the right option is revealed, labelled "Correct answer"', () => {
    expect(optionView(2, 2, 0, true)).toEqual({ tone: 'reveal', label: 'Correct answer', pressable: false });
    expect(optionView(0, 2, 0, true)).toEqual({ tone: 'wrong', label: 'Your answer', pressable: false });
  });

  it('a SKIP still reveals the answer — the point of skipping is to learn it', () => {
    expect(optionView(2, 2, null, true).tone).toBe('reveal');
  });

  it('nothing is pressable once revealed — a score cannot be edited after the fact', () => {
    for (let i = 0; i < 4; i++) expect(optionView(i, 2, 1, true).pressable).toBe(false);
  });

  it('🔒 the UI renders an ICON and the WORD, not just a tint', () => {
    const src = code(EXAM_UI);
    expect(src).toContain('<Check className="w-4 h-4 text-success');
    expect(src).toContain('<X className="w-4 h-4 text-danger');
    expect(src).toContain('{v.label}');
  });

  it('the delta uses a real minus sign and explains itself', () => {
    expect(deltaLabel('correct')).toBe('+4');
    expect(deltaLabel('wrong')).toBe('−1');
    expect(deltaLabel('wrong')).not.toContain('-');
    expect(deltaLabel('skipped')).toBe('0');
    expect(deltaWhy('skipped')).toContain('none lost');
  });

  it('outcomeOf keeps the three states apart', () => {
    expect(outcomeOf(1, 1)).toBe('correct');
    expect(outcomeOf(0, 1)).toBe('wrong');
    expect(outcomeOf(null, 1)).toBe('skipped');
  });
});

describe('the setup, and what each level actually means', () => {
  it('every level has a student-facing label and a hint', () => {
    for (const l of EXAM_LEVELS) {
      expect(LEVEL_LABELS[l]).toBeTruthy();
      expect(LEVEL_HINTS[l]).toBeTruthy();
    }
  });

  it('🔴 `mix` is a real DISTRIBUTION, not the absence of a level', () => {
    expect(levelBrief('mix')).toMatch(/30%|45%|25%/);
    expect(levelBrief('mix')).toContain('easy-first');
  });

  it('a subject is required; a topic is legitimately blank', () => {
    expect(examSpecIsUsable(normalizeExamSpec({ subject: 'Physics' }))).toBe(true);
    expect(examSpecIsUsable(normalizeExamSpec({ topic: 'Optics' }))).toBe(false);
    expect(normalizeExamSpec({ subject: 'Physics' }).topic).toBe('');
    expect(setupReady('  ')).toBe(false);
  });

  it('🔒 an unreadable count falls back to the DEFAULT, never to the maximum', () => {
    expect(normalizeExamSpec({ subject: 'X', count: 'abc' }).count).toBe(EXAM_DEFAULT_QUESTIONS);
    expect(normalizeExamSpec({ subject: 'X' }).count).toBe(EXAM_DEFAULT_QUESTIONS);
  });

  it('a count outside the range is clamped, not refused', () => {
    expect(normalizeExamSpec({ subject: 'X', count: 400 }).count).toBe(EXAM_MAX_QUESTIONS);
    expect(normalizeExamSpec({ subject: 'X', count: 0 }).count).toBe(1);
  });

  it('an unknown level becomes `mix`, the safe default', () => {
    expect(normalizeExamSpec({ subject: 'X', level: 'impossible' }).level).toBe('mix');
  });

  it('the instruction states every rule the parser then enforces', () => {
    const p = examPaperInstruction(SPEC);
    expect(p).toContain('EXACTLY four options');
    expect(p).toContain('EXACTLY one option is correct');
    expect(p).toContain('exactly 3.');
    expect(p).toContain('Thermodynamics');
    expect(p).toContain('Vary which position is correct');
    expect(p).toContain('language the student has been using');
  });

  it('a blank topic asks for the whole subject rather than inventing one', () => {
    // ⚠️ SUPERSEDED WORDING (2026-09-22): this read 'cover the subject broadly'. Once the scope can
    // come from the chosen EXAM instead of a typed subject, "the subject" is a noun the sentence may
    // not have — so the phrase is now 'cover it broadly'. The behaviour under test is unchanged.
    expect(examPaperInstruction({ ...SPEC, topic: '' })).toContain('cover it broadly');
  });
});

describe('🔒 THE PARSER REFUSES — it never repairs a question into something else', () => {
  const paper = (qs: unknown[]) => JSON.stringify({ questions: qs });
  const good = { question: 'Q?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'Why.', topic: 'T' };

  it('reads a clean paper, numbering from 1', () => {
    const r = parseExamPaper(paper([good, { ...good, question: 'Q2?' }]));
    expect(r.questions.map((x) => x.n)).toEqual([1, 2]);
    expect(r.dropped).toBe(0);
  });

  it('survives a markdown fence and surrounding prose', () => {
    const r = parseExamPaper('Here you go:\n```json\n' + paper([good]) + '\n```\nGood luck!');
    expect(r.questions).toHaveLength(1);
  });

  it('🔴 three options, five options, and a missing explanation are all REFUSED', () => {
    const r = parseExamPaper(paper([
      { ...good, options: ['a', 'b', 'c'] },
      { ...good, options: ['a', 'b', 'c', 'd', 'e'] },
      { ...good, explanation: '' },
      { ...good, correctIndex: 4 },
      { ...good, correctIndex: -1 },
      good,
    ]));
    expect(r.questions).toHaveLength(1);
    expect(r.dropped).toBe(5);
  });

  it('🔴 two identical options are ambiguous even with a valid index — refused', () => {
    const r = parseExamPaper(paper([{ ...good, options: ['a', 'a', 'c', 'd'] }]));
    expect(r.questions).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it('strips an "A)" label the generator printed inside an option', () => {
    const r = parseExamPaper(paper([{ ...good, options: ['A) one', '(b) two', '3. three', 'four'] }]));
    expect(r.questions[0].options).toEqual(['one', 'two', 'three', 'four']);
  });

  it('a duplicate question is dropped, not asked twice', () => {
    const r = parseExamPaper(paper([good, { ...good }]));
    expect(r.questions).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it('honours the cap and counts the overflow', () => {
    const r = parseExamPaper(paper(Array.from({ length: 5 }, (_, i) => ({ ...good, question: `Q${i}?` }))), 3);
    expect(r.questions).toHaveLength(3);
    expect(r.dropped).toBe(2);
  });

  it('never throws on garbage, and never invents a question', () => {
    for (const bad of ['', 'not json', '{}', '{"questions":"x"}', '[]']) {
      const r = parseExamPaper(bad);
      expect(r.questions).toEqual([]);
      expect(() => parseExamPaper(bad)).not.toThrow();
    }
  });

  it('🔴 a SHORT paper is said out loud, never padded or silently renumbered', () => {
    expect(shortPaperNote(10, 7)).toContain('7 questions, not the 10');
    expect(shortPaperNote(10, 7)).toContain('rather be short than make them up');
    expect(shortPaperNote(10, 7)).toContain('out of 7');
    expect(shortPaperNote(10, 10)).toBe('');
    expect(shortPaperNote(10, 12)).toBe('');
  });
});

describe('🔑 THE EXAM ENDS IN TEACHING', () => {
  const qs = [q(1, 0, 'Heat'), q(2, 1, 'Heat'), q(3, 2, 'Optics')];

  it('names the weak topics, worst first, and only where less than half were right', () => {
    const s = scoreExam(qs, [{ n: 1, chosen: 1 }, { n: 2, chosen: 0 }, { n: 3, chosen: 2 }]);
    expect(s.weakTopics).toEqual(['Heat']);
    expect(s.perTopic.find((t) => t.topic === 'Optics')).toEqual({ topic: 'Optics', asked: 1, correct: 1 });
  });

  it('a question with no topic is filed as General rather than dropped', () => {
    const s = scoreExam([{ ...q(1, 0), topic: '' }], [{ n: 1, chosen: 1 }]);
    expect(s.perTopic[0].topic).toBe('General');
  });

  it('the hand-back message names the wrong ones, what was chosen and what was right', () => {
    const m = teachMyMistakesPrompt(qs, [{ n: 1, chosen: 1 }, { n: 2, chosen: 1 }, { n: 3, chosen: null }], SPEC);
    expect(m).toContain('Q1?');
    expect(m).toContain('chose "b1"');
    expect(m).toContain('the answer was "a1"');
    expect(m).toContain('left it blank');
    expect(m).not.toContain('Q2?');          // that one was right
    expect(m).toContain('memory hook');
  });

  it('🔒 a perfect paper hands back NOTHING, so the surface hides the button', () => {
    expect(teachMyMistakesPrompt(qs, qs.map((x) => ({ n: x.n, chosen: x.correctIndex })), SPEC)).toBe('');
  });

  it('a long list of mistakes is capped and says how many more', () => {
    const many = Array.from({ length: 14 }, (_, i) => q(i + 1, 0));
    const m = teachMyMistakesPrompt(many, many.map((x) => ({ n: x.n, chosen: 1 })), SPEC);
    expect(m).toContain('and 4 more');
  });
});

describe('the keyboard, the progress, and the option letters', () => {
  it('1–4 and A–D both answer', () => {
    expect([1, 2, 3, 4].map((n) => keyToOptionIndex(String(n)))).toEqual([0, 1, 2, 3]);
    expect(['a', 'B', 'c', 'D'].map(keyToOptionIndex)).toEqual([0, 1, 2, 3]);
  });

  it('anything else is not an answer', () => {
    for (const k of ['5', '0', 'e', 'Enter', 'ArrowRight', '', 'aa']) expect(keyToOptionIndex(k)).toBeNull();
  });

  it('the option pill is a letter, matching what a real paper prints', () => {
    expect([0, 1, 2, 3].map(optionLetter)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('progress is spelled out, because "3/10" reads as a score', () => {
    expect(progressLabel(3, 10)).toBe('Question 3 of 10');
    expect(progressPct(0, 10)).toBe(0);
    expect(progressPct(5, 10)).toBe(50);
    expect(progressPct(99, 10)).toBe(100);
    expect(progressPct(1, 0)).toBe(0);
  });
});

describe('🔒 THE WIRING — one wallet, one gate, one call for the paper', () => {
  const src = code(ROUTE);

  it('the route exists and reuses the chat spine', () => {
    expect(src).toContain("app.post('/api/professional/:id/exam'");
    expect(src).toContain('buildRateLimiter(), enforceNotBanned()');
    expect(src).toContain('await gateProfessionalTurn(verifiedUserId');
  });

  it('🔴 ONE WALLET — the same charge a chat turn makes, never a second ungoverned path', () => {
    const at = src.indexOf("app.post('/api/professional/:id/exam'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at)).toContain('void chargeForAiTurn(');
    expect(src.slice(at)).toContain("feature: 'professionals'");
  });

  it('🔴 ONE call for the WHOLE paper — not one per question', () => {
    const at = src.indexOf("app.post('/api/professional/:id/exam'");
    const body = src.slice(at);
    expect(body.split('runProfessionalChatWithUsage').length - 1).toBe(1);
    expect(body).toContain('examPaperInstruction(spec)');
  });

  it('an unusable paper is an honest failure, never a fabricated score', () => {
    const body = src.slice(src.indexOf("app.post('/api/professional/:id/exam'"));
    expect(body).toContain('paper.questions.length === 0');
    expect(body).toContain('did not come back in a usable form');
  });

  it('`asked` and `dropped` both travel, so the surface can be honest about a short paper', () => {
    const body = src.slice(src.indexOf("app.post('/api/professional/:id/exam'"));
    expect(body).toContain('asked: spec.count');
    expect(body).toContain('dropped: paper.dropped');
  });

  it('🔒 the chat mounts it as a DECLARED SKILL, never an id check', () => {
    expect(code(CHAT)).toContain('config.skills?.exam');
    expect(code(CHAT)).not.toMatch(/config\.id === 'teacher_ai'/);
    expect(code(CONFIGS)).toContain('skills: { exam: true }');
  });

  it('🔒 the result hands its message back to the CHAT — the exam is not a dead end', () => {
    expect(code(CHAT)).toContain('onAskTeacher={(m) => { setExamOpen(false); void send(m); }}');
    // ⚠️ SUPERSEDED (2026-09-22): the argument is now `teachSpec` — the spec with the subject as the
    // generator UNDERSTOOD it, so a student who typed "trignometry" is not taught "trignometry".
    expect(code(EXAM_UI)).toContain('onAskTeacher(teachMyMistakesPrompt(questions, answers, teachSpec))');
  });

  it('🔒 WHITE-LABEL — no vendor or model name anywhere in the feature', () => {
    for (const src2 of [EXAM_UI, readFileSync('src/server/professionals/examMode.ts', 'utf8'), readFileSync('src/components/professionals/examView.ts', 'utf8')]) {
      expect(src2).not.toMatch(/\b(GLM|Kimi|Moonshot|Anthropic|Claude|Sonnet|Opus|Haiku|Gemini|Vertex|Grok|OpenAI|GPT)\b/);
    }
  });

  it('🔒 the UI paints from TOKENS, never a colour literal', () => {
    expect(EXAM_UI).not.toMatch(/(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/);
    expect(EXAM_UI).not.toMatch(/\btext-white\b/);
  });
});
