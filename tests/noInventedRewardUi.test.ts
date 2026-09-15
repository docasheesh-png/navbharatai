import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * 🔴 WHAT WAS LIVE, AND WHY IT IS THE SECOND ABSOLUTE RULE'S EXACT SHAPE (found 2026-09-15 while
 * planning the real referral system, and removed the same day).
 *
 * The Billing panel carried a complete referral feature. It had a code, a share button, a reward
 * promise and an earnings table. None of it existed:
 *
 *   • TWO different codes for one person. The balance card printed `NB-<random>` minted by
 *     `Math.random()` into localStorage; the Promo tab printed `NAV-<mailbox>-REF` computed inline
 *     from the email. Neither was ever sent to a server, and no route could resolve either.
 *   • A PROMISE OF MONEY: "Earn 10% Free Tokens for every referral — when your referred user
 *     purchases tokens, 10% gets added to your account for free!" There was no attribution, no
 *     credit path, no endpoint. Nobody could ever have earned ₹1.
 *   • INVENTED EARNINGS, hardcoded: amit_sharma2026@gmail.com ₹50 "CLAIMED" and
 *     priya.rastogi@navbharat.ai ₹25 "ACTIVE" — so EVERY user was shown the same two strangers as
 *     their own referral income, seeded into localStorage on first render.
 *   • A coupon box whose placeholder read "e.g. WELCOME100, NAVBHARAT50". Both codes were DELETED
 *     in the 2026-09-10 revenue audit, so it advertised two guaranteed failures.
 *
 * "There are only two valid states: (a) fully working, or (b) not built yet." This was neither: it
 * was built, visible, and inert — and it made a financial promise while inert.
 *
 * 🔒 WHY A TEST RATHER THAN JUST THE DELETION. The real referral system is being built now, and it
 * is the same surface: a code, a share button, ₹ amounts, a list of referred friends. The dangerous
 * moment is not today — it is the half-finished commit where the SCREEN lands before the server
 * does, which is exactly how the deleted version came to exist. So this suite does not forbid the
 * word "referral". It forbids the four things that make a reward surface FAKE:
 *
 *   1. a reward code invented in the browser
 *   2. reward state seeded from a literal instead of read from the server
 *   3. a named earning promise with no server behind it
 *   4. example codes the server is known to refuse
 *
 * A real referral screen reads a server-minted code and a server-held list, so it passes all four
 * by construction. A decorative one cannot.
 */

const root = resolve(__dirname, '..');

/**
 * Strip block and line comments. Deliberately a LOCAL copy of the same six lines
 * uiLanguageEnglishOnly.test.ts uses rather than an import: importing from a test file would
 * register that file's suite here as well, running it twice in every CI run.
 *
 * Comments are stripped because this very file quotes the deleted fake data by name as evidence —
 * without the strip, the guard would fail on its own explanation of what it guards against.
 */
function codeWithoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

function walkClient(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const rel = relative(root, p).split('\\').join('/');
    if (rel.startsWith('src/server')) continue;
    if (statSync(p).isDirectory()) walkClient(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\./.test(p)) out.push(rel);
  }
  return out;
}

/** The people who never existed, and the storage keys their earnings were seeded into. */
const INVENTED = [
  'amit_sharma2026',
  'priya.rastogi',
  'navbharat_my_referral',
  'navbharat_referral_history',
];

/**
 * Codes the live coupon table cannot honour. `PROMO_COUPONS` is unset in production, so EVERY code
 * is refused today — but these four are the ones the 2026-09-10 audit deleted by name for being
 * guessable, so printing one as an example is advertising a known failure rather than an unknown one.
 */
const DEAD_COUPON_CODES = ['WELCOME100', 'NAVBHARAT50', 'FREE100', 'FESTIVE2026'];

describe('🔒 no invented reward UI (the fake referral feature, removed 2026-09-15)', () => {
  const files = walkClient(resolve(root, 'src'));
  const sources = files.map((f) => ({ f, src: codeWithoutComments(readFileSync(resolve(root, f), 'utf8')) }));

  it('scans a real number of client files — a scanner that finds nothing proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('src/components/panels/BillingPanel.tsx');
    expect(files).toContain('src/hooks/usePaymentEngine.ts');
  });

  it('no invented person, earning or seeded reward store survives anywhere in the client', () => {
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      for (const needle of INVENTED) {
        if (src.includes(needle)) offenders.push(`${f} → ${needle}`);
      }
    }
    expect(
      offenders.join('\n  '),
      'A reward surface is showing data nobody earned. Referral state must come from the server, never from a literal or localStorage seed.',
    ).toBe('');
  });

  it('no reward or referral code is minted in the browser', () => {
    /**
     * The deleted code was `const code = 'NB-' + Math.random().toString(36).slice(2, 8)...` inside a
     * `const [myReferralCode] = useState(...)`. A code the server never issued cannot be redeemed by
     * anyone, so minting one client-side IS the defect — not a detail of how it was minted.
     *
     * ⚠️ THIS ASSERTION WAS WRONG ON ITS FIRST WRITING, and the mistake is worth keeping in view: it
     * required `Math.random` and the word "referral" on the SAME LINE. In the real code they were
     * five lines apart, so the guard passed against the exact bug it was written for. It only came
     * out because the guard was tested by re-injecting the deleted code rather than by reading it.
     * Hence a WINDOW: a random call is judged by its neighbourhood, which is where its meaning is.
     */
    const WINDOW = 6;
    const MEANS_A_CODE = /referr?al|invite[ _-]?code|reward[ _-]?code|promo[ _-]?code/i;
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      const lines = src.split('\n');
      for (const [i, line] of lines.entries()) {
        if (!/Math\.random/.test(line)) continue;
        const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join('\n');
        if (MEANS_A_CODE.test(near)) offenders.push(`${f}:${i + 1} → ${line.trim().slice(0, 140)}`);
      }
    }
    expect(
      offenders.join('\n  '),
      'A referral/invite/reward code looks like it is generated in the browser. Codes must be minted and stored by the server, or nobody can ever redeem one.',
    ).toBe('');
  });

  it('no earning promise is made on a screen with no server behind it', () => {
    // The exact promise that shipped. Phrased as the PATTERN (a percentage, then "free tokens"/
    // "for every referral") so a reworded version of the same unbacked claim is caught too.
    const PROMISE = /\d+\s*%[^<>{}\n]{0,40}(free tokens|for every referral)|earn\s+\d+\s*%[^<>{}\n]{0,40}referr/i;
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      for (const [i, line] of src.split('\n').entries()) {
        if (PROMISE.test(line)) offenders.push(`${f}:${i + 1} → ${line.trim().slice(0, 140)}`);
      }
    }
    expect(
      offenders.join('\n  '),
      'A referral reward is being promised in the UI. Promise a reward only once the server actually pays it — the amounts belong in the reward ledger, not in JSX.',
    ).toBe('');
  });

  it('no deleted coupon code is offered to the user as an example', () => {
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      for (const code of DEAD_COUPON_CODES) {
        if (src.includes(code)) offenders.push(`${f} → ${code}`);
      }
    }
    expect(
      offenders.join('\n  '),
      'A coupon code the server refuses is shown as an example. Use a neutral placeholder — an example that fails teaches the user the feature is broken.',
    ).toBe('');
  });
});
