// A TURN THAT PRODUCED NOTHING IS OUR COST, NEVER THE USER'S BILL (admin 2026-09-18, build b6f88a72).
//
// The admin asked "kya ham ₹ kuch jyada hi charge to nahi kar rahe hai?" and the honest answer was
// that the 4× markup is defensible while applying it to work that delivered nothing is not: that
// build's post-build reviewer consumed ~520,000 input tokens and returned `responseChars: 0` on
// every call, and the user paid the full markup on all of it.
//
// These tests pin BOTH halves of the rule, because a fix to either half alone would be a new bug:
//   • the user's bill loses those tokens, and
//   • OUR recorded cost keeps every one of them — a clamp that shrank our own number too would hide
//     our bleeding on the exact panel used to judge it (the `E2B_USD_PER_HOUR` shape).
//
// Reversion-proven: each behavioural case was re-run with its fix removed and observed to fail.

import { describe, it, expect } from 'vitest';
import {
  addUnbilled,
  billableEntries,
  splitUnbilledCost,
  markAbandonedTurn,
  abandonedTurnUsage,
  type UnbilledAwareEntry,
} from '../src/server/AgentV3/unbilledTurns';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { realProviderCostUsd } from '../src/server/AgentV3/providerRates';
import { ledgerCostUsd } from '../src/server/AgentV3/buildCostCeiling';
import { turnStarvedItsBudget } from '../src/server/AgentV3/floorBudget';

const KIMI = 'kimi-k2.7-code'; // $0.95 in / $4.00 out / $0.19 cache — a real row on the rate card

describe('billableEntries — the user pays for what was produced', () => {
  it('subtracts the barren subset, and leaves an entry without one untouched', () => {
    const entries: UnbilledAwareEntry[] = [
      { provider: 'KIMI', model: KIMI, usage: { inputTokens: 1000, outputTokens: 400 } },
      {
        provider: 'GLM', model: 'glm-5.3',
        usage: { inputTokens: 1000, outputTokens: 400 },
        unbilled: { inputTokens: 600, outputTokens: 400 },
      },
    ];
    expect(billableEntries(entries)).toEqual([
      { provider: 'KIMI', model: KIMI, usage: { inputTokens: 1000, outputTokens: 400 } },
      { provider: 'GLM', model: 'glm-5.3', usage: { inputTokens: 400, outputTokens: 0 } },
    ]);
  });

  it('carries the cache share down with the input it is a share of', () => {
    const [only] = billableEntries([{
      provider: 'KIMI', model: KIMI,
      usage: { inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 900 },
      unbilled: { inputTokens: 600, outputTokens: 0, cacheReadInputTokens: 550 },
    }]);
    // 400 input left, 350 of it cache-served — and the cache share can never exceed the input.
    expect(only.usage).toEqual({ inputTokens: 400, outputTokens: 0, cacheReadInputTokens: 350 });
  });

  it('a malformed barren subset larger than its own slice bills ZERO, never a negative', () => {
    const [only] = billableEntries([{
      provider: 'KIMI', model: KIMI,
      usage: { inputTokens: 100, outputTokens: 10 },
      unbilled: { inputTokens: 999_999, outputTokens: 999_999 },
    }]);
    expect(only.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('never mutates the caller\'s entries — OUR cost still needs the full figures', () => {
    const entries: UnbilledAwareEntry[] = [{
      provider: 'KIMI', model: KIMI,
      usage: { inputTokens: 1000, outputTokens: 400 },
      unbilled: { inputTokens: 1000, outputTokens: 400 },
    }];
    billableEntries(entries);
    expect(entries[0].usage).toEqual({ inputTokens: 1000, outputTokens: 400 });
  });
});

describe('splitUnbilledCost — two halves priced by ONE rate card', () => {
  it('bills nothing for a build whose every turn produced nothing, and still records the cost', () => {
    const entries: UnbilledAwareEntry[] = [{
      provider: 'KIMI', model: KIMI,
      usage: { inputTokens: 520_000, outputTokens: 0 },
      unbilled: { inputTokens: 520_000, outputTokens: 0 },
    }];
    const split = splitUnbilledCost(entries);
    expect(split.realCostUsd).toBeCloseTo((520_000 / 1e6) * 0.95, 9);
    expect(split.billableCostUsd).toBe(0);
    // Absorbed is DERIVED, so it can never disagree with the amount charged.
    expect(split.absorbedCostUsd).toBeCloseTo(split.realCostUsd, 9);
  });

  it('is a no-op on a normal build — no barren turn, no change to anything', () => {
    const entries: UnbilledAwareEntry[] = [
      { provider: 'KIMI', model: KIMI, usage: { inputTokens: 92_754, outputTokens: 5_486 } },
    ];
    const split = splitUnbilledCost(entries, { inputTokens: 1000, outputTokens: 100 });
    expect(split.billableCostUsd).toBeCloseTo(split.realCostUsd, 12);
    expect(split.absorbedCostUsd).toBe(0);
  });

  it('the unattributed remainder is billable by definition — we have no per-turn record of it', () => {
    const withRemainder = splitUnbilledCost(
      [{ provider: 'KIMI', model: KIMI, usage: { inputTokens: 10, outputTokens: 10 }, unbilled: { inputTokens: 10, outputTokens: 10 } }],
      { inputTokens: 50_000, outputTokens: 5_000 },
    );
    expect(withRemainder.billableCostUsd).toBeGreaterThan(0);
  });

  it('absorbed can never exceed what we actually spent', () => {
    const split = splitUnbilledCost([{
      provider: 'KIMI', model: KIMI,
      usage: { inputTokens: 10, outputTokens: 0 },
      unbilled: { inputTokens: 1e9, outputTokens: 1e9 },
    }]);
    expect(split.absorbedCostUsd).toBeLessThanOrEqual(split.realCostUsd);
  });
});

describe('the ledger records a barren turn TWICE — never instead of', () => {
  it('keeps the full tokens in usage and mirrors them into unbilled', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', { inputTokens: 300, outputTokens: 0 }, KIMI, true);
    ledger.add('KIMI', { inputTokens: 700, outputTokens: 500 }, KIMI);
    const [entry] = ledger.entries();
    expect(entry.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(entry.unbilled).toEqual({ inputTokens: 300, outputTokens: 0 });
    // …and the aggregate views the rest of the engine reads are untouched.
    expect(ledger.total()).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(ledger.byProvider().KIMI).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
  });

  it('OUR cost, and the mid-build cost ceiling, still see every barren token', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', { inputTokens: 1_000_000, outputTokens: 0 }, KIMI, true);
    // A ceiling that could not see abandoned spend is a ceiling a runaway build walks straight past.
    expect(ledgerCostUsd(ledger.entries())).toBeCloseTo(0.95, 6);
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.95, 6);
    expect(splitUnbilledCost(ledger.entries()).billableCostUsd).toBe(0);
  });

  it('omitting the flag is byte-for-byte the old behaviour — no unbilled field at all', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', { inputTokens: 10, outputTokens: 2 }, 'glm-5.3');
    expect(ledger.entries()[0]).not.toHaveProperty('unbilled');
  });

  it('accumulates the cache share of a barren turn too', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', { inputTokens: 500, outputTokens: 0, cacheReadInputTokens: 400 }, KIMI, true);
    ledger.add('KIMI', { inputTokens: 500, outputTokens: 0, cacheReadInputTokens: 100 }, KIMI, true);
    expect(ledger.entries()[0].unbilled).toEqual({ inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 500 });
  });
});

describe('addUnbilled', () => {
  it('drops non-finite and negative counts rather than trusting them', () => {
    const into = { inputTokens: 5, outputTokens: 5 };
    addUnbilled(into, { inputTokens: Number.NaN, outputTokens: -10 });
    expect(into).toEqual({ inputTokens: 5, outputTokens: 5 });
  });
});

describe('an abandoned turn carries its bill to the chain', () => {
  it('round-trips the usage and the model on the error that discards it', () => {
    const err = markAbandonedTurn(new Error('starved'), { inputTokens: 4833, outputTokens: 0, cacheReadInputTokens: 100 }, 'glm-5.3');
    expect(abandonedTurnUsage(err)).toEqual({
      usage: { inputTokens: 4833, outputTokens: 0, cacheReadInputTokens: 100 },
      model: 'glm-5.3',
    });
    // …and the error is still the same error, with its message intact.
    expect((err as Error).message).toBe('starved');
  });

  it('attaches NOTHING when the provider reported no usage — "we do not know" is not a measured zero', () => {
    expect(abandonedTurnUsage(markAbandonedTurn(new Error('x'), { inputTokens: 0, outputTokens: 0 }))).toBeNull();
    expect(abandonedTurnUsage(markAbandonedTurn(new Error('x'), null))).toBeNull();
  });

  it('reads null from an ordinary error, a string and a null', () => {
    expect(abandonedTurnUsage(new Error('plain'))).toBeNull();
    expect(abandonedTurnUsage('not an error')).toBeNull();
    expect(abandonedTurnUsage(null)).toBeNull();
  });

  it('is not enumerable, so it can never leak into a serialised error body', () => {
    const err = markAbandonedTurn(new Error('starved'), { inputTokens: 10, outputTokens: 0 });
    expect(Object.keys(err as object)).toHaveLength(0);
    expect(JSON.stringify(err)).toBe('{}');
  });
});

describe('the predicate this rides on is the repo\'s existing one, not a new opinion', () => {
  it('is TRUE only for a truncated/reasoning-only turn that produced neither text nor a tool call', () => {
    expect(turnStarvedItsBudget({ text: '', toolUses: [], truncated: true })).toBe(true);
    expect(turnStarvedItsBudget({ text: '', toolUses: [], reasoningOnly: true })).toBe(true);
  });

  it('is FALSE the moment anything usable came back — a tool call is a product', () => {
    // 🔴 THE CASE THAT DECIDES WHETHER THIS CHANGE IS SAFE. A reviewer sub-agent reading files
    // returns tool calls and NO text. Billing that as "produced nothing" would make the engine's
    // real work free, which is the opposite error and a far more expensive one.
    expect(turnStarvedItsBudget({ text: '', toolUses: [{ id: 't1', name: 'read_file', input: {} }], truncated: true })).toBe(false);
    expect(turnStarvedItsBudget({ text: 'here you go', toolUses: [], truncated: true })).toBe(false);
    // …and an ordinary complete turn is never barren, whatever else is true of it.
    expect(turnStarvedItsBudget({ text: 'done', toolUses: [] })).toBe(false);
  });
});

// ───────────────────────── the wiring, through the REAL runner ─────────────────────────
//
// The pure rules above cannot tell whether the engine ever ASKS them. These cases drive the actual
// MultiProviderTurnRunner, because both halves of this fix live in it — and they live in different
// branches of it, which is exactly why the class hid: one runner throws on starvation and one does
// not, so the tokens went missing in opposite directions depending on which vendor answered.

import { vi, beforeEach } from 'vitest';
import { makeMultiProviderTurnRunner, sharedRateLimitCooldowns, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

type Reported = { used: string; usage: { inputTokens: number; outputTokens: number; producedNothing?: boolean }; model?: string; cacheRead?: number };

function usable(text: string, model = KIMI): TurnResult {
  return {
    text, toolUses: [], stopReason: 'end_turn', rawContent: [{ type: 'text', text }], model,
    usage: { inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

/** A turn that burned its whole ceiling on reasoning: no text, no tool call, cut off. */
function starved(): TurnResult {
  return {
    text: '', toolUses: [], stopReason: 'max_tokens', rawContent: [], truncated: true,
    usage: { inputTokens: 900, outputTokens: 4833, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  } as TurnResult;
}

function collect(): { reported: Reported[]; onTurnComplete: (u: string, usage: Reported['usage'], model?: string, cacheRead?: number) => void } {
  const reported: Reported[] = [];
  return { reported, onTurnComplete: (used, usage, model, cacheRead) => { reported.push({ used, usage, model, cacheRead }); } };
}

describe('MultiProviderTurnRunner — the tokens reach the ledger on BOTH paths', () => {
  beforeEach(() => sharedRateLimitCooldowns.reset());

  it('a runner that does NOT throw on starvation has its turn marked producedNothing', async () => {
    // The Claude path: AgentRunner carries the net at the loop level, so the turn arrives here as a
    // plain success — and used to be billed at the full markup for delivering nothing.
    const quiet: TurnRunner = { runTurn: vi.fn(async () => starved()) };
    const { reported, onTurnComplete } = collect();
    const chain: NamedRunner[] = [{ name: 'CLAUDE', runner: quiet, modelId: 'claude-sonnet-5' }];
    await makeMultiProviderTurnRunner(chain, { onTurnComplete }).runTurn(PARAMS);

    expect(reported).toHaveLength(1);
    expect(reported[0].usage.producedNothing).toBe(true);
    // The counts are still the REAL ones — we paid them.
    expect(reported[0].usage).toMatchObject({ inputTokens: 900, outputTokens: 4833 });
  });

  it('an ordinary successful turn is never marked — the common path is untouched', async () => {
    const good: TurnRunner = { runTurn: vi.fn(async () => usable('built it')) };
    const { reported, onTurnComplete } = collect();
    await makeMultiProviderTurnRunner([{ name: 'KIMI', runner: good, modelId: KIMI }], { onTurnComplete }).runTurn(PARAMS);
    expect(reported[0].usage.producedNothing).toBeUndefined();
  });

  it('a THROWN, abandoned turn is reported too — it used to reach no ledger and no sink at all', async () => {
    // The GLM/Kimi path: OpenAiToolRunner throws on starvation so the chain falls to the next rung.
    // Real money, previously recorded nowhere — invisible to the admin cost card AND to the
    // mid-build cost ceiling.
    const thrower: TurnRunner = {
      runTurn: vi.fn(async () => {
        throw markAbandonedTurn(new Error('the model spent its whole output budget'), { inputTokens: 700, outputTokens: 4833, cacheReadInputTokens: 300 }, 'glm-5.3');
      }),
    };
    const rescuer: TurnRunner = { runTurn: vi.fn(async () => usable('from kimi')) };
    const { reported, onTurnComplete } = collect();
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: thrower, modelId: 'glm-5.3' },
      { name: 'KIMI', runner: rescuer, modelId: KIMI },
    ];
    const out = await makeMultiProviderTurnRunner(chain, { onTurnComplete }).runTurn(PARAMS);

    expect(out.text).toBe('from kimi'); // the ladder still moved on — behaviour is unchanged
    expect(reported).toHaveLength(2);
    const abandoned = reported.find((r) => r.used === 'GLM');
    expect(abandoned?.usage).toMatchObject({ inputTokens: 700, outputTokens: 4833, producedNothing: true });
    expect(abandoned?.model).toBe('glm-5.3');
    expect(abandoned?.cacheRead).toBe(300);
    // …and the rung that actually delivered is billable as always.
    expect(reported.find((r) => r.used === 'KIMI')?.usage.producedNothing).toBeUndefined();
  });

  it('an ordinary provider failure reports nothing — only a turn we MEASURED is recorded', async () => {
    const broken: TurnRunner = { runTurn: vi.fn(async () => { throw new Error('503 from the vendor'); }) };
    const rescuer: TurnRunner = { runTurn: vi.fn(async () => usable('recovered')) };
    const { reported, onTurnComplete } = collect();
    await makeMultiProviderTurnRunner([
      { name: 'GLM', runner: broken, modelId: 'glm-5.3' },
      { name: 'KIMI', runner: rescuer, modelId: KIMI },
    ], { onTurnComplete }).runTurn(PARAMS);
    expect(reported.map((r) => r.used)).toEqual(['KIMI']);
  });

  it('end to end: the abandoned rung is OUR cost and the delivering rung is the bill', async () => {
    const thrower: TurnRunner = {
      runTurn: vi.fn(async () => { throw markAbandonedTurn(new Error('starved'), { inputTokens: 1_000_000, outputTokens: 0 }, 'glm-5.3'); }),
    };
    const rescuer: TurnRunner = { runTurn: vi.fn(async () => usable('done')) };
    const ledger = createProviderUsageLedger();
    await makeMultiProviderTurnRunner([
      { name: 'GLM', runner: thrower, modelId: 'glm-5.3' },
      { name: 'KIMI', runner: rescuer, modelId: KIMI },
    ], {
      onTurnComplete: (used, usage, model, cacheRead) => {
        ledger.add(used, cacheRead ? { ...usage, cacheReadInputTokens: cacheRead } : usage, model, usage.producedNothing === true);
      },
    }).runTurn(PARAMS);

    const split = splitUnbilledCost(ledger.entries());
    expect(split.absorbedCostUsd).toBeCloseTo(1.40, 6);          // the million abandoned glm-5.3 input tokens
    expect(split.realCostUsd).toBeGreaterThan(split.billableCostUsd);
    expect(split.billableCostUsd).toBeCloseTo((100 / 1e6) * 0.95 + (40 / 1e6) * 4.0, 9);
  });
});

// ───────────────────── the billing decision, and the real throw site ─────────────────────

import { decideBuildBilledUsd, type BillingLedgerView } from '../src/server/routes/agentv3';
import { tieredMarkupUsd } from '../src/server/AgentV3/providerRates';
import { readFileSync } from 'node:fs';
import { afterEach } from 'vitest';

function ledgerView(entries: UnbilledAwareEntry[]): BillingLedgerView {
  const byProvider: Record<string, { inputTokens: number; outputTokens: number }> = {};
  let ti = 0, to = 0;
  for (const e of entries) {
    byProvider[e.provider] ??= { inputTokens: 0, outputTokens: 0 };
    byProvider[e.provider].inputTokens += e.usage.inputTokens;
    byProvider[e.provider].outputTokens += e.usage.outputTokens;
    ti += e.usage.inputTokens; to += e.usage.outputTokens;
  }
  return { entries: () => entries, byProvider: () => byProvider, total: () => ({ inputTokens: ti, outputTokens: to }) };
}

describe('decideBuildBilledUsd — the markup is applied to what was produced', () => {
  const prev = process.env.AGENTV3_REALCOST_BILLING;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_REALCOST_BILLING; else process.env.AGENTV3_REALCOST_BILLING = prev; });

  it('leaves barren work out of the base, keeps it in the cost, and names the difference', () => {
    const entries: UnbilledAwareEntry[] = [
      { provider: 'KIMI', model: KIMI, usage: { inputTokens: 100_000, outputTokens: 5_000 } },
      {
        provider: 'GLM', model: 'glm-5.3',
        usage: { inputTokens: 500_000, outputTokens: 0 },
        unbilled: { inputTokens: 500_000, outputTokens: 0 },
      },
    ];
    const sink = { inputTokens: 600_000, outputTokens: 5_000 };
    const r = decideBuildBilledUsd(ledgerView(entries), sink, 'off', null, null);

    const productive = (100_000 / 1e6) * 0.95 + (5_000 / 1e6) * 4.0;
    const barren = (500_000 / 1e6) * 1.40;

    // OUR cost keeps every rupee — the admin card must not be able to under-state our own spend.
    expect(r.realCostUsd).toBeCloseTo(productive + barren, 9);
    // The USER's bill does not.
    expect(r.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(productive), 9);
    expect(r.absorbedUnbilledUsd).toBeCloseTo(barren, 9);
    // …and the barren tokens are NOT quietly re-billed through the unattributed remainder.
    expect(r.realCostRemainder).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('is exactly today\'s behaviour on a build with no barren turn', () => {
    const entries: UnbilledAwareEntry[] = [{ provider: 'KIMI', model: KIMI, usage: { inputTokens: 92_754, outputTokens: 5_486 } }];
    const r = decideBuildBilledUsd(ledgerView(entries), { inputTokens: 92_754, outputTokens: 5_486 }, 'off', null, null);
    expect(r.absorbedUnbilledUsd).toBe(0);
    expect(r.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(r.realCostUsd), 9);
  });

  it('does not touch the OPUS tier, whose price CLAUDE.md records as admin-confirmed', () => {
    const entries: UnbilledAwareEntry[] = [{
      provider: 'CLAUDE', model: 'claude-opus-5',
      usage: { inputTokens: 1000, outputTokens: 1000 },
      unbilled: { inputTokens: 1000, outputTokens: 1000 },
    }];
    const sink = { inputTokens: 1000, outputTokens: 1000 };
    const opus = decideBuildBilledUsd(ledgerView(entries), sink, 'medium', null, null);
    const plain = decideBuildBilledUsd(ledgerView([{ provider: 'CLAUDE', model: 'claude-opus-5', usage: { inputTokens: 1000, outputTokens: 1000 } }]), sink, 'medium', null, null);
    expect(opus.effectiveBilledUsd).toBe(plain.effectiveBilledUsd);
  });
});

describe('the real throw site carries the bill', () => {
  it('OpenAiToolRunner marks the starvation error it throws', () => {
    // A structural assertion on purpose: driving a real provider completion through this runner needs
    // a network double, and what must never regress is the ONE line that turns a discarded call from
    // untracked spend into recorded spend. Stripped of comments so a mention in prose cannot pass it.
    const src = readFileSync('src/server/AgentV3/providers/OpenAiToolRunner.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/throw\s+markAbandonedTurn\(\s*\n?\s*starvedBudgetError\(/);
    expect(src).toContain('result.usage');
  });

  it('the runner reports an abandoned turn through onTurnComplete, not a second channel', () => {
    const src = readFileSync('src/server/AgentV3/providers/MultiProviderTurnRunner.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/abandonedTurnUsage\(err\)/);
    // The one that matters: it must be reported as producing nothing, or it lands on the user's bill.
    expect(src).toMatch(/producedNothing:\s*true/);
  });
});
