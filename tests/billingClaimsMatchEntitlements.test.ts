import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TERMS_OF_SERVICE, TERMS_OF_SERVICE_UPDATED } from '../src/content/legal/termsOfService';
import { LEGAL_META } from '../src/content/legal/meta';
import { FREE_PROGRAM_PAUSED_NOTE } from '../src/server/AppContext/freeProgramContext';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('public billing claims describe entitlements without creating them', () => {
  it('does not advertise all chat as free across public marketing and AI guidance', () => {
    for (const path of ['src/content/marketing.ts', 'src/server/lib/marketingPages.ts', 'src/server/AppContext/freeProgramContext.ts']) {
      const text = source(path);
      expect(text, path).not.toMatch(/(?:Chat is offered free|Only Free Chat is free|Free Chat needs none|pricing in rupees: free chat)/i);
      expect(text, path).not.toMatch(/\blimited free\b/i);
    }
  });
  it('explains allowance, paid continuation and conditional credit separately', () => {
    expect(TERMS_OF_SERVICE).toContain('daily usage allowance');
    expect(TERMS_OF_SERVICE).toContain('paid from your wallet at the displayed rate');
    expect(TERMS_OF_SERVICE).toContain('Free welcome credit');
    expect(TERMS_OF_SERVICE).toContain('creating an account alone does not guarantee');
    expect(TERMS_OF_SERVICE).toContain('New wallets start with no credit');
    expect(TERMS_OF_SERVICE).toContain('Promotional credit and daily chat allowances are separate');
    expect(TERMS_OF_SERVICE).toContain('Android app only, when enabled');
    expect(TERMS_OF_SERVICE).toContain('the website gives no gift or referral credit');
  });
  it('does not falsely withdraw chat allowance when promotional awards are paused', () => {
    expect(FREE_PROGRAM_PAUSED_NOTE).toContain('does not remove the separate daily chat allowance');
    expect(FREE_PROGRAM_PAUSED_NOTE).toContain('additional use is charged from the wallet');
    expect(FREE_PROGRAM_PAUSED_NOTE).toContain('Do not promise a free welcome credit');
  });
  it('keeps the displayed terms version aligned', () => {
    expect(LEGAL_META.find(x => x.id === 'legal_terms')?.updated).toBe(TERMS_OF_SERVICE_UPDATED);
  });
  it('removes obsolete allowance and unconditional referral claims from AI knowledge', () => {
    const text = source('src/server/AppContext/AppKnowledgeBase.ts');
    expect(text).not.toContain('daily ceiling of 5 answers for guests and 20');
    expect(text).not.toContain('ON BOTH THE WEBSITE AND THE APP: signing up ₹50');
    expect(text).toContain('quote the live in-app counter');
    expect(text).toContain('A new wallet starts empty');
    expect(text).toContain('The website awards no promotional or referral credit');
  });
});
