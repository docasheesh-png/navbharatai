/**
 * failedbr #1913 (2026-11-08): "Tumhare Man Se Kuchh Khatarnak Sa game banaa do Jise main play store mein upload kar
 * Sakun" was classified ECOMMERCE off the word "store" in "play store", so a game got cart and checkout as "likely
 * missing" features, no game kit, and the fast lane. The app stores are where an app is published, not a shop.
 */
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const REPORT = 'Tumhare Man Se Kuchh Khatarnak Sa game banaa do Jise main play store mein upload kar Sakun';
const domain = (p: string): string => analyzeRequirementGaps(p).domain;

describe('the Play Store and the App Store are not shops', () => {
  it('the report\'s game is a game and gets the kit', () => {
    expect(domain(REPORT)).toBe('game');
    expect(gameKitPlan(REPORT, 'vite-react').length).toBeGreaterThan(0);
  });
  it.each(['Make a quiz app I can put on the App Store', 'ek app banao jo google play pe daal saku', 'Build a notes app for the playstore'])('%s is not ecommerce', (p) => {
    expect(domain(p)).not.toBe('ecommerce');
  });
  it.each(['Build an online store with cart and checkout and publish it on the Play Store', 'Build a grocery store app with cart, payments and delivery tracking'])('a real shop stays ecommerce: %s', (p) => {
    expect(domain(p)).toBe('ecommerce');
  });
});
