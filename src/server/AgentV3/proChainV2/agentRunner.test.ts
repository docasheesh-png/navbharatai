import { describe, it, expect, vi } from 'vitest';
import { createProChainV2AgentRunner, createProChainV2BuildState, nextAgentId, PRO_CHAIN_V2_NO_ENGINE, type ProChainV2Event } from './agentRunner';
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import { makeMultiProviderTurnRunner } from '../providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import { BuildStoppedError } from '../stopSignal';

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
const ok = (text: string): TurnResult => ({ text, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [] });
class EngineDown extends Error { constructor() { super('The build engine is temporarily unavailable. Please try again shortly.'); } }

/** A provider whose behaviour each test scripts. */
function scripted(label: string, plan: Array<'ok' | 'fail'>): { rung: NamedRunner; calls: () => number } {
  let n = 0;
  const runner: TurnRunner = { async runTurn() { const step = plan[Math.min(n, plan.length - 1)]; n += 1; if (step === 'fail') throw new Error(`${label} 503 upstream`); return ok(label); } };
  return { rung: { name: label, runner, modelId: `${label}-m` }, calls: () => n };
}
function surplusScripted(plan: Array<'ok' | 'down' | 'policy'>): { runner: TurnRunner; calls: () => number } {
  let n = 0;
  return { runner: { async runTurn() { const s = plan[Math.min(n, plan.length - 1)]; n += 1; if (s === 'down') throw new EngineDown(); if (s === 'policy') throw new Error('policy refusal'); return ok('SURPLUS'); } }, calls: () => n };
}
const realChain = (rungs: NamedRunner[], hooks: { onUsed: (n: string) => void; onFailed: (n: string, e: unknown) => void }) =>
  makeMultiProviderTurnRunner(rungs, { onProviderUsed: (u) => hooks.onUsed(u), onProviderError: (n, e) => hooks.onFailed(n, e), cooldowns: undefined });

function agent(over: Partial<Parameters<typeof createProChainV2AgentRunner>[0]> & { providers: Parameters<typeof createProChainV2AgentRunner>[0]['providers'] }) {
  const events: ProChainV2Event[] = [];
  const runner = createProChainV2AgentRunner({
    agent: 'builder#1', makeChain: realChain, state: createProChainV2BuildState(),
    surplusRecoverable: (e) => e instanceof EngineDown, onEvent: (e) => events.push(e), env: {}, ...over,
  });
  return { runner, events };
}

describe('Pro Chain V2 — one agent, its own chain', () => {
  it('Surplus first; a Surplus engine failure drops Surplus for THIS agent and retries the same turn on Router One', async () => {
    const s = surplusScripted(['down']);
    const r1 = scripted('ENGINE_R1', ['ok']);
    const qx = scripted('ENGINE_QX', ['ok']);
    const escape = vi.fn(<T>(fn: () => Promise<T>) => fn());
    const first = vi.fn();
    const { runner, events } = agent({ surplus: s.runner, providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }, { label: 'ENGINE_QX', rungs: [qx.rung] }], escapeSurplusScope: escape, onFirstSurplusDrop: first });
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_R1');
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_R1');
    expect(s.calls()).toBe(1); // never re-tried by this agent
    expect(escape).toHaveBeenCalledTimes(2); // the tail always runs outside the Surplus-only guard
    expect(first).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.kind === 'surplus-dropped')).toBe(true);
    expect(qx.calls()).toBe(0);
  });

  it('PER-AGENT: one agent losing Surplus does not move another agent off it', async () => {
    const state = createProChainV2BuildState();
    const sA = surplusScripted(['down']);
    const sB = surplusScripted(['ok', 'ok']);
    const r1 = scripted('ENGINE_R1', ['ok']);
    const a = agent({ agent: 'writer#1', state, surplus: sA.runner, providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }] });
    const b = agent({ agent: 'writer#2', state, surplus: sB.runner, providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }] });
    expect((await a.runner.runTurn(PARAMS)).text).toBe('ENGINE_R1');
    expect((await b.runner.runTurn(PARAMS)).text).toBe('SURPLUS');
    expect((await b.runner.runTurn(PARAMS)).text).toBe('SURPLUS');
  });

  it('after N agents of one build lost Surplus, NEW agents start past it (agents already on it are untouched)', async () => {
    const state = createProChainV2BuildState();
    const env = { PRO_CHAIN_V2_SURPLUS_SKIP_AFTER: '2' };
    const r1 = scripted('ENGINE_R1', ['ok']);
    const prov = [{ label: 'ENGINE_R1', rungs: [r1.rung] }];
    const healthy = surplusScripted(['ok']);
    const keeper = agent({ agent: 'k', state, env, surplus: healthy.runner, providers: prov });
    await keeper.runner.runTurn(PARAMS);
    for (const id of ['a', 'b']) await agent({ agent: id, state, env, surplus: surplusScripted(['down']).runner, providers: prov }).runner.runTurn(PARAMS);
    const fresh = surplusScripted(['ok']);
    const late = agent({ agent: 'late', state, env, surplus: fresh.runner, providers: prov });
    expect((await late.runner.runTurn(PARAMS)).text).toBe('ENGINE_R1');
    expect(fresh.calls()).toBe(0);
    expect(late.events[0]).toMatchObject({ kind: 'agent-start', surplus: 'skipped' });
    expect((await keeper.runner.runTurn(PARAMS)).text).toBe('SURPLUS'); // an agent already on Surplus keeps it
  });

  it('a stop or a non-engine Surplus refusal is NEVER "try another engine"', async () => {
    const r1 = scripted('ENGINE_R1', ['ok']);
    const policy = agent({ surplus: surplusScripted(['policy']).runner, providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }] });
    await expect(policy.runner.runTurn(PARAMS)).rejects.toThrow('policy refusal');
    const stopped: TurnRunner = { async runTurn() { throw new BuildStoppedError({ provider: 'SURPLUS' }); } };
    const st = agent({ surplus: stopped, providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }], surplusRecoverable: () => true });
    await expect(st.runner.runTurn(PARAMS)).rejects.toBeInstanceOf(BuildStoppedError);
    expect(r1.calls()).toBe(0);
  });

  it('Router One → Qubax → Mitrify in order; sticky on the engine that answered, then the owner order again', async () => {
    const r1 = scripted('ENGINE_R1', ['fail', 'ok', 'ok', 'ok', 'ok', 'ok']);
    const qx = scripted('ENGINE_QX', ['ok']);
    const mf = scripted('ENGINE_MF', ['ok']);
    const { runner, events } = agent({ env: { PRO_CHAIN_V2_STICKY_TURNS: '2' }, providers: [
      { label: 'ENGINE_R1', rungs: [r1.rung] }, { label: 'ENGINE_QX', rungs: [qx.rung] }, { label: 'ENGINE_MF', rungs: [mf.rung] },
    ] });
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_QX'); // R1 failed → QX
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_QX'); // sticky 1
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_QX'); // sticky 2
    expect((await runner.runTurn(PARAMS)).text).toBe('ENGINE_R1'); // sticky expired → owner order
    expect(r1.calls()).toBe(2);
    expect(mf.calls()).toBe(0);
    expect(events.filter((e) => e.kind === 'provider-failed')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'provider-used')).toMatchObject({ provider: 'ENGINE_QX', fellBackFrom: ['ENGINE_R1'] });
  });

  it('every engine failing is reported, and no provider means an honest branded error', async () => {
    const r1 = scripted('ENGINE_R1', ['fail']);
    const all = agent({ providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }] });
    await expect(all.runner.runTurn(PARAMS)).rejects.toThrow();
    expect(all.events.some((e) => e.kind === 'chain-exhausted')).toBe(true);
    const none = agent({ providers: [{ label: 'ENGINE_R1', rungs: [] }] });
    await expect(none.runner.runTurn(PARAMS)).rejects.toThrow(PRO_CHAIN_V2_NO_ENGINE);
  });

  it('only the four engines are ever reachable — no GLM/KIMI rung exists in an agent chain', async () => {
    const seen: string[][] = [];
    const r1 = scripted('ENGINE_R1', ['ok']);
    const { runner } = agent({ providers: [{ label: 'ENGINE_R1', rungs: [r1.rung] }], makeChain: (rungs, hooks) => { seen.push(rungs.map((r) => r.name)); return realChain(rungs, hooks); } });
    await runner.runTurn(PARAMS);
    expect(seen.flat().every((n) => /^ENGINE_(R1|QX|MF)/.test(n))).toBe(true);
  });

  it('agent ids are per role and sequential', () => {
    const s = createProChainV2BuildState();
    expect([nextAgentId(s, 'writer'), nextAgentId(s, 'writer'), nextAgentId(s, 'healer')]).toEqual(['writer#1', 'writer#2', 'healer#1']);
  });
});
