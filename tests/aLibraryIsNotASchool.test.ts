/**
 * failedbr #693 (queue Q-3210): a library attendance app ("student login and admin login") read as an education
 * platform on the word "student", and the builder was told it was missing courses, grading and fees.
 */
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const domainOf = (p: string): string => analyzeRequirementGaps(p).domain;
const labels = (p: string): string[] => analyzeRequirementGaps(p).likelyMissing;

describe('a library is not a school', () => {
  const p693 = 'Build app name is Arivu central library yalladakere it was a bilangual app for library attendance management it has student login and admin login page admin can have all permission';
  it('the #693 prompt is a library, and no school feature is called missing', () => {
    expect(domainOf(p693)).toBe('library');
    expect(labels(p693).length).toBeGreaterThan(0);
    for (const l of labels(p693)) expect(l).not.toMatch(/courses|grading|fees/);
  });
  it('🔒 a component / photo library is not a library app, and a school stays education', () => {
    expect(domainOf('Build a React component library with buttons and modals for my design system')).not.toBe('library');
    expect(domainOf('Make a photo library app to organise my pictures')).not.toBe('library');
    expect(domainOf('Build a school management app with teachers, students, fees and exams')).toBe('education');
  });
});
