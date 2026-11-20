/**
 * Q-2752 (sibling of Q-2730, autopsy 05eb30ba): "placement" matched inside "displacement" and picked a domain.
 * A census of every unbounded Latin stem in RequirementGapAnalyzer's DOMAIN patterns against a 275k-word English
 * list (scratch run, word-list@2, MIT) found nine more that sit inside common unrelated words. Each is guarded
 * against exactly that word, so real compounds of the same meaning still match.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const domainOf = (prompt: string) => analyzeRequirementGaps(prompt).domain;

// [trap sentence, the domain it must NOT be filed under]
const TRAPS: Array<[string, string]> = [
  ['build a parental controls app so kids get screen time limits', 'booking'],
  ['make a photo editor that can preserve the original image quality', 'booking'],
  ['a notes app focused on preservation of handwritten pages', 'booking'],
  ['a quiz game for impatient players with ten second rounds', 'healthcare'],
  ['a mood diary that tracks disappointment and joy each day', 'healthcare'],
  ['a paint app with colour blending and layers', 'fintech'],
  ['a horror story game with disconcerting sounds', 'events'],
  ['a history quiz about a lieutenant in the army', 'saas'],
  ['a flashcard tool for relearning forgotten words', 'education'],
];

// [genuine sentence, the domain it must still reach]
const GENUINE: Array<[string, string]> = [
  ['a hospital app for outpatient appointments and doctor schedules', 'healthcare'],
  ['a car rental and hotel reservation app', 'booking'],
  ['a peer to peer lending app with loan tracking', 'fintech'],
  ['a concert and festival ticketing app', 'events'],
  ['a multi tenant saas dashboard with subscriptions', 'saas'],
];

describe('a word inside an unrelated word does not choose the app\'s domain', () => {
  it.each(TRAPS)('"%s" is not filed under %s', (prompt, wrong) => {
    expect(domainOf(prompt)).not.toBe(wrong);
  });
  it.each(GENUINE)('"%s" still reads as %s', (prompt, right) => {
    expect(domainOf(prompt)).toBe(right);
  });
});
