// THE FAST-LANE GATE ASKS ABOUT THE ENGINE THAT RUNS, NOT THE LADDER'S RUNG (Q-2310 — autopsies 958aa1ec and
// 61279465). In 61279465 the Weak build was admitted to Surplus (qwen3-coder), and the report still said
// "Skipped the fast lane: the engine this build opens on always reasons first … KIMI kimi-k2.7-code" — a model
// the build never called. In 958aa1ec the build ran Router One and the gate reasoned about the same kimi rung.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fastLaneRungDecision } from '../src/server/AgentV3/fastLaneRung';
import { tierLadder } from '../src/server/AgentV3/tierLadder';

const weak = tierLadder('weak').rungs;

describe('the gate judges the model that opens the build', () => {
  it('THE REPORTED BUILD: COMPLEX opens on kimi, but Surplus qwen3-coder runs — not skipped for kimi', () => {
    const asLadder = fastLaneRungDecision(weak, { complex: true });
    expect(asLadder.skip, 'precondition: the ladder alone says kimi, which always reasons').toBe(true);
    const asRun = fastLaneRungDecision(weak, { complex: true, opensOn: { provider: 'SURPLUS', model: 'qwen3-coder' } });
    expect(asRun.skip).toBe(false);
  });
  it('an engine that runs AND always reasons still skips — and the reason names that engine', () => {
    const d = fastLaneRungDecision(weak, { complex: false, opensOn: { provider: 'SURPLUS', model: 'kimi-k2.7-code' } });
    expect(d.skip).toBe(true);
    expect(d.reason).toContain('SURPLUS kimi-k2.7-code');
  });
  it('no override: the rung decides, as before', () => {
    expect(fastLaneRungDecision(weak, { complex: true, opensOn: null }).skip).toBe(fastLaneRungDecision(weak, { complex: true }).skip);
  });
  it('🔒 the route hands over the Surplus session model and the pinned Router One model', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/opensOn: surplusSession\?\.model \? \{ provider: 'SURPLUS', model: surplusSession\.model \}\n\s*: routerOnePinned && routerOneModels\(\)\[0\] \? \{ provider: 'ENGINE_R1', model: routerOneModels\(\)\[0\] \} : null,/);
  });
});
