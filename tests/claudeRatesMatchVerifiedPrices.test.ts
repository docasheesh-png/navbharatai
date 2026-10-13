// Q-880 (billing audit 2026-10-12): a Claude PROVIDER cost must equal Anthropic's verified price for the
// model id that actually runs.
//
// THE CLASS. Prices were hand-typed constants, and the one test that read them pinned the constant
// rather than the provider's price — so when Opus 4.8 replaced Opus 4.1 at a third of the price, every
// test stayed green while every Strong build that reached its Opus rung was billed on a cost 3× too
// high. This file holds the verified table, with its source and date, and fails when:
//   1. a default Claude model id (models.ts) has no verified price here — a model bump must bring its price;
//   2. the rate card prices a verified id at anything other than its verified price.
//
// SOURCE: https://claude.com/pricing, fetched 2026-10-12 (USD per 1M tokens). Cache write is the
// 5-minute TTL price — the only TTL `ClaudeClient` uses (`cache_control: { type: 'ephemeral' }`).
// Not used by this code, so not priced here: batch (−50%), fast mode, US-only inference (1.1×),
// 1-hour cache writes, and server tools (web search, code execution).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { realRateFor } from '../src/server/AgentV3/providerRates';
import { opusRate } from '../src/server/AgentV3/pricing';
import { haikuModel, sonnetModel, opusModel, opusNormalModel } from '../src/server/AgentV3/models';

const VERIFIED_ON = '2026-10-12';
const VERIFIED: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const RATE_ENV = ['OPUS_INPUT_PER_MTOK', 'OPUS_OUTPUT_PER_MTOK', 'SONNET_INPUT_PER_MTOK', 'SONNET_OUTPUT_PER_MTOK',
  'RATE_HAIKU_IN', 'RATE_HAIKU_OUT', 'AGENTV3_OPUS_MODEL', 'AGENTV3_OPUS_NORMAL_MODEL', 'AGENTV3_SONNET_MODEL',
  'AGENTV3_HAIKU_MODEL'];

describe(`Claude provider rates equal Anthropic's verified prices (verified ${VERIFIED_ON})`, () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of RATE_ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of RATE_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('every default Claude model id the code calls has a verified price', () => {
    for (const id of [haikuModel(), sonnetModel(), opusModel(), opusNormalModel()]) {
      expect(VERIFIED[id], `${id} has no verified price — add it from claude.com/pricing with the date`).toBeDefined();
    }
  });

  for (const [id, p] of Object.entries(VERIFIED)) {
    it(`${id} is priced at $${p.input} / $${p.output} (cache $${p.cacheRead} read, $${p.cacheWrite} write)`, () => {
      const r = realRateFor('CLAUDE', id);
      expect(r.inputPerMTok).toBeCloseTo(p.input, 10);
      expect(r.outputPerMTok).toBeCloseTo(p.output, 10);
      expect(r.cacheReadPerMTok).toBeCloseTo(p.cacheRead, 10);
      expect(r.cacheWritePerMTok).toBeCloseTo(p.cacheWrite, 10);
    });
  }

  it('the Opus rung is priced at the Opus rate even when the call reported no model id', () => {
    expect(realRateFor('CLAUDE_OPUS')).toEqual(opusRate());
    expect(realRateFor('CLAUDE_OPUS', 'claude-opus-4-8')).toEqual(opusRate());
  });

  it('the env override still wins, so ops can follow a price change without a deploy', () => {
    process.env.OPUS_INPUT_PER_MTOK = '4';
    process.env.OPUS_OUTPUT_PER_MTOK = '20';
    expect(opusRate()).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20 });
  });
});
