/**
 * "AGAR USER KE PAS BALANCE KHATAM HAI, TO PROPER LIKH KAR ANA CHAHIYE. THIS IS PAID SERVICE!!"
 * — admin, 2026-09-22.
 *
 * Two defects were behind that instruction, and both are locked here.
 *
 * 🔴 THE SENTENCE WAS A DRIFTED COPY, THREE TIMES (`passGate.ts`, `toolGate.ts`, the Pro image
 * route), already diverging in wording. One builder now, and the source guards below fail if a
 * fourth copy appears.
 *
 * 🔴 AND FOR A WALLET IN DEBT IT WAS FALSE. The refusal fires at `balanceInr <= 0`, and a build may
 * legitimately leave a wallet at −₹50 (`WALLET_OVERDRAFT_FLOOR_INR`); a real account was found at
 * **−₹506**. "Your balance is empty. Add credit" sends that person to top up ₹20 and meet the
 * identical refusal, with nothing anywhere telling them the real figure.
 *
 * ⚠️ SEVERAL OF THESE ARE SOURCE-LEVEL, DELIBERATELY. `tsc` and `vitest` cannot see that a refusal
 * is checked AFTER the generic throw that swallows it, nor that a "Try again" button is offered for
 * a condition retrying cannot clear — which is exactly how both shipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  walletEmptyNotice, walletEmptyBody, WALLET_EMPTY_CODE, WALLET_EMPTY_STATUS,
} from '../src/server/lib/walletEmptyNotice';
import { isWalletEmptyRefusal, walletEmptyMessage } from '../src/lib/walletEmptyRefusal';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the notice tells the truth about the number', () => {
  it('an exactly-empty wallet reads as empty, and says what to do', () => {
    const t = walletEmptyNotice({ balanceInr: 0, what: 'this answer' });
    expect(t).toContain('Your balance is empty');
    expect(t).toContain('this answer');
    expect(t).toContain('Add credit to carry on.');
    expect(t).toContain('pay-as-you-go');
  });

  it('🔴 A WALLET IN DEBT IS NOT "EMPTY" — it names what was overspent, and the figure that clears it', () => {
    const t = walletEmptyNotice({ balanceInr: -506.03, what: 'this build' });
    expect(t).toContain('₹506.03');
    expect(t).toContain('Add more than ₹506.03 of credit');
    // The old wording is the bug: it is what sent a user at −₹506 to top up ₹20 twice.
    expect(t).not.toContain('Your balance is empty');
  });

  it('a small overdraft is stated to the paisa, not rounded into "empty"', () => {
    expect(walletEmptyNotice({ balanceInr: -0.4 })).toContain('₹0.40');
  });

  it('an unreadable balance says so and invents no number', () => {
    const t = walletEmptyNotice({ balanceInr: null });
    expect(t).toContain('could not be read');
    expect(t).not.toMatch(/₹\d/);
    // NaN and undefined are the same "we do not know", never a zero.
    expect(walletEmptyNotice({ balanceInr: Number.NaN })).toContain('could not be read');
    expect(walletEmptyNotice({})).toContain('could not be read');
  });

  it('names the price when the caller knows it, and stays silent when it does not', () => {
    expect(walletEmptyNotice({ balanceInr: 0, what: 'this image', priceInr: 2 })).toContain('This image costs ₹2.00');
    expect(walletEmptyNotice({ balanceInr: 0, what: 'this image' })).not.toContain('costs');
    // A zero or negative price is not a price — it must not print "costs ₹0.00".
    expect(walletEmptyNotice({ balanceInr: 0, priceInr: 0 })).not.toContain('costs');
  });

  it('a caller-specific way out is appended verbatim', () => {
    expect(walletEmptyNotice({ balanceInr: 0, alternative: 'Or switch the toggle to Free.' }))
      .toContain('Or switch the toggle to Free.');
  });

  it('🔒 WHITE-LABEL LAW — no vendor, model or routing word can reach this text', () => {
    const texts = [
      walletEmptyNotice({ balanceInr: 0 }),
      walletEmptyNotice({ balanceInr: -12, priceInr: 3, what: 'this image', alternative: 'Or use Free.' }),
      walletEmptyNotice({ balanceInr: null }),
    ].join(' ').toLowerCase();
    for (const banned of ['glm', 'kimi', 'moonshot', 'claude', 'anthropic', 'gemini', 'vertex', 'grok', 'openai', 'nemotron', 'z.ai']) {
      expect(texts, `"${banned}" must never reach a user`).not.toContain(banned);
    }
    expect(texts).toContain('navbharatai');
  });
});

describe('the body carries what the clients read', () => {
  it('code, reason and a numeric balance — plus whatever the caller adds', () => {
    const body = walletEmptyBody({ balanceInr: -3.5, what: 'this image' }, { bucket: 'image' });
    expect(body.code).toBe(WALLET_EMPTY_CODE);
    expect(body.reason).toBe('wallet-empty');
    expect(body.balanceInr).toBe(-3.5);
    expect(body.bucket).toBe('image');
    expect(typeof body.error).toBe('string');
  });

  it('an unreadable balance is echoed as 0, while the prose says it could not be read', () => {
    const body = walletEmptyBody({ balanceInr: null });
    expect(body.balanceInr).toBe(0);
    expect(String(body.error)).toContain('could not be read');
  });

  it('the status is Payment Required, which is literally the case', () => {
    expect(WALLET_EMPTY_STATUS).toBe(402);
  });
});

describe('the client acts on the CODE, never on the wording', () => {
  it('recognises the refusal', () => {
    expect(isWalletEmptyRefusal(402, { code: 'wallet_empty' })).toBe(true);
  });

  it('a 402 that is a DIFFERENT offer is not this one', () => {
    // Hosting plans and custom domains answer 402 too, with their own buttons.
    expect(isWalletEmptyRefusal(402, { needsPlan: true })).toBe(false);
    expect(isWalletEmptyRefusal(402, null)).toBe(false);
    expect(isWalletEmptyRefusal(402, 'Payment Required')).toBe(false);
  });

  it('the code alone, on another status, is not a refusal either', () => {
    expect(isWalletEmptyRefusal(500, { code: 'wallet_empty' })).toBe(false);
    expect(isWalletEmptyRefusal(200, { code: 'wallet_empty' })).toBe(false);
  });

  it('the server text wins, because only it knows the real balance', () => {
    expect(walletEmptyMessage({ error: 'You have spent ₹506.03 more than your balance.' }))
      .toContain('₹506.03');
    // No text ⇒ a fallback that states NO number rather than guessing "empty at ₹0".
    expect(walletEmptyMessage(null)).not.toMatch(/₹\d/);
    expect(walletEmptyMessage({})).toContain('add credit');
  });
});

describe('🔒 source guards — what tsc and vitest cannot see', () => {
  const ROUTES = [
    'src/server/professionals/passGate.ts',
    'src/server/tools/toolGate.ts',
    'src/server/routes/imageGen.ts',
  ];

  it('no route keeps its own copy of the sentence', () => {
    for (const f of ROUTES) {
      const code = src(f);
      expect(code, `${f} must build the notice, not restate it`)
        .not.toContain('Your balance is empty. Add credit to keep using NavBharatAI');
      expect(code, `${f} must use the shared builder`).toContain('walletEmptyBody(');
    }
  });

  it('every route that refuses for an empty wallet imports the shared builder', () => {
    for (const f of ROUTES) {
      expect(src(f), f).toContain("from '../lib/walletEmptyNotice'");
    }
  });

  it('🔴 the image studio checks the refusal BEFORE the generic throw that would swallow it', () => {
    const code = src('src/components/ide/AIImageGenerator.tsx');
    const check = code.indexOf('isWalletEmptyRefusal(res.status');
    const generic = code.indexOf('if (!res.ok || !data) {');
    expect(check, 'the wallet check must exist').toBeGreaterThan(-1);
    expect(generic, 'the generic throw must exist').toBeGreaterThan(-1);
    expect(check, 'checked after the throw is checked never').toBeLessThan(generic);
  });

  it('🔴 the balance card offers Add credit and NOT "Try again" — retrying cannot clear a bill', () => {
    const code = src('src/components/ide/AIImageGenerator.tsx');
    // The two cards are mutually exclusive: the generic error stands down while a balance block is set,
    // so a user is never shown a retry button for a condition retrying cannot clear.
    expect(code).toContain('{!isLoading && balanceBlock && (');
    expect(code).toContain('{!isLoading && imageError && !balanceBlock && (');
    expect(code).toContain('onClick={openAddCredit}');
    // A fresh attempt must clear it, or a topped-up wallet keeps showing yesterday's refusal.
    expect(code).toContain("setBalanceBlock('')");
  });
});
