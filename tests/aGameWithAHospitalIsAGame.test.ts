/**
 * failedbr #2090 (2026-11-08): "Make a realistic cricket game with … dressing room and hospital gym bus flight" was
 * classified as HEALTHCARE — game and healthcare tied on features (0–0) and headline words (1–1), and array order
 * picked healthcare. The game got EMR, pharmacy and staff roles as "likely missing" features, no game kit, and the
 * fast lane. What is being made outranks what it contains.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { requestSubject } from '../src/server/lib/appScopeAnalyzer';

const prompt = readFileSync(join(__dirname, 'fixtures', 'failedbr2090.cricket.prompt.txt'), 'utf8');
const domain = (p: string): string => analyzeRequirementGaps(p).domain;

describe('a game that names a real place is a game', () => {
  it('the real prompt', () => {
    expect(domain(prompt)).toBe('game');
  });
  it.each([
    ['ek cricket game banao jisme hospital ho', 'game'],
    ['Make a bank robbery game', 'game'],
    ['Build a game store app with cart and payments', 'ecommerce'],
    ['Build a hospital management app with a quiz game for kids', 'healthcare'],
    // BR1985: a game that handles real money is a regulated fintech product, and keeps its KYC guidance.
    ['Make a fantasy cricket game with a wallet and real-money prizes', 'fintech'],
  ])('%s → %s', (p, d) => {
    expect(domain(p)).toBe(d);
  });
  it('requestSubject is still exported from appScopeAnalyzer (moved, not changed)', () => {
    expect(requestSubject(prompt)).toBe('Make a realistic cricket game');
  });
});
