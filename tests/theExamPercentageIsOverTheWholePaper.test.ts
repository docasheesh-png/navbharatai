/**
 * THE PERCENTAGE IS OVER THE WHOLE PAPER (admin 2026-09-25, phone screenshot of Teacher AI → Exam
 * mode: 16 / 20 marks, 4 right, 0 wrong, 1 not answered — and the result said "100%").
 *
 * The admin, verbatim: "koi bhi national international results attempted question par % nahi deta!
 * total par deta hai. % = marks / maximum marks × 100 ✅ · % = marks / marks of attempted × 100 ❌.
 * Accuracy alag se dikha sakte ho."
 *
 * The scorer already computed accuracy honestly (over attempted) and the verdict already judged the
 * paper by marks ÷ maximum — but that number was a local inside the verdict, and the ONLY percentage
 * the student ever saw was accuracy. So the fix is structural: `percentage` is a field of the score,
 * computed once, and both the result card and the verdict read it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  scoreExam, examVerdict, examPercentage, formatExamPercentage, type ExamQuestion,
} from '../src/server/professionals/examMode';

const q = (n: number): ExamQuestion => ({
  n, question: `Q${n}?`, options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'x', topic: 'T',
});

describe('the screenshot, exactly', () => {
  // 5 questions × 4 = 20. Four right, question 5 skipped.
  const qs = [1, 2, 3, 4, 5].map(q);
  const s = scoreExam(qs, [
    { n: 1, chosen: 0 }, { n: 2, chosen: 0 }, { n: 3, chosen: 0 }, { n: 4, chosen: 0 }, { n: 5, chosen: null },
  ]);

  it('16 / 20 is 80% — not 100%', () => {
    expect(s.marks).toBe(16);
    expect(s.maxMarks).toBe(20);
    expect(s.percentage).toBe(80);
  });

  it('accuracy is still reported, as its own number', () => {
    expect(s.accuracyPct).toBe(100);
  });

  it('the verdict leads with the real percentage and never calls accuracy "%" on its own', () => {
    const v = examVerdict(s);
    expect(v.startsWith('16 out of 20 marks · 80%.')).toBe(true);
    expect(v).not.toContain('100%');
  });
});

describe('the percentage arithmetic', () => {
  it('two decimals, the way results print it', () => {
    expect(examPercentage(28, 120)).toBe(23.33);
    expect(formatExamPercentage(23.33)).toBe('23.33%');
    expect(formatExamPercentage(23.3)).toBe('23.3%');
    expect(formatExamPercentage(80)).toBe('80%');
  });

  it('negative marking can take it below zero, and it is reported as it is', () => {
    const s = scoreExam([q(1), q(2)], [{ n: 1, chosen: 1 }, { n: 2, chosen: 1 }]);
    expect(s.marks).toBe(-2);
    expect(s.percentage).toBe(-25);
    expect(formatExamPercentage(s.percentage)).toBe('-25%');
  });

  it('a paper with no maximum is 0, never NaN or Infinity', () => {
    expect(examPercentage(0, 0)).toBe(0);
    expect(scoreExam([], []).percentage).toBe(0);
    expect(formatExamPercentage(Number.NaN)).toBe('0%');
  });

  it('one right and 29 untouched is 3.33% — the case that used to read "100%"', () => {
    const qs = Array.from({ length: 30 }, (_, i) => q(i + 1));
    const s = scoreExam(qs, [{ n: 1, chosen: 0 }]);
    expect(s.percentage).toBe(3.33);
    expect(s.accuracyPct).toBe(100);
  });
});

describe('the result screen shows the real percentage, and labels accuracy as accuracy', () => {
  const UI = readFileSync('src/components/professionals/ExamMode.tsx', 'utf8');

  it('the headline percentage is the score\'s percentage', () => {
    expect(UI).toMatch(/data-exam-percentage=""[^>]*>\{formatExamPercentage\(score\.percentage\)\}/);
  });

  it('accuracy appears only under the word "Accuracy"', () => {
    const uses = UI.match(/[^\n]*\{score\.accuracyPct\}%[^\n]*/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/Accuracy/);
    expect(UI).not.toContain('of what you attempted was right');
  });
});
