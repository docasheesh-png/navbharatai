/**
 * THE FLAG THAT WENT NOWHERE (autopsy e706e068, School ERP, 2026-09-17).
 *
 * `decideComplexity` scored the 11-feature ERP at 63 — COMPLEX — and the routing note in
 * `complexityRouting.ts` promised "a complex build starts at the tier's SECOND rung, which on Weak and
 * Normal is KIMI". The build then made 83 calls on `glm-4.7-flashx`, the cheapest flash rung, and
 * ground through 21 compile errors for seven minutes while KIMI sat one rung away.
 *
 * The verdict had been spread into `baseRunnerOpts` — the AgentRunner's options, which never read it —
 * and never handed to `buildTurnRunner`, the ONLY function that builds a chain. Every unit test of the
 * router passed, because every one of them tested the DECISION and none tested whether a chain heard it.
 *
 * This suite asserts the constructed chain, the way tierChainFidelity does, and then pins the two
 * runner constructions in the route that must carry the flag — so the wiring cannot quietly go dead
 * again while the decision keeps looking right.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTurnRunner } from '../src/server/routes/agentv3';
import { TIER_LADDERS, isCheapFlashRung } from '../src/server/AgentV3/tierLadder';
import type { ChainRung } from '../src/server/AgentV3/runnerChainSummary';

const ENV_KEYS = [
  'AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'AGENTV3_LADDER_WEAK', 'AGENTV3_LADDER_NORMAL', 'AGENTV3_LADDER_STRONG', 'AGENTV3_DISABLE_HAIKU_BACKSTOP',
  'GLM_MODEL', 'KIMI_MODEL', 'AGENTV3_FREE_GLM_MODEL', 'AGENTV3_FREE_KIMI_MODEL',
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.GLM_API_KEY = 'test-glm';
  process.env.KIMI_API_KEY = 'test-kimi';
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

function chainFor(opts: Parameters<typeof buildTurnRunner>[0]): ChainRung[] {
  let seen: ChainRung[] = [];
  buildTurnRunner({ ...opts, onChain: (c) => { seen = c; } });
  return seen;
}

describe('🔴 a COMPLEX build opens past the cheap flash rung — on the CONSTRUCTED chain', () => {
  it('WEAK + complex: the first rung is KIMI, never the flash opener', () => {
    const chain = chainFor({ tier: 'weak', noClaude: true, complex: true });
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].name).toBe('KIMI');
    expect(chain.some((r) => isCheapFlashRung({ provider: r.name as never, model: r.modelId ?? '' }))).toBe(false);
  });

  it('NORMAL + complex: the first rung is KIMI', () => {
    expect(chainFor({ tier: 'off', complex: true })[0].name).toBe('KIMI');
  });

  it('a simple build still opens on the ladder\'s first rung — the common path pays nothing', () => {
    const weak = chainFor({ tier: 'weak', noClaude: true, complex: false });
    expect(`${weak[0].name}:${weak[0].modelId}`).toBe(`${TIER_LADDERS.weak[0].provider}:${TIER_LADDERS.weak[0].model}`);
  });

  it('STRONG has no flash rung, so complex changes nothing there', () => {
    const plain = chainFor({ tier: 'mini' }).map((r) => r.name);
    const complex = chainFor({ tier: 'mini', complex: true }).map((r) => r.name);
    expect(complex).toEqual(plain);
  });
});

describe('🔒 the route HANDS the verdict to the chain builder — the wiring the ERP build proved absent', () => {
  const src = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  const blockFrom = (marker: string): string => {
    const at = code.indexOf(marker);
    expect(at, `${marker} not found`).toBeGreaterThan(-1);
    // Up to the closing `});` of that buildTurnRunner({ … }) call.
    const end = code.indexOf('});', at);
    return code.slice(at, end);
  };

  it('the fast-lane / planner runner carries `complex: buildIsComplex`', () => {
    expect(blockFrom('const makeFastTextRunner = (onUsed?: (used: string) => void): TurnRunner => buildTurnRunner({'))
      .toContain('complex: buildIsComplex');
  });

  it('the main build client carries `complex: buildIsComplex`', () => {
    expect(blockFrom('const client = buildTurnRunner({')).toContain('complex: buildIsComplex');
  });

  it('the decision is RECORDED in the report, not only logged', () => {
    // A report with 83 flash calls on a score-63 app could not say whether the router had spoken.
    expect(code).toContain("code: 'COMPLEXITY_ROUTING'");
    const at = code.indexOf("code: 'COMPLEXITY_ROUTING'");
    expect(code.slice(at, at + 600)).toContain('complexityDecision.source');
  });

  it('and the flag still reaches the chain builder\'s own signature', () => {
    expect(code).toMatch(/export function buildTurnRunner\(opts: \{[^}]*complex\?: boolean/);
    expect(code).toContain('(opts.heal || opts.complex) ? withoutCheapFlashLead(parsed.rungs)');
  });
});
