// CLAUDE'S PROMPT CACHE IS PRICED AT ITS REAL RATE (admin 2026-10-11, Q-343 option (a): "apki salah ke anusar
// bana do!").
//
// Anthropic reports a turn's input in three parts: `input_tokens` (the UNCACHED part only), a cache READ
// and a cache WRITE beside it. Every OpenAI-compatible provider reports the opposite shape — its
// `prompt_tokens` already includes the cached share. One `TurnUsage` type carried both meanings, so the
// real-cost formula clamped every Claude cache read down to the tiny uncached count and never priced a
// cache write at all. A Sonnet turn of 2k uncached + 40k cache read + 5k cache write was recorded as
// $0.006; it really costs $0.03675.
//
// THE CLASS: a token count with two meanings. It now has ONE — `inputTokens` is the TOTAL input and the
// two cache counts are shares of it — and ONE formula prices the shares (`tokenCostUsd`): Claude reads at
// 0.1× input, writes at 1.25×; a rate without a cache line prices the share at full input (margin-safe).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMessage } from '../src/server/AgentV3/ClaudeClient';
import { opusRate, sonnetRate, billedAmountUsd, tokenCostUsd } from '../src/server/AgentV3/pricing';
import { realRateFor, realProviderCostUsd, usageCostUsd, tieredMarkupUsd } from '../src/server/AgentV3/providerRates';
import { createProviderUsageLedger, modelUsageFromEntries } from '../src/server/AgentV3/ProviderUsageLedger';
import { createUsageSink } from '../src/server/AgentV3/UsageSink';
import { billableEntries } from '../src/server/AgentV3/unbilledTurns';
import { readProviderUsage } from '../src/server/AI/Router/ProviderTypes';
import { anthropicTotalInput } from '../src/server/lib/anthropicUsage';
import { decideBuildBilledUsd } from '../src/server/routes/agentv3';

// The real shape of the turn in the queue row: Anthropic's own usage block.
const ANTHROPIC_USAGE = { input_tokens: 2_000, output_tokens: 0, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 5_000 };
const SONNET = 'claude-sonnet-4-6';
// 2k @ $3 + 40k @ $0.30 + 5k @ $3.75, per million
const REAL_SONNET_USD = 0.006 + 0.012 + 0.01875;

describe('one meaning: inputTokens is the TOTAL input', () => {
  it('🔒 a Claude turn reports uncached + cache read + cache write as its input, the cache counts as shares', () => {
    const t = parseMessage({ content: [], stop_reason: 'end_turn', usage: ANTHROPIC_USAGE });
    expect(t.usage.inputTokens).toBe(47_000);
    expect(t.usage.cacheReadInputTokens).toBe(40_000);
    expect(t.usage.cacheCreationInputTokens).toBe(5_000);
  });

  it('the router reads an Anthropic body the same way, and an OpenAI-shaped body exactly as before', () => {
    expect(readProviderUsage(ANTHROPIC_USAGE)).toEqual({ inputTokens: 47_000, outputTokens: 0 });
    expect(readProviderUsage({ prompt_tokens: 900, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 800 } })).toEqual({ inputTokens: 900, outputTokens: 10 });
    expect(readProviderUsage({ input_tokens: 120, output_tokens: 7 })).toEqual({ inputTokens: 120, outputTokens: 7 });
    expect(anthropicTotalInput(undefined)).toBe(0);
  });
});

describe('one formula: the shares are priced at their own rates', () => {
  it('🔒 the queue row\'s Sonnet turn costs its real $0.03675, not $0.006', () => {
    const t = parseMessage({ content: [], stop_reason: 'end_turn', usage: ANTHROPIC_USAGE });
    expect(usageCostUsd(t.usage, realRateFor('CLAUDE', SONNET))).toBeCloseTo(REAL_SONNET_USD, 10);
  });

  it('every Claude rate carries Anthropic\'s cache lines: read 0.1×, write 1.25×', () => {
    expect(sonnetRate()).toMatchObject({ cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 });
    expect(opusRate()).toMatchObject({ cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 });
    expect(realRateFor('CLAUDE_HAIKU')).toMatchObject({ inputPerMTok: 1, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 });
    expect(realRateFor('CLAUDE', 'claude-opus-4-8')).toEqual(opusRate());
  });

  it('🔒 a GLM turn prices exactly as before — its input already included the cached share', () => {
    const glm = { inputTokens: 10_000, outputTokens: 0, cacheReadInputTokens: 8_000 };
    // 2k uncached @ $0.07 + 8k cached @ $0.01
    expect(usageCostUsd(glm, realRateFor('GLM', 'glm-4.7-flashx'))).toBeCloseTo(0.00014 + 0.00008, 12);
  });

  it('🔒 an unknown provider gets no cache discount — the Sonnet price without Anthropic\'s cache lines', () => {
    const rate = realRateFor('mystery-provider');
    expect(rate.cacheReadPerMTok).toBeUndefined();
    expect(rate.cacheWritePerMTok).toBeUndefined();
    expect(usageCostUsd({ inputTokens: 40_000, outputTokens: 0, cacheReadInputTokens: 40_000 }, rate)).toBeCloseTo(0.12, 10);
  });

  it('the shares are clamped to the input they belong to', () => {
    const r = { inputPerMTok: 10, outputPerMTok: 0, cacheReadPerMTok: 1, cacheWritePerMTok: 20 };
    // claims 900 read + 900 write of a 1,000 input → 900 read, 100 write, 0 uncached
    expect(tokenCostUsd({ inputTokens: 1_000, outputTokens: 0, cacheReadInputTokens: 900, cacheCreationInputTokens: 900 }, r))
      .toBeCloseTo((900 * 1 + 100 * 20) / 1e6, 12);
  });
});

describe('through every bill', () => {
  const ENV = ['AGENTV3_REALCOST_BILLING', 'AGENTV3_PER_TIER_BILLING', 'AGENTV3_COST_ROUTING'] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const turn = parseMessage({ content: [], stop_reason: 'end_turn', usage: ANTHROPIC_USAGE }).usage;

  it('🔒 the real-cost bill: ledger and sink carry the shares, and the settle prices them', () => {
    process.env.AGENTV3_REALCOST_BILLING = 'on';
    const ledger = createProviderUsageLedger();
    ledger.add('CLAUDE', turn, SONNET);
    const sink = createUsageSink();
    sink.add(turn);
    expect(sink.total()).toEqual({ inputTokens: 47_000, outputTokens: 0, cacheReadInputTokens: 40_000, cacheCreationInputTokens: 5_000 });
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(REAL_SONNET_USD, 10);
    const d = decideBuildBilledUsd(ledger, sink.total(), 'off');
    expect(d.realCostUsd).toBeCloseTo(REAL_SONNET_USD, 10);
    expect(d.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(REAL_SONNET_USD), 10);
    expect(d.realCostRemainder).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('🔒 the flat Opus bill is real Opus × 2 of the WHOLE input, cache included', () => {
    // 2k @ $15 + 40k @ $1.50 + 5k @ $18.75, × 2
    expect(billedAmountUsd(turn, 'max')).toBeCloseTo((0.03 + 0.06 + 0.09375) * 2, 10);
  });

  it('a barren turn absorbs its cache write too; a delivering turn keeps it', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('CLAUDE', turn, SONNET, { producedNothing: true });
    ledger.add('CLAUDE', turn, SONNET, { phase: 'build' });
    const billable = billableEntries(ledger.entries());
    const total = billable.reduce((n, e) => n + (e.usage.cacheCreationInputTokens ?? 0), 0);
    expect(total).toBe(5_000);
  });

  it('the admin\'s per-model view counts cache writes, and a row without any keeps its old shape', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('CLAUDE', turn, SONNET);
    ledger.add('GLM', { inputTokens: 100, outputTokens: 1, cacheReadInputTokens: 90 }, 'glm-4.7-flashx');
    const view = modelUsageFromEntries(ledger.entries());
    expect(view[`CLAUDE|${SONNET}`]).toEqual({ inputTokens: 47_000, outputTokens: 0, cacheReadInputTokens: 40_000, cacheCreationInputTokens: 5_000 });
    expect(view['GLM|glm-4.7-flashx']).toEqual({ inputTokens: 100, outputTokens: 1, cacheReadInputTokens: 90 });
  });
});

// ── The census: a NEW place that drops the shares, or reads Anthropic's field itself, fails here ─────────

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('the census', () => {
  it('🔒 only the one helper reads Anthropic\'s input_tokens', () => {
    const readers = [...tsFiles('src/server'), 'server.ts']
      .filter((p) => /\.input_tokens\b|\.cache_(read|creation)_input_tokens\b/.test(code(p)))
      .map((p) => p.replace(/\\/g, '/'));
    expect(readers).toEqual(['src/server/lib/anthropicUsage.ts']);
  });

  it('🔒 every capture in the build route passes the cache write, and no bill is handed input + output alone', () => {
    const route = code('src/server/routes/agentv3.ts');
    const captures = route.match(/captureTurnUsage\([a-zA-Z]+Provider, [^\n]*\);/g) ?? [];
    expect(captures.length).toBeGreaterThanOrEqual(4);
    for (const c of captures) expect(c).toContain('usage.cacheCreationInputTokens ?? 0)');
    const sinkAdds = route.match(/buildUsage\.add\(\{[^\n]*\}\);/g) ?? [];
    expect(sinkAdds.length).toBeGreaterThanOrEqual(4);
    for (const a of sinkAdds) expect(a).toContain('cacheCreationInputTokens');
    for (const p of tsFiles('src/server')) {
      expect(code(p), p).not.toMatch(/billedAmountUsd\(\{ inputTokens: [^}]*outputTokens: [^}]*\}/);
    }
  });

  it('🔒 the provider chain and the runner hand the write on', () => {
    const chain = code('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');
    expect(chain.match(/cacheReadInputTokens \?\? 0, [a-z.?]*\.usage\??\.cacheCreationInputTokens \?\? 0\)/g)?.length).toBe(3);
    const runner = code('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain('cacheCreationInputTokens: turn.usage.cacheCreationInputTokens,');
    expect(runner).toContain('const billed = (): number => billedAmountUsd(usage, billingPower);');
  });
});
