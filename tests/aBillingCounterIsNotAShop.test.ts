/**
 * failedbr #670 (queue Q-3218): "Build a GST billing app for a shop …" read as ECOMMERCE on "shop" and was told it
 * lacked payments, refunds, a cart and checkout. (Before 2026-09-17 the same prompt read as a RESTAURANT on
 * "billing".) A shop's billing counter is its own domain.
 */
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const domain = (p: string) => analyzeRequirementGaps(p).domain;
const P670 = 'Build a GST billing app for a shop: keep a list of items each with a price and a GST slab (0/5/12/18/28%), add items to a bill with quantities, and show the bill with taxable value';

describe('a billing counter is not an online store', () => {
  it('the #670 prompt keeps its domain, and nothing of an online store is called missing', () => {
    const g = analyzeRequirementGaps(P670);
    expect(g.domain).toBe('ecommerce'); // a shop is a shop; billing is a feature word (RequirementGapAnalyzer.test.ts)
    expect(g.likelyMissing.length).toBeGreaterThan(0);
    for (const l of g.likelyMissing) expect(l).not.toMatch(/cart|checkout|refund|catalog|addresses/i);
  });
  it('🔒 an online store still hears every online feature it lacks', () => {
    const g = analyzeRequirementGaps('Build an online clothing store for my shop where customers can browse products');
    expect(g.domain).toBe('ecommerce');
    expect(g.likelyMissing.join(' | ')).toMatch(/payments \+ refunds|cart & checkout/);
  });
});
