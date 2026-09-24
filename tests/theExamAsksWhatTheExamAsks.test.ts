/**
 * 🎓 EXAM MODE — 40 / 30 / 30, and NOT ONE provenance claim (admin 2026-09-24).
 *
 * The admin asked for a paper set from previous-year questions, close variants of them, and new
 * questions with a real chance of appearing — in that exact weighting. I objected first, that we
 * cannot PROVE any one question is a genuine PYQ, and the admin overruled it in one line:
 *
 *   *"hame yeh sabit hi nahi karna hai ki yeh pyq hai, hame bs question dene hai. user khud,
 *    samajh jayega."*
 *
 * That correction is the whole design, and it is what these tests hold:
 *
 * - **COMPOSITION is asked for; PROVENANCE is forbidden.** The prompt tells the generator where to
 *   draw each question from, and then tells it — in the same paragraph — never to write a year, a
 *   paper name or a kind onto any question. A "(UPSC 2019)" printed in the question text is an
 *   unverifiable claim landing on a student's screen through the one field the surface prints
 *   verbatim, which the second absolute rule forbids. A badge we cannot verify is a fake feature;
 *   a better-composed paper is not.
 * - **The three numbers sum to the paper.** Largest-remainder, not `Math.round` per share — which
 *   gives 2/2/2 for a 5-question paper, i.e. a sixth question nobody asked for.
 * - **No exam selected ⇒ no composition rule at all.** "Previous year" has no referent without a
 *   paper it is previous to; demanding 40% of one on a plain "Trigonometry, 10 questions" is asking
 *   the generator to invent the provenance this design refuses to print.
 * - **`off` is a real revert**, byte for byte, not a narrower version of the feature.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  examBlend, examBlendInstruction, examPaperInstruction, examPyqEnabled, normalizeExamSpec,
  EXAM_MAX_QUESTIONS, type ExamSpec,
} from '../src/server/professionals/examMode';

const withExam = (over: Partial<ExamSpec> = {}): ExamSpec =>
  normalizeExamSpec({ subject: '', targetExam: 'upsc_cse', count: 10, ...over });

const noExam = (over: Partial<ExamSpec> = {}): ExamSpec =>
  normalizeExamSpec({ subject: 'Trigonometry', count: 10, ...over });

afterEach(() => { delete process.env.PROFESSIONAL_EXAM_PYQ; });

describe('examBlend — the three numbers always add up to the paper the student asked for', () => {
  it.each([1, 2, 3, 4, 5, 7, 10, 13, 20, 25, EXAM_MAX_QUESTIONS])('%i questions split with nothing lost or invented', (n) => {
    const b = examBlend(n);
    expect(b.past + b.similar + b.fresh).toBe(n);
    expect(b.past).toBeGreaterThanOrEqual(0);
    expect(b.similar).toBeGreaterThanOrEqual(0);
    expect(b.fresh).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(b.past) && Number.isInteger(b.similar) && Number.isInteger(b.fresh)).toBe(true);
  });

  it('the admin’s own numbers, on the sizes a student actually picks', () => {
    expect(examBlend(10)).toEqual({ past: 4, similar: 3, fresh: 3 });
    expect(examBlend(20)).toEqual({ past: 8, similar: 6, fresh: 6 });
    expect(examBlend(30)).toEqual({ past: 12, similar: 9, fresh: 9 });
  });

  it('🔴 a SMALL paper leads with the bucket the admin weighted highest, and is never one question long', () => {
    // `Math.round` per share gives 2/2/2 here — six questions for a five-question paper.
    expect(examBlend(5)).toEqual({ past: 2, similar: 2, fresh: 1 });
    expect(examBlend(3)).toEqual({ past: 1, similar: 1, fresh: 1 });
    expect(examBlend(2)).toEqual({ past: 1, similar: 1, fresh: 0 });
    expect(examBlend(1)).toEqual({ past: 1, similar: 0, fresh: 0 });
  });

  it('a nonsense count is zero, never NaN leaking into a prompt', () => {
    for (const bad of [0, -5, NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(examBlend(bad)).toEqual({ past: 0, similar: 0, fresh: 0 });
    }
    expect(examBlend(10.7)).toEqual({ past: 4, similar: 3, fresh: 3 });
  });
});

describe('🔑 the paragraph asks for the COMPOSITION and forbids the CLAIM', () => {
  it('the three counts are stated as exact numbers the generator must hit', () => {
    const t = examBlendInstruction(withExam({ count: 10 }), true);
    expect(t).toContain('COMPOSITION');
    expect(t).toContain('4 that have genuinely been ASKED IN PAST PAPERS');
    expect(t).toContain('3 CLOSE VARIANTS');
    expect(t).toContain('3 NEW questions');
  });

  it('🔴 NO YEAR, NO PAPER NAME, NO KIND — the admin does not want it proved, only asked', () => {
    const t = examBlendInstruction(withExam(), true);
    expect(t).toContain('Do NOT label any question with a year, a paper name or which of the three kinds it is');
    expect(t).toContain('not in the question, not in the explanation');
    expect(t).toContain('not a provenance claim');
  });

  it('the kinds are mixed through the paper, not served in blocks a student can read off', () => {
    expect(examBlendInstruction(withExam(), true)).toContain('do not put them in blocks');
  });

  it('a bucket that rounds to zero is not asked for in a sentence saying zero', () => {
    const one = examBlendInstruction(withExam({ count: 1 }), true);
    expect(one).toContain('1 that have genuinely been ASKED IN PAST PAPERS');
    expect(one).not.toContain('CLOSE VARIANTS');
    expect(one).not.toContain('NEW questions');
    const two = examBlendInstruction(withExam({ count: 2 }), true);
    expect(two).toContain('1 CLOSE VARIANTS');
    expect(two).not.toContain('NEW questions');
  });

  it('🔴 no exam selected ⇒ nothing at all — "previous year" has no paper to be previous to', () => {
    expect(examBlendInstruction(noExam(), true)).toBe('');
    // …and the prompt for that student is unchanged by this feature existing.
    expect(examPaperInstruction(noExam())).not.toContain('COMPOSITION');
  });

  it('a TYPED exam we know nothing about still gets the composition — the generator is told to draw on what it knows, not on what we do', () => {
    const t = examBlendInstruction(normalizeExamSpec({ subject: '', targetExamOther: 'Zephyr Aptitude Test', count: 10 }), true);
    expect(t).toContain('ASKED IN PAST PAPERS');
  });
});

describe('🔒 the kill switch is a real revert, not a narrower feature', () => {
  it('`off` removes the paragraph entirely', () => {
    expect(examBlendInstruction(withExam(), false)).toBe('');
  });

  it('the env reader is ON unless explicitly `off`, and a malformed value is ON rather than silently disabled', () => {
    delete process.env.PROFESSIONAL_EXAM_PYQ;
    expect(examPyqEnabled()).toBe(true);
    for (const v of ['on', 'true', '', '   ', 'yes', 'OFFF']) {
      process.env.PROFESSIONAL_EXAM_PYQ = v;
      expect(examPyqEnabled(), v).toBe(true);
    }
    for (const v of ['off', 'OFF', '  Off  ']) {
      process.env.PROFESSIONAL_EXAM_PYQ = v;
      expect(examPyqEnabled(), v).toBe(false);
    }
  });

  it('🔴 OFF is BYTE-IDENTICAL to the prompt built before this existed', () => {
    const spec = withExam({ count: 10 });
    process.env.PROFESSIONAL_EXAM_PYQ = 'off';
    const off = examPaperInstruction(spec);
    delete process.env.PROFESSIONAL_EXAM_PYQ;
    const on = examPaperInstruction(spec);
    expect(off).not.toContain('COMPOSITION');
    expect(on).toContain('COMPOSITION');
    // Removing the composition block leaves exactly the old document — no stray blank line, no
    // renumbered rule. If that is not true, the kill switch is not a revert.
    expect(on.replace(examBlendInstruction(spec, true) + '\n\n', '')).toBe(off);
  });
});

describe('the paragraph really reaches the one call that writes the paper', () => {
  it('it sits in the prompt above the SHAPE and the RULES, where the generator reads its brief', () => {
    const p = examPaperInstruction(withExam({ count: 10 }));
    expect(p.indexOf('NUMBER OF QUESTIONS')).toBeLessThan(p.indexOf('COMPOSITION'));
    expect(p.indexOf('COMPOSITION')).toBeLessThan(p.indexOf('SHAPE —'));
    expect(p.indexOf('COMPOSITION')).toBeLessThan(p.indexOf('RULES, all of them required'));
  });

  it('🔒 STILL ONE model call for the whole paper — the questions are composed, not fetched', () => {
    // A "scan the internet for PYQ" reading of the admin's request would add a search call per
    // paper. It does not: the composition is an instruction to the same single call the student
    // already pays for, which is why this costs nothing extra.
    const route = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/professionals.ts'), 'utf8');
    const body = route.slice(route.indexOf("app.post('/api/professional/:id/exam'"));
    expect(body.split('runProfessionalChatWithUsage').length - 1).toBe(1);
    expect(body).not.toContain('liveSearchContext');
  });

  it('🔒 REVERSION GUARD — the prompt builder must actually spread the block in', () => {
    // `tsc` and `vitest` cannot see a computed string that is never used: deleting the spread would
    // leave `blend` assigned and unread, and every behavioural test above would still pass on the
    // pure function alone.
    const src = fs.readFileSync(path.join(process.cwd(), 'src/server/professionals/examMode.ts'), 'utf8');
    expect(src).toContain('examBlendInstruction(spec, examPyqEnabled())');
    expect(src).toContain('...(blend ? [blend, ``] : [])');
  });
});
