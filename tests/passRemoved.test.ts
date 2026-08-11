import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * ADMIN 2026-08-10: "pass system hata do!"
 *
 * WHAT THE PASS ACTUALLY WAS, and why removing it is a correctness fix rather than a product whim:
 * a SECOND billing model running alongside the one the platform adopted. THE ONE-WALLET LAW
 * (2026-08-01) settled it — every AI draws on the same balance and "the price of the thing IS the
 * limit". A flat ₹99/month promise of "unlimited" sits on top of that as a parallel contract the
 * wallet cannot honour, and it asked the customer to reason about two systems to answer one question.
 *
 * AND IT WAS ALREADY LYING. The wallet-empty refusal in BOTH gates ended "…or get the Professional
 * Pass for unlimited access". That branch is LIVE (AI_WALLET_SPEND has been on since 2026-08-08),
 * while the Pass has never been sellable — PROFESSIONAL_PAID_ENABLED defaults off and is not set in
 * Cloud Run. So a real user with an empty balance was pointed at a product that does not exist, at
 * exactly the moment they were trying to give us money. That is the defect this locks shut.
 *
 * These tests are the ENFORCEMENT, not the fix: they read the shipped source so a Pass offer cannot
 * quietly reappear on a user-facing surface the way the old one survived a flag being switched off.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Strip comments before scanning — an explanatory note ABOUT the removal is not an offer. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ');
}

describe('the two LIVE refusals no longer advertise a product we do not sell', () => {
  // These are the exact strings a real user hits today with an empty balance.
  for (const file of ['src/server/professionals/passGate.ts', 'src/server/tools/toolGate.ts']) {
    it(`${file} — the wallet-empty message says add credit, and nothing else`, () => {
      const src = codeOnly(read(file));
      const line = src.split('\n').find((l) => l.includes('Your balance is empty'));
      expect(line, 'the wallet-empty refusal must still exist').toBeTruthy();
      expect(line!).not.toMatch(/pass/i);
      expect(line!).toMatch(/add credit/i);
    });

    it(`${file} — no Pass price or duration is sent to the client any more`, () => {
      const src = codeOnly(read(file));
      // Sending these is how the OFFER got rendered; without them a paywall card cannot be built.
      expect(src).not.toMatch(/passPriceInr:/);
      expect(src).not.toMatch(/passDays:/);
    });
  }
});

describe('no user-facing screen offers the Pass', () => {
  /** Every .tsx under src/components — the surfaces a normal user can actually see. */
  function componentFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) componentFiles(p, out);
      else if (name.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  it('no component sells, opens a checkout for, or names the Professional Pass', () => {
    const offenders: string[] = [];
    for (const file of componentFiles(join(root, 'src/components'))) {
      const src = codeOnly(readFileSync(file, 'utf8'));
      if (/Professional Pass|buyProfessionalPass|Get Pass|professional_pass/i.test(src)) {
        offenders.push(file.replace(root + '/', ''));
      }
    }
    expect(offenders, 'a screen is offering a Pass that cannot be bought').toEqual([]);
  });

  it('the client helper can no longer start a Pass purchase at all', () => {
    const src = read('src/components/professionals/professionalPass.ts');
    // Not just unused — GONE. An exported purchase function is one import away from being live again.
    expect(src).not.toContain('export async function buyProfessionalPass');
    expect(codeOnly(src)).not.toContain("productType: 'professional_pass'");
    // The free-allowance counter is real and stays.
    expect(src).toContain('export async function fetchPassStatus');
  });
});

describe('every AI in the app now answers the cost question honestly', () => {
  const kb = read('src/server/AppContext/AppKnowledgeBase.ts');

  it('the knowledge base no longer describes a ₹99/month subscription', () => {
    expect(codeOnly(kb)).not.toMatch(/Get Pass — ₹99/);
    expect(codeOnly(kb)).not.toMatch(/id: 'professional_pass'/);
  });

  it('but the words users type about cost still reach an entry — silence would be worse', () => {
    /**
     * Deleting the entry outright would have been the easy move and the wrong one: 'pass', 'kitne
     * free', 'unlimited' and '99' are exactly what a user types when they ask what this costs, and an
     * unanswered keyword sends every AI in the app back to guessing — which is how a removed product
     * gets re-invented in a chat reply.
     */
    expect(kb).toContain("id: 'professionals_cost'");
    for (const kw of ['professional pass', 'subscription', 'kitne free', 'unlimited', '99']) {
      expect(kb.toLowerCase()).toContain(kw);
    }
    const at = kb.indexOf("id: 'professionals_cost'");
    const entry = kb.slice(at, at + 3000);
    expect(entry).toMatch(/NO separate subscription/i);
    expect(entry).toMatch(/same.{0,20}balance/i);
  });

  it('no dangling reference to the deleted entry id', () => {
    expect(kb).not.toMatch(/relatedFeatures:[^\]]*'professional_pass'/);
  });
});
