import { describe, it, expect } from 'vitest';
import {
  createProviderUsageLedger,
  providerToTier,
  reconcileWithSink,
  perTierBilledUsd,
  providerBaselineCostUsd,
  UNATTRIBUTED_PROVIDER,
} from './ProviderUsageLedger';
import { billedAmountUsd, billedForTier, sonnetEquivalentUsd } from './pricing';

describe('ProviderUsageLedger — per-provider token attribution', () => {
  it('accumulates tokens per provider and a grand total', () => {
    const l = createProviderUsageLedger();
    l.add('GLM', { inputTokens: 600_000, outputTokens: 100_000 });
    l.add('GLM', { inputTokens: 200_000, outputTokens: 40_000 });
    l.add('CLAUDE', { inputTokens: 150_000, outputTokens: 20_000 });
    expect(l.byProvider()).toEqual({
      GLM: { inputTokens: 800_000, outputTokens: 140_000 },
      CLAUDE: { inputTokens: 150_000, outputTokens: 20_000 },
    });
    expect(l.total()).toEqual({ inputTokens: 950_000, outputTokens: 160_000 });
  });

  it('ignores non-finite / negative token deltas (never corrupts a bucket)', () => {
    const l = createProviderUsageLedger();
    l.add('GLM', { inputTokens: NaN, outputTokens: -5 });
    l.add('GLM', { inputTokens: 100, outputTokens: Infinity });
    expect(l.byProvider().GLM).toEqual({ inputTokens: 100, outputTokens: 0 });
  });

  it('buckets a blank provider label under the unattributed key', () => {
    const l = createProviderUsageLedger();
    l.add('', { inputTokens: 10, outputTokens: 5 });
    expect(l.byProvider()[UNATTRIBUTED_PROVIDER]).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('providerToTier — provider → billing tier', () => {
  it('plain CLAUDE (the only Sonnet/Opus-capable label) → sonnet; everything else → cheap', () => {
    expect(providerToTier('CLAUDE')).toBe('sonnet');
    expect(providerToTier('claude')).toBe('sonnet');
    expect(providerToTier('GLM')).toBe('cheap');
    expect(providerToTier('KIMI')).toBe('cheap');
    expect(providerToTier('CLAUDE_HAIKU')).toBe('cheap'); // the forced-Haiku backstop is cheap
    expect(providerToTier('VERTEX')).toBe('cheap');
    expect(providerToTier('GEMINI')).toBe('cheap');
    expect(providerToTier(UNATTRIBUTED_PROVIDER)).toBe('cheap');
  });
});

describe('reconcileWithSink — aux-call remainder lands in the unattributed bucket', () => {
  it('adds the sink−ledger difference to the other bucket so it reconciles exactly', () => {
    const byProvider = { GLM: { inputTokens: 800_000, outputTokens: 140_000 } };
    // Sink saw more (aux blueprint/plan/judge calls the ledger never captured).
    const out = reconcileWithSink(byProvider, { inputTokens: 850_000, outputTokens: 155_000 });
    expect(out.GLM).toEqual({ inputTokens: 800_000, outputTokens: 140_000 });
    expect(out[UNATTRIBUTED_PROVIDER]).toEqual({ inputTokens: 50_000, outputTokens: 15_000 });
  });

  it('no remainder → no unattributed bucket added', () => {
    const byProvider = { GLM: { inputTokens: 100, outputTokens: 50 } };
    const out = reconcileWithSink(byProvider, { inputTokens: 100, outputTokens: 50 });
    expect(out[UNATTRIBUTED_PROVIDER]).toBeUndefined();
  });

  it('a negative difference (ledger ≥ sink) clamps to 0 — never a negative bucket', () => {
    const byProvider = { GLM: { inputTokens: 100, outputTokens: 50 } };
    const out = reconcileWithSink(byProvider, { inputTokens: 80, outputTokens: 40 });
    expect(out[UNATTRIBUTED_PROVIDER]).toBeUndefined();
  });
});

describe('perTierBilledUsd — the FLAG-ON per-tier billing math', () => {
  it('an all-cheap build equals the flat cheap-tier bill (no change for pure-GLM builds)', () => {
    const usage = { GLM: { inputTokens: 800_000, outputTokens: 140_000 } };
    const total = { inputTokens: 800_000, outputTokens: 140_000 };
    expect(perTierBilledUsd(usage, false)).toBeCloseTo(billedAmountUsd(total, false), 10);
  });

  it('a MIXED build bills the Sonnet share at ×3 and the cheap share at ×1.2 (the whole point)', () => {
    const usage = {
      GLM: { inputTokens: 800_000, outputTokens: 140_000 },
      CLAUDE: { inputTokens: 150_000, outputTokens: 20_000 },
    };
    const expected =
      billedForTier({ inputTokens: 800_000, outputTokens: 140_000 }, 'cheap') +
      billedForTier({ inputTokens: 150_000, outputTokens: 20_000 }, 'sonnet');
    expect(perTierBilledUsd(usage, false)).toBeCloseTo(expected, 10);
    // And it must be STRICTLY MORE than billing the whole thing at the cheap tier (closes under-billing).
    const flatCheap = billedForTier({ inputTokens: 950_000, outputTokens: 160_000 }, 'cheap');
    expect(perTierBilledUsd(usage, false)).toBeGreaterThan(flatCheap);
  });

  it('power mode prices the WHOLE build at the Opus tier, same as billedAmountUsd', () => {
    const usage = {
      GLM: { inputTokens: 500_000, outputTokens: 80_000 },
      CLAUDE: { inputTokens: 100_000, outputTokens: 30_000 },
    };
    const total = { inputTokens: 600_000, outputTokens: 110_000 };
    expect(perTierBilledUsd(usage, 'max')).toBeCloseTo(billedAmountUsd(total, 'max'), 10);
    expect(perTierBilledUsd(usage, true)).toBeCloseTo(billedAmountUsd(total, true), 10);
  });
});

describe('providerBaselineCostUsd — the admin usage-report cost column (Sonnet-equivalent)', () => {
  it('prices each provider bucket at the Sonnet-equivalent baseline', () => {
    const usage = {
      GLM: { inputTokens: 800_000, outputTokens: 140_000 },
      CLAUDE: { inputTokens: 150_000, outputTokens: 20_000 },
    };
    const out = providerBaselineCostUsd(usage);
    expect(out.GLM).toBeCloseTo(sonnetEquivalentUsd({ inputTokens: 800_000, outputTokens: 140_000 }), 10);
    expect(out.CLAUDE).toBeCloseTo(sonnetEquivalentUsd({ inputTokens: 150_000, outputTokens: 20_000 }), 10);
  });
});
