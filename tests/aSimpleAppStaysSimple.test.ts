// Autopsy 12c642ed (2026-09-30). "Build a simple daily habit tracker" + four named features. The
// requirement-aware block then asked the builder to INCLUDE categories/tags, filter/sort/search, due
// dates and reminders, and drag-and-drop ordering; the builder called them "the explicit requirements
// from the request block", built nine features, and a ~3 min estimate became 13.7 min.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeRequirementGaps, buildRequirementGuidance, userAskedForSmallScope } from '../src/server/lib/RequirementGapAnalyzer';

const HABIT = "Build a simple daily habit tracker. The user should be able to add new habits (like 'Drink Water' or 'Read'). Each habit should have a checkbox to mark it complete for the day. Include a streak counter next to each habit that goes up every day it is checked. Keep the UI dark-themed with neon green accents.";

describe('who stated the size', () => {
  it('the report\'s own prompt', () => {
    expect(userAskedForSmallScope(HABIT)).toBe(true);
  });
  it.each([
    'make a basic calculator',
    'a minimal todo app with dark mode',
    'build a small quiz game for kids',
    'ek chhota sa notes app banao',
    'a tiny landing page for my bakery',
    'Build an expense tracker. Keep it simple.',
  ])('%s', (p) => expect(userAskedForSmallScope(p)).toBe(true));

  it.each([
    'Build a hospital management app',
    'a simple but complete CRM for my sales team',
    'make it simple to use for elderly patients — a pharmacy inventory system',
    'build an app that makes billing simple',
    'a habit tracker with streaks and reminders',
  ])('NOT: %s', (p) => expect(userAskedForSmallScope(p)).toBe(false));
});

describe('the guidance', () => {
  const gaps = analyzeRequirementGaps(HABIT);
  it('the analysis itself is unchanged — the gaps are still found and reported', () => {
    expect(gaps.likelyMissing.length).toBeGreaterThan(0);
  });
  it('🔴 no domain features are added to a request that stated its own size', () => {
    const g = buildRequirementGuidance(gaps, { userAskedForAnApp: true, userAskedForSmallScope: true });
    expect(g).not.toContain('REQUIREMENT AWARENESS');
  });
  it('an ambiguous domain prompt still gets them, labelled as ours', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps('Build a hospital management app'), { userAskedForAnApp: true, userAskedForSmallScope: false });
    expect(g).toContain('REQUIREMENT AWARENESS');
    expect(g).toContain("These are NavBharatAI's suggestions, not the user's words");
  });
  it('the India half still runs for a small app — it invents no feature', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps('a simple billing app in ₹ with GST'), { userAskedForAnApp: true, userAskedForSmallScope: true });
    expect(g).not.toContain('REQUIREMENT AWARENESS');
    expect(g.length).toBeGreaterThan(0);
  });
});

describe('the route asks it, and says so', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('both injection paths stand down', () => {
    expect(route).toContain('userAskedForSmallScope: smallScope,');
    expect(route).toContain('if (!reqGuidance && askedForAnApp && !answered && !smallScope) {');
  });
  it('the report records why', () => {
    expect(route).toContain("code: 'REQUIREMENT_GAPS_STOOD_DOWN'");
  });
});
