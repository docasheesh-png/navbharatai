/**
 * TOTAL AI SPEND — the user sees what they were really charged, not a per-provider call log.
 *
 * Admin, 2026-09-14: *"user ko ai call by provider ki jagah par total AI spend dikhna chahiye — jahan
 * hamne (admin) user se app building me jo charge liya hai, wo show hona chahiye."*
 *
 * These tests state the rules, not the wording:
 *   1. The ₹ is the SAME arithmetic the debit used, so the screen can never disagree with the wallet.
 *   2. "We could not read it" is never rendered as ₹0.
 *   3. Only what a user may see leaves the server.
 */
import { describe, it, expect } from 'vitest';
import { aiSpendSummary, spendKind, formatInr } from '../src/lib/aiSpendSummary';
import { TOKENS_PER_RUPEE } from '../src/lib/walletPricing';
import { userSafeUsageLog, USER_SAFE_USAGE_FIELDS } from '../src/server/lib/usageLogPublic';

const usage = (over: Record<string, unknown> = {}) => ({
  type: 'usage', amountCoinsOrTokens: -100, moneySpent: 0,
  timestamp: '2026-09-14T06:00:00.000Z', description: 'NavBharatAI Pro v3.0 build', ...over,
});

describe('the ₹ is derived, never parsed — one arithmetic with the debit', () => {
  it('reproduces the debit exactly: tokens / TOKENS_PER_RUPEE', () => {
    // walletDebit.ts computes `billedInr = tokens / TOKENS_PER_RUPEE`. Anything else here would let the
    // screen and the wallet disagree, which is the class the shared walletPricing constant exists for.
    const out = aiSpendSummary({ walletLedger: [usage({ amountCoinsOrTokens: -2500, buildRef: 'w_1' })] });
    expect(out.totalInr).toBe(2500 / TOKENS_PER_RUPEE);
    expect(out.totalInr).toBe(25);
  });

  it('ignores the ₹ printed inside the description — the tokens are the money', () => {
    // A description whose text disagrees with the tokens must not move the total: the label is prose.
    const out = aiSpendSummary({
      walletLedger: [usage({ amountCoinsOrTokens: -100, description: 'build — 999,999 tokens (₹9999.00)', buildRef: 'w' })],
    });
    expect(out.totalInr).toBe(1);
  });

  it('a sub-token charge counts as a charge but adds no rupees', () => {
    // `computeDebitedWallet` really writes a 0-token entry and carries the remainder, telling the user
    // so. Dropping it would make the count disagree with what the ledger says happened.
    const out = aiSpendSummary({ walletLedger: [usage({ amountCoinsOrTokens: -0, description: 'under ₹0.01, carried' })] });
    expect(out.chargeCount).toBe(1);
    expect(out.totalInr).toBe(0);
  });
});

describe('"could not read" is not ₹0', () => {
  it('a wallet with no ledger reports ledgerAvailable false', () => {
    expect(aiSpendSummary({ tokenBalance: 500 }).ledgerAvailable).toBe(false);
    expect(aiSpendSummary(null).ledgerAvailable).toBe(false);
    expect(aiSpendSummary(undefined).ledgerAvailable).toBe(false);
    expect(aiSpendSummary('nope').ledgerAvailable).toBe(false);
  });

  it('a wallet with an EMPTY ledger is a true ₹0 — the two are different facts', () => {
    const out = aiSpendSummary({ walletLedger: [] });
    expect(out.ledgerAvailable).toBe(true);
    expect(out.totalInr).toBe(0);
    expect(out.chargeCount).toBe(0);
  });
});

describe('what counts as spend, and which bucket it lands in', () => {
  it('credits, top-ups and purchases are not AI spend', () => {
    const out = aiSpendSummary({
      walletLedger: [
        { type: 'credit', amountCoinsOrTokens: 50000, description: 'Welcome bonus' },
        { type: 'purchase', amountCoinsOrTokens: 10000, description: 'Top-up' },
        usage({ amountCoinsOrTokens: -300, buildRef: 'w' }),
      ],
    });
    expect(out.totalInr).toBe(3);
    expect(out.chargeCount).toBe(1);
  });

  it('a buildRef means app building; a feature means an assistant; neither means "other"', () => {
    expect(spendKind({ buildRef: 'w_123' })).toBe('build');
    expect(spendKind({ feature: 'doctor' })).toBe('assistant');
    expect(spendKind({})).toBe('other');
    // A blank string is not evidence — it must not be read as a build.
    expect(spendKind({ buildRef: '   ' })).toBe('other');
  });

  it('the buckets add up to the total, so the headline can never exceed its parts', () => {
    const out = aiSpendSummary({
      walletLedger: [
        usage({ amountCoinsOrTokens: -1000, buildRef: 'w1' }),
        usage({ amountCoinsOrTokens: -250, feature: 'assistants' }),
        usage({ amountCoinsOrTokens: -50 }),
      ],
    });
    expect(out.buildInr).toBe(10);
    expect(out.assistantInr).toBe(2.5);
    expect(out.totalInr).toBe(13);
    expect(out.totalInr).toBeGreaterThanOrEqual(out.buildInr + out.assistantInr);
  });
});

describe('malformed rows degrade, they never throw and never poison the total', () => {
  it('survives junk entries beside good ones', () => {
    const out = aiSpendSummary({
      walletLedger: [
        null, undefined, 'string', 42, [],
        usage({ amountCoinsOrTokens: 'not-a-number' }),
        usage({ amountCoinsOrTokens: Number.NaN }),
        usage({ amountCoinsOrTokens: -700, buildRef: 'w' }),
      ],
    });
    expect(out.totalInr).toBe(7);
    expect(out.chargeCount).toBe(1);
  });

  it('an entry with no description still gets a label rather than rendering blank', () => {
    const out = aiSpendSummary({ walletLedger: [usage({ description: undefined })] });
    expect(out.rows[0].label).toBeTruthy();
  });
});

describe('rows are newest first and capped, but the count stays honest', () => {
  it('reverses ledger order and caps rendering without shrinking chargeCount', () => {
    const ledger = Array.from({ length: 40 }, (_, i) =>
      usage({ amountCoinsOrTokens: -100, description: `charge ${i}` }));
    const out = aiSpendSummary({ walletLedger: ledger }, { maxRows: 5 });
    expect(out.rows).toHaveLength(5);
    expect(out.rows[0].label).toBe('charge 39'); // newest first
    expect(out.chargeCount).toBe(40);            // the total is not the page
    expect(out.totalInr).toBe(40);               // ...and neither is the money
  });
});

describe('formatInr', () => {
  it('always shows paise, and never NaN', () => {
    expect(formatInr(25)).toBe('25.00');
    expect(formatInr(Number.NaN)).toBe('0.00');
    expect(formatInr(Number.POSITIVE_INFINITY)).toBe('0.00');
  });
});

describe('WHITE-LABEL LAW — only what a user may see leaves the server', () => {
  const row = {
    userId: 'u1', tier: 'navbharat', streamed: true, latencyMs: 812,
    modelName: 'glm-4.7-flash', providerName: 'glm', raced: true,
    failureReason: 'Provider GLM failed — falling back',
    usageMeasured: false, ok: true, grounded: true, createdAt: '2026-09-14T06:00:00.000Z',
  };

  it('drops every vendor-revealing field', () => {
    const safe = userSafeUsageLog('doc1', row) as Record<string, unknown>;
    for (const leak of ['modelName', 'providerName', 'failureReason', 'raced', 'latencyMs', 'streamed', 'userId']) {
      expect(safe[leak]).toBeUndefined();
    }
  });

  it('is an ALLOW-list: a field nobody approved cannot appear, however it is named', () => {
    // The real risk is not today's two fields — it is the next one written into this collection.
    const safe = userSafeUsageLog('doc1', { ...row, someFutureRoutingNote: 'rung 3 of the GLM ladder' });
    expect(Object.keys(safe).every((k) => (USER_SAFE_USAGE_FIELDS as readonly string[]).includes(k))).toBe(true);
  });

  it('keeps the fields the user is entitled to', () => {
    const safe = userSafeUsageLog('doc1', row);
    expect(safe).toMatchObject({ id: 'doc1', tier: 'navbharat', ok: true, grounded: true, usageMeasured: false });
    expect(safe.createdAt).toBe('2026-09-14T06:00:00.000Z');
  });

  it('no output value ever contains a vendor or model token', () => {
    const safe = userSafeUsageLog('doc1', row);
    const blob = JSON.stringify(safe).toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'anthropic', 'gemini', 'vertex', 'grok', 'openai', 'moonshot', 'deepseek']) {
      expect(blob).not.toContain(vendor);
    }
  });

  it('an allowed key cannot smuggle a nested object through', () => {
    const safe = userSafeUsageLog('d', { tier: { secret: 'glm' }, createdAt: { seconds: 1 }, ok: 'yes' }) as Record<string, unknown>;
    expect(safe.tier).toBeUndefined();
    expect(safe.createdAt).toBeUndefined();
    expect(safe.ok).toBeUndefined(); // 'yes' is not a boolean
  });

  it('survives a non-object document', () => {
    expect(userSafeUsageLog('d', null)).toEqual({ id: 'd' });
    expect(userSafeUsageLog('d', 'junk')).toEqual({ id: 'd' });
  });
});

describe('the route applies it on BOTH query paths', () => {
  it('neither the primary query nor the index-missing fallback spreads the raw document', async () => {
    // The original leak existed twice, and a guard on one path leaks on exactly the day the other runs.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/server/routes/wallet.ts', 'utf8'));
    const logsRoute = src.slice(src.indexOf("app.get('/api/wallet/:userId/logs'"), src.indexOf("app.get('/api/wallet/:userId/transactions'"));
    expect((logsRoute.match(/userSafeUsageLog\(/g) ?? []).length).toBe(2);
    expect(logsRoute).not.toMatch(/\{\s*id:\s*d\.id,\s*\.\.\.d\.data\(\)\s*\}/);
  });
});
