// A DHABA IS A RESTAURANT (admin 2026-10-11, Q-117).
//
// "dhaba ke liye khana order karne ka app" resolved to ecommerce. Both domains scored 1 on features (each has
// an "order" feature), and the tie went to the EARLIER domain in the table — ecommerce, on one shared word —
// while restaurant's own headline matched two of its words. THE CLASS: a feature tie decided by array order
// instead of by what the person said. A tie now goes to the domain whose headline the prompt names with more
// distinct words; only a tie on that too falls back to array order, so nothing without a feature tie moves.
import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const domain = (p: string) => analyzeRequirementGaps(p).domain;

describe('a feature tie goes to the domain the prompt names', () => {
  it('🔒 the two recorded ties resolve to what was asked for', () => {
    expect(domain('dhaba ke liye khana order karne ka app')).toBe('restaurant');
    // An udhaar khata is a credit ledger — fintech's own words, two of them, against one shop word.
    expect(domain('udhaar khata app dukandar ke liye')).toBe('fintech');
  });

  it('the cases that never tied keep their answers', () => {
    expect(domain('a restaurant POS with menu, KOT and GST billing')).toBe('restaurant');
    expect(domain('build an ecommerce store with products, cart, checkout, wishlist and order history')).toBe('ecommerce');
    expect(domain('ek dukaan ka online store with cart and checkout')).toBe('ecommerce');
  });
});
