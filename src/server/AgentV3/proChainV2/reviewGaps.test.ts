import { describe, it, expect } from 'vitest';
import { createProChainV2AgentRunner, createProChainV2BuildState, type ProChainV2Event } from './agentRunner';
import { observeRouterOneRungs, decorateSupplierRung, type SupplierCallEvent } from './builderAdapters';
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import { makeMultiProviderTurnRunner } from '../providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';
import { BuildDiagnostics, userFacingReport } from '../BuildDiagnostics';
import { ProChainV2Build } from './buildContext';

/**
 * Review gaps closed before the z@ trial (owner t350u / t311u "no fix may create a new problem"):
 *   • two agents of ONE build keep independent engine choices (sticky is per agent, never shared);
 *   • a timeout on one engine moves only that turn on;
 *   • Router One rungs are observed only — its usage (even "unmeasured") is never rewritten by v2;
 *   • the user-facing report carries no supplier name, no model, no v2 block — one neutral line.
 */
const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
const ok = (text: string, measured?: boolean): TurnResult => ({
  text, toolUses: [], stopReason: 'end_turn', rawContent: [],
  usage: { inputTokens: 7, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, ...(measured === false ? { measured: false } : {}) },
});
const realChain = (rungs: NamedRunner[], hooks: { onUsed: (n: string) => void; onFailed: (n: string, e: unknown) => void }) =>
  makeMultiProviderTurnRunner(rungs, { onProviderUsed: (u) => hooks.onUsed(u), onProviderError: (n, e) => hooks.onFailed(n, e), cooldowns: undefined });

function rung(label: string, step: () => 'ok' | Error): NamedRunner {
  const runner: TurnRunner = { async runTurn() { const s = step(); if (s instanceof Error) throw s; return ok(label); } };
  return { name: label, runner, modelId: `${label}-m` };
}

describe('Pro Chain V2 — review gaps', () => {
  it('PER-AGENT INDEPENDENCE: agent A sticks to Qubax after a Router One failure; agent B of the same build still starts on Router One', async () => {
    const state = createProChainV2BuildState();
    let r1Calls = 0;
    const events: ProChainV2Event[] = [];
    const make = (agent: string) => createProChainV2AgentRunner({
      agent, state, makeChain: realChain, surplusRecoverable: () => true, env: {}, onEvent: (e) => events.push(e),
      providers: [
        // Router One fails ONLY its first call in the whole build.
        { label: 'ENGINE_R1', rungs: [rung('ENGINE_R1', () => (r1Calls++ === 0 ? new Error('ENGINE_R1 503 upstream') : 'ok'))] },
        { label: 'ENGINE_QX', rungs: [rung('ENGINE_QX', () => 'ok')] },
        { label: 'ENGINE_MF', rungs: [rung('ENGINE_MF', () => 'ok')] },
      ],
    });
    const a = make('builder#1');
    const b = make('writer#1');
    expect((await a.runTurn(PARAMS)).text).toBe('ENGINE_QX');
    expect((await b.runTurn(PARAMS)).text).toBe('ENGINE_R1'); // B never inherited A's fallback
    expect((await a.runTurn(PARAMS)).text).toBe('ENGINE_QX'); // A keeps its own sticky choice
    expect((await b.runTurn(PARAMS)).text).toBe('ENGINE_R1');
    expect(events.filter((e) => e.kind === 'provider-failed').map((e) => e.agent)).toEqual(['builder#1']);
  });

  it('a timeout on Router One moves that turn to Qubax; the failure is reported for that agent only', async () => {
    const events: ProChainV2Event[] = [];
    const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
    const r = createProChainV2AgentRunner({
      agent: 'healer#1', state: createProChainV2BuildState(), makeChain: realChain, surplusRecoverable: () => true, env: {}, onEvent: (e) => events.push(e),
      providers: [
        { label: 'ENGINE_R1', rungs: [rung('ENGINE_R1', () => timeout)] },
        { label: 'ENGINE_QX', rungs: [rung('ENGINE_QX', () => 'ok')] },
      ],
    });
    expect((await r.runTurn(PARAMS)).text).toBe('ENGINE_QX');
    const failed = events.find((e) => e.kind === 'provider-failed');
    expect(failed && failed.kind === 'provider-failed' && failed.provider).toBe('ENGINE_R1');
  });

  it('Router One usage is never rewritten by v2 (its own accounting owns it); Qubax/Mitrify unmeasured usage IS estimated', async () => {
    const inner: TurnRunner = { async runTurn() { return ok('x', false); } };
    const calls: SupplierCallEvent[] = [];
    const [r1] = observeRouterOneRungs([{ name: 'ENGINE_R1', runner: inner, modelId: 'deepseek' }], 'ENGINE_R1', [], (e) => calls.push(e));
    const r1Out = await r1!.runner.runTurn(PARAMS);
    expect(r1Out.usage).toEqual(ok('x', false).usage);
    expect(calls[0]).toMatchObject({ provider: 'ENGINE_R1', ok: true });
    expect(calls[0]!.usageEstimated).toBeUndefined();
    const qx = decorateSupplierRung({ name: 'ENGINE_QX', runner: inner, modelId: 'glm-5.3' }, 'ENGINE_QX', [], (e) => calls.push(e));
    const qxOut = await qx.runner.runTurn(PARAMS);
    expect(qxOut.usage.measured).toBeUndefined();
    expect(qxOut.usage.inputTokens).toBeGreaterThan(0);
    expect(calls[1]!.usageEstimated).toBe(true);
  });

  it('BRAND: the user-facing report folds every v2 line into one neutral line and drops the v2 block', () => {
    const diag = new BuildDiagnostics();
    const v2 = new ProChainV2Build('test-profile', {});
    v2.attachReport((line) => diag.record(line));
    diag.setProChainV2(v2.summary);
    v2.onEvent({ kind: 'provider-failed', agent: 'builder#1', provider: 'ENGINE_QX', reason: 'qubax.ai glm-5.3 429 rate limited' });
    v2.onEvent({ kind: 'chain-exhausted', agent: 'builder#1', reason: 'mitrify.com mitrify/auto-cheap 503' });
    v2.onCall({ provider: 'ENGINE_MF', model: 'mitrify/auto-cheap', ok: false, latencyMs: 12, status: 503, message: 'mitrify upstream down' });
    const admin = diag.report();
    expect(admin.proChainV2).toBeDefined();
    expect(admin.issues.some((i) => i.code.startsWith('PRO_CHAIN_V2_'))).toBe(true);
    const user = userFacingReport(admin);
    const text = JSON.stringify(user);
    expect(user.proChainV2).toBeUndefined();
    expect(text).not.toMatch(/qubax|mitrify|glm|ENGINE_QX|ENGINE_MF|PRO_CHAIN_V2/i);
    expect(user.issues.filter((i) => i.code === 'ENGINE_ROUTING').length).toBeGreaterThan(0);
    // Routing telemetry is never a build's root cause (admin view included) — the build's own ending lines are.
    expect(String(admin.rootCause ?? '')).not.toMatch(/\[v2\]|ENGINE_QX|ENGINE_MF/);
  });

  it('a FAILED build whose only other line is a real error names that error, never a v2 routing line', () => {
    const diag = new BuildDiagnostics();
    const v2 = new ProChainV2Build('test-profile', {});
    v2.attachReport((line) => diag.record(line));
    v2.onEvent({ kind: 'chain-exhausted', agent: 'builder#2', reason: 'ENGINE_MF 503' });
    diag.record({ phase: 'build', severity: 'error', code: 'TSC_FAILED', autoResolved: false, message: 'src/App.tsx: type error' });
    diag.finish(false);
    expect(String(diag.report().rootCause)).toContain('type error');
    expect(String(diag.report().rootCause)).not.toContain('[v2]');
  });
});
