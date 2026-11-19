import { describe, it, expect } from 'vitest';
import { legalDocById } from '../src/content/legal';
import { PRO_DEVELOPMENT_NOTICE } from '../src/content/legal/proDevelopmentNotice';
import { TERMS_OF_SERVICE } from '../src/content/legal/termsOfService';
import { REFUND_POLICY } from '../src/content/legal/refundPolicy';

// Both the website route and native LegalDocPage consume this same registry.
describe('owner-approved development disclosure preserves existing protections', () => {
  it.each(['legal_terms', 'legal_refund'])('%s carries the same bilingual disclosure', (id) => {
    const body = legalDocById(id)!.body;
    expect(body).toContain(PRO_DEVELOPMENT_NOTICE);
    for (const phrase of ['NavBharatAI Pro is in development', 'error-free',
      'does not automatically entitle you to a refund', 'duplicate charges',
      'technical issues will be reviewed', 'payment platform refund rights remain unaffected',
      'All non-refundable-payment statements', 'token credit does not replace that entitlement', 'दोहरे शुल्क', 'कानूनी अधिकार',
      'प्लेटफ़ॉर्म की खराबी', '18 November 2026']) expect(body).toContain(phrase);
  });
  it('retains concrete existing remedies and store process, not just a disclaimer', () => {
    expect(REFUND_POLICY).toContain('There is no time limit');
    expect(REFUND_POLICY).toContain('Where usage cannot be measured, nothing is charged');
    expect(REFUND_POLICY).toContain("the store's decision governs");
    expect(REFUND_POLICY).toContain('within **2 working days**');
    expect(REFUND_POLICY).toContain('within **5 working days**');
    expect(TERMS_OF_SERVICE).toContain('a **failed build is never charged**');
  });
  it('preserves stronger existing advance notice and no retroactive credit changes', () => {
    expect(TERMS_OF_SERVICE).toContain('Material changes are announced in-app before taking effect');
    expect(TERMS_OF_SERVICE).toContain('Changes do not remove rights relating to prior payments');
    expect(REFUND_POLICY).toContain('never retroactively to credit you already hold');
    expect(REFUND_POLICY).toContain('no earlier than its stated effective date');
    expect(REFUND_POLICY).toContain('not a retroactive effective date');
    for (const doc of [TERMS_OF_SERVICE, REFUND_POLICY]) {
      expect(doc).toContain('Each change will state its effective date');
      expect(doc).toContain('पहले');
      expect(doc).toContain('पिछली तारीख');
    }
  });
});
