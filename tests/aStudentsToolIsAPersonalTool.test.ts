// failedbr #1161 (2026-11-20): "Create a attendance tracker app for engineering students" was given an education platform's
// "likely missing" features — roles, courses, grading, fees — and the build wrote Login.tsx and Courses.tsx.
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const missing = (p: string) => analyzeRequirementGaps(p).likelyMissing.map((m) => (typeof m === 'string' ? m : (m as { label: string }).label));

describe("a students' tool is a personal tool (failedbr #1161)", () => {
  it.each(['Create a attendance tracker app for engineering students .', 'an expense tracker for college students', 'study planner for students'])('no institution features: %s', (p) => {
    expect(missing(p)).toEqual([]);
  });
  it.each(['attendance management for my coaching with teachers and fees', 'school ERP with attendance, fees and teacher login'])('an institution still gets them: %s', (p) => {
    expect(missing(p).length).toBeGreaterThan(0);
  });
});
