// A MULTI-MODEL GATEWAY'S MODELS FAIL ALONE (owner 2026-11-18: "sabse pahle sasta aur accha call ho, response na ho to
// 2nd, 2nd fail hone par 3rd (last try), 3rd bhi fail to discounted token chhor ke aage badho").
//
// The CLASS: the rungs of one gateway (DiscountedTokens, Router One, Qubax, BluesMinds, Moyi) shared ONE bench name, so a
// single timeout or 429 on the first model sidelined its siblings in the same turn and the build fell straight to the
// next, dearer engine. Found by driving the real chain on 2026-11-18: a timeout on model 1 → the turn went to the
// backstop with models 2 and 3 never called. `gatewayModelRungs.ts` makes each model fail alone, while an ACCOUNT fact
// (an empty balance) still retires every model on the key at once, and fixed ladders keep their family semantics.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeMultiProviderTurnRunner, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { independentModelRungs } from '../src/server/AgentV3/gatewayModelRungs';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const answer = (model: string) => ({ text: '', toolUses: [{ id: 't', name: 'read_file', input: {} }], stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 }, rawContent: [], model });
const timeout = () => new Error('Request timed out.');
const rateLimited = () => Object.assign(new Error('429 Too Many Requests'), { status: 429 });
const serverError = () => Object.assign(new Error('500 internal error'), { status: 500 });
const noBalance = () => Object.assign(new Error('402 Insufficient balance — please top up your account'), { status: 402 });

let seq = 0;
/** One gateway of three models (each failing per `plan`), then a backstop. Unique label per case: the cooldowns are process-wide. */
function gateway(plan: ((() => Error) | null)[], opts: { independent?: boolean } = {}) {
  const label = `GW_${++seq}`;
  const tried: string[] = [];
  const models = plan.map((_, i) => `m${i + 1}`);
  const runnerFor = (model: string, name: string): NamedRunner => ({
    name, modelId: model,
    runner: { runTurn: async () => { tried.push(model); const fail = plan[models.indexOf(model)]; if (fail) throw fail(); return answer(model); } } as never,
  });
  const rungs = opts.independent === false
    ? models.map((m) => runnerFor(m, label)) // the old shape: one name for every model
    : independentModelRungs(label, models, (m) => [runnerFor(m, label)]);
  const chain = [...rungs, { name: `BACKSTOP_${seq}`, modelId: 'backstop', runner: { runTurn: async () => { tried.push('backstop'); return answer('backstop'); } } as never }];
  const runner = makeMultiProviderTurnRunner(chain as never, {} as never);
  return { tried, label, run: () => runner.runTurn({ model: 'x', messages: [], tools: [] } as never) as Promise<{ model?: string }> };
}

describe('1 · the second and third models are really tried', () => {
  for (const [why, fail] of [['times out', timeout], ['is rate-limited', rateLimited], ['returns a server error', serverError]] as const) {
    it(`model 1 and 2 ${why} → model 3 answers, the backstop is not reached`, async () => {
      const g = gateway([fail, fail, null]);
      const turn = await g.run();
      expect(g.tried).toEqual(['m1', 'm2', 'm3']);
      expect(turn.model).toBe('m3');
    });
  }
  it('all three fail → the gateway is left and the next engine answers', async () => {
    const g = gateway([timeout, rateLimited, serverError]);
    expect((await g.run()).model).toBe('backstop');
    expect(g.tried).toEqual(['m1', 'm2', 'm3', 'backstop']);
  });
  it('REVERSION: the old one-name shape skipped models 2 and 3 after one timeout (the defect this locks)', async () => {
    const g = gateway([timeout, null, null], { independent: false });
    await g.run();
    expect(g.tried).toEqual(['m1', 'backstop']);
  });
});

describe('2 · an account fact is still proved once, not once per model', () => {
  it('an empty balance on model 1 retires models 2 and 3 on the same key', async () => {
    const g = gateway([noBalance, null, null]);
    expect((await g.run()).model).toBe('backstop');
    expect(g.tried).toEqual(['m1', 'backstop']);
  });
});

describe('3 · the rung shape', () => {
  it('unique bench names in the #n form, one report label, model-scoped family, key-scoped account', () => {
    const rungs = independentModelRungs('ENGINE_DT', ['a', 'b'], (m) => [
      { name: 'ENGINE_DT', modelId: m, runner: {} as never },
      { name: 'ENGINE_DT#2', reportAs: 'ENGINE_DT', modelId: m, runner: {} as never },
    ]);
    expect(rungs.map((r) => r.name)).toEqual(['ENGINE_DT', 'ENGINE_DT#2', 'ENGINE_DT#3', 'ENGINE_DT#4']);
    expect(new Set(rungs.map((r) => r.reportAs))).toEqual(new Set(['ENGINE_DT']));
    expect(rungs.map((r) => r.familyKey)).toEqual(['ENGINE_DT::a', 'ENGINE_DT::a', 'ENGINE_DT::b', 'ENGINE_DT::b']);
    expect(rungs.map((r) => r.accountKey)).toEqual(['account:ENGINE_DT', 'account:ENGINE_DT#2', 'account:ENGINE_DT', 'account:ENGINE_DT#2']);
  });
});

describe('4 · CENSUS: every gateway in the route is built through gatewayRunners', () => {
  const route = stripCodeComments(readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8'));
  it('gatewayRunners splits by model through independentModelRungs', () => {
    const fn = route.slice(route.indexOf('export function gatewayRunners'), route.indexOf('export function cheapBuildFloorRunners'));
    expect(fn).toContain('independentModelRungs(label, models');
  });
  it('no openAiCompatRunners call outside gatewayRunners and the legacy floor passes more than one literal model', () => {
    const outside = route.slice(0, route.indexOf('export function gatewayRunners')) + route.slice(route.indexOf('export function cheapBuildFloorRunners')).replace(/export function cheapBuildFloorRunners[\s\S]*?\n}\n/, '');
    const calls = outside.split('\n').filter((l) => l.includes('openAiCompatRunners(') && !l.includes('export function openAiCompatRunners'));
    expect(calls.length).toBeGreaterThan(3); // the fixed ladders (GLM, KIMI, OPENAI, NEMOTRON) are still here
    const offenders = calls.filter((l) => !/openAiCompatRunners\([^\n]*,\s*\[[^\],]+\]/.test(l));
    expect(offenders).toEqual([]);
  });
  it('the gateway factories in the build chain take gatewayRunners', () => {
    for (const gw of ['qubaxBuilderRungs', 'bluesmindsBuilderRungs', 'moyiBuilderRungs', 'discountedTokensBuilderRungs']) {
      expect(route, gw).toContain(`${gw}(gatewayRunners)`);
    }
    expect(route).not.toContain('openAiCompatRunners(ROUTER_ONE_LABEL');
  });
});
