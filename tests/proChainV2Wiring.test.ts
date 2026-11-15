import { ProChainV2Build } from '../src/server/AgentV3/proChainV2/buildContext';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTurnRunner, proChainV2ForBuild } from '../src/server/routes/agentv3';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import type { ChainRung } from '../src/server/AgentV3/runnerChainSummary';
import type { SurplusPreWriteFailOpenHooks } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { PublicBuildEngineError } from '../src/server/lib/buildEngineError';
import { BuildDiagnostics, PROCESS_ONLY_CODES, isAppFinding, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { PRO_CHAIN_V2_NO_ENGINE } from '../src/server/AgentV3/proChainV2/agentRunner';
import { neutraliseSupplierNames } from '../src/server/AgentV3/proChainV2/builderAdapters';
import { runWithSurplusBuild, activateSurplusBuildForCurrentRequest } from '../src/server/AI/inferencePolicy';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

/**
 * PRO CHAIN V2 WIRING (owner t350u) — against the REAL buildTurnRunner, not a model of it.
 *   • no v2 context ⇒ the Weak chain is byte-for-byte the tier ladder, whatever keys exist (regression);
 *   • v2 context (z@ by default) ⇒ SURPLUS → ENGINE_R1 → ENGINE_QX → ENGINE_MF only, never GLM/KIMI;
 *   • a real tool-call turn travels Qubax(429) → Mitrify through the production rung factory and HTTP.
 */
const KEYS = ['GLM_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY', 'NEMOTRON_API_KEY', 'ANTHROPIC_API_KEY', 'ROUTER_ONE_API_KEY', 'ROUTER_ONE_ENABLED',
  'QUBAX_API_KEY', 'MITRIFY_API_KEY', 'MITRIFY_BUILDER_MODEL', 'MITRIFY_BASE_URL', 'QUBAX_BUILDER_MODELS', 'PRO_CHAIN_V2', 'PRO_CHAIN_V2_PUBLIC', 'PRO_CHAIN_V2_USERS',
  'AGENTV3_LADDER_WEAK', 'AGENTV3_STREAM_BUILD_CALLS', 'AGENTV3_CHEAP_FLOOR'] as const;
const saved: Record<string, string | undefined> = {};
const QX_KEY = 'qbx_live_WIRINGSECRET0001';
const MF_KEY = 'mtf_live_WIRINGSECRET0002';
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { GLM_API_KEY: 'test-glm', KIMI_API_KEY: 'test-kimi', OPENAI_API_KEY: 'test-openai', NEMOTRON_API_KEY: 'test-nemotron', ANTHROPIC_API_KEY: 'sk-ant-test', QUBAX_API_KEY: QX_KEY, MITRIFY_API_KEY: MF_KEY });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

const hooksFor = (email: string | null, extra: Partial<SurplusPreWriteFailOpenHooks> = {}): SurplusPreWriteFailOpenHooks => ({
  state: { dropped: false }, userFilesWritten: () => 0, proChainV2: email === 'z@gmail.com' ? new ProChainV2Build('isolated-test-only') : undefined, ...extra,
});
function chainFor(opts: Parameters<typeof buildTurnRunner>[0]): string[] {
  let seen: ChainRung[] = [];
  buildTurnRunner({ ...opts, onChain: (c) => { seen = c; } });
  return seen.map((r) => r.name);
}

describe('flag OFF (everyone but z@) — nothing changes', () => {
  it('a public user gets no v2 context, and the Weak chain is exactly the ladder even with Qubax/Mitrify keys set', () => {
    expect(proChainV2ForBuild('weak', 'public@user.in', 'uid-x')).toBeUndefined();
    const withHooks = chainFor({ tier: 'weak', noClaude: true, surplusPreWriteFailOpen: hooksFor('public@user.in') });
    const without = chainFor({ tier: 'weak', noClaude: true });
    expect(withHooks).toEqual(without);
    expect(without.length).toBe(TIER_LADDERS.weak.length);
    expect(without.some((n) => /ENGINE_(QX|MF)/.test(n))).toBe(false);
  });
  it('z@ on another band is untouched', () => {
    expect(proChainV2ForBuild('off', 'z@gmail.com', null)).toBeUndefined();
  });
  it('a v2 context that somehow reaches another band is ignored there — that band keeps its own ladder', () => {
    const v2Hooks = { state: { dropped: false }, userFilesWritten: () => 0, proChainV2: new ProChainV2Build('isolated-test-only') };
    for (const tier of ['off', 'mini'] as const) {
      const names = chainFor({ tier, noClaude: true, surplusPreWriteFailOpen: v2Hooks });
      expect(names, tier).toEqual(chainFor({ tier, noClaude: true }));
      expect(names.some((n) => /ENGINE_(QX|MF)/.test(n)), tier).toBe(false);
    }
  });
  it('kill switch: PRO_CHAIN_V2=off ⇒ z@ also back on the old chain', () => {
    process.env.PRO_CHAIN_V2 = 'off';
    expect(proChainV2ForBuild('weak', 'z@gmail.com', null)).toBeUndefined();
  });
});

describe('z@ — the new chain ONLY', () => {
  it('Router One (when eligible) → Qubax → Mitrify; no GLM, no KIMI, no ladder rung at all', () => {
    process.env.ROUTER_ONE_API_KEY = 'r1-test-key';
    process.env.MITRIFY_BUILDER_MODEL = 'glm-5.3';
    const names = chainFor({ tier: 'weak', noClaude: true, surplusPreWriteFailOpen: hooksFor('z@gmail.com') });
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names.every((n) => /^ENGINE_(R1|QX|MF)(#\d+)?$/.test(n))).toBe(true);
    expect(names[0]).toBe('ENGINE_R1');
    expect(names.indexOf('ENGINE_QX')).toBeLessThan(names.indexOf('ENGINE_MF'));
    for (const lane of [{ heal: true }, { plan: true }, { afterLeadRung: true }, { fromProvider: 'CLAUDE' as const }, { complex: true }]) {
      const lnames = chainFor({ tier: 'weak', noClaude: true, ...lane, surplusPreWriteFailOpen: hooksFor('z@gmail.com') });
      expect(lnames.every((n) => /^ENGINE_(R1|QX|MF)/.test(n))).toBe(true);
    }
  });

  it('a real tool-call turn: Surplus down → Qubax 429 → Mitrify answers; billed and reported as ENGINE_MF', async () => {
    process.env.MITRIFY_BUILDER_MODEL = 'glm-5.3';
    process.env.QUBAX_BUILDER_MODELS = 'glm-5.3';
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      urls.push(url);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/models')) return json(503, {});
      if (url.startsWith('https://api.qubax.ai/')) return json(429, { error: { message: `Qubax says slow down (key ${QX_KEY})`, code: 'rate_limit' } });
      return json(200, { id: 'x', object: 'chat.completion', created: 1, model: 'glm-5.3', usage: { prompt_tokens: 100, completion_tokens: 20 },
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 't', type: 'function', function: { name: 'write_file', arguments: '{"path":"App.tsx"}' } }] } }] });
    }));
    const surplusCalls: number[] = [];
    const surplusSession = { buildId: 'b', model: 'glm-5.3', estimatedMicroUsd: '1',
      runner: () => ({ runTurn: async () => { surplusCalls.push(1); throw new PublicBuildEngineError(); } }) } as never;
    const v2 = new ProChainV2Build('isolated-test-only');
    const diag = new BuildDiagnostics();
    v2.attachReport((l) => diag.record(l));
    diag.setProChainV2(v2.summary);
    const used: Array<[string, string[]]> = [];
    const billed: Array<[string, number, string | undefined]> = [];
    const runner = buildTurnRunner({
      tier: 'weak', noClaude: true, surplusSession,
      surplusPreWriteFailOpen: { state: { dropped: false }, userFilesWritten: () => 0, proChainV2: v2 },
      onProviderUsed: (u, f) => used.push([u, f]),
      onTurnComplete: (u, usage, model) => billed.push([u, usage.inputTokens, model]),
    });
    // The request is under the Surplus-only guard, exactly like an admitted build: the tail must still run.
    const res = await runWithSurplusBuild(false, async () => { activateSurplusBuildForCurrentRequest(true); return runner.runTurn({ model: 'claude', messages: [{ role: 'user', content: 'build' }], tools: [{ name: 'write_file', description: 'w', input_schema: { type: 'object', properties: {} } }] }); });
    expect(surplusCalls).toHaveLength(1);
    expect(res.toolUses[0]).toMatchObject({ name: 'write_file', input: { path: 'App.tsx' } });
    expect(urls.some((u) => u === 'https://api.qubax.ai/v1/chat/completions')).toBe(true);
    expect(urls.some((u) => u === 'https://mitrify.com/v1/chat/completions')).toBe(true);
    expect(used.at(-1)).toEqual(['ENGINE_MF', ['ENGINE_QX']]);
    expect(billed).toEqual([['ENGINE_MF', 100, 'glm-5.3']]);
    const report = diag.report();
    const snap = report.proChainV2;
    expect(snap.reason).toBe('isolated-test-only');
    expect(snap.surplusDrops).toBe(1);
    expect(snap.agents['builder#1']).toEqual({ ENGINE_MF: 1 });
    expect(snap.failedCalls).toEqual({ ENGINE_QX: 1 });
    expect(snap.rateSources['ENGINE_MF:glm-5.3']).toBe('estimated');
    const adminText = JSON.stringify(report);
    expect(adminText).toContain('status=429');
    expect(adminText).not.toContain('WIRINGSECRET');
    // The user never sees a supplier, a model, or the routing detail.
    const userText = JSON.stringify(userFacingReport(report));
    expect(userText).not.toMatch(/qubax|mitrify|ENGINE_QX|ENGINE_MF|router one|glm-5/i);
    expect(userText).not.toContain('proChainV2');
  });

  it('nothing configured after Surplus ⇒ an honest, supplier-free error', async () => {
    delete process.env.QUBAX_API_KEY; delete process.env.MITRIFY_API_KEY;
    const runner = buildTurnRunner({ tier: 'weak', noClaude: true, surplusPreWriteFailOpen: hooksFor('z@gmail.com') });
    await expect(runner.runTurn({ model: 'claude', messages: [] })).rejects.toThrow(PRO_CHAIN_V2_NO_ENGINE);
    expect(PRO_CHAIN_V2_NO_ENGINE).not.toMatch(/surplus|router|qubax|mitrify|glm|kimi/i);
  });

  it('supplier names in a thrown error become neutral labels; status and rate-limit words survive', () => {
    const e = Object.assign(new Error('Mitrify: rate limit exceeded (qubax.ai upstream)'), { status: 429 });
    neutraliseSupplierNames(e);
    expect(e.message).toBe('ENGINE_MF: rate limit exceeded (ENGINE_QX upstream)');
    expect(e.status).toBe(429);
  });
});

describe('secrets and brand on the failure path', () => {
  it('every engine fails: the thrown error names no supplier, and no key (even an unshaped one) reaches the report', async () => {
    process.env.QUBAX_API_KEY = 'plainkeyqx77';           // no recognisable key shape: only exact-value redaction can catch it
    process.env.MITRIFY_API_KEY = 'plainkeymf88';
    process.env.MITRIFY_BUILDER_MODEL = 'glm-5.3';
    process.env.QUBAX_BUILDER_MODELS = 'glm-5.3';
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const body = url.includes('qubax') ? { error: { message: 'Qubax rejected key plainkeyqx77' } } : { error: { message: 'Mitrify rejected key plainkeymf88', source: 'mitrify' } };
      return new Response(JSON.stringify(body), { status: url.endsWith('/models') ? 503 : 400, headers: { 'content-type': 'application/json' } });
    }));
    const v2 = new ProChainV2Build('isolated-test-only');
    const diag = new BuildDiagnostics();
    v2.attachReport((l) => diag.record(l));
    diag.setProChainV2(v2.summary);
    const runner = buildTurnRunner({ tier: 'weak', noClaude: true, surplusPreWriteFailOpen: { state: { dropped: false }, userFilesWritten: () => 0, proChainV2: v2 } });
    let thrown: unknown;
    try { await runner.runTurn({ model: 'claude', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toMatch(/qubax|mitrify/i);
    const admin = JSON.stringify(diag.report());
    expect(admin).toContain('PRO_CHAIN_V2_CALL_FAILED');
    expect(admin).not.toMatch(/plainkeyqx77|plainkeymf88/);
  });
});

describe('source guards', () => {
  it('the AI-chat Qubax/Mitrify files are not imported by the builder chain (written from zero)', () => {
    const dir = resolve(__dirname, '../src/server/AgentV3/proChainV2');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const code = stripCodeComments(readFileSync(resolve(dir, f), 'utf8'));
      expect(code, f).not.toMatch(/from '[^']*lib\/(qubax|qubaxSelector|qubaxPriceFeed|qubaxMarket|mitrify)'/);
      expect(code, f).not.toMatch(/mitrifyTransport|FreeChain|fixedTextChain/);
    }
  });
  it('Router One is called only through its existing builder entry point, and its accounting files are not edited by v2', () => {
    const route = stripCodeComments(readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8'));
    const fn = route.slice(route.indexOf('function proChainV2TurnRunner'), route.indexOf('export function proChainV2ForBuild'));
    expect(fn).toContain('openAiCompatRunners(ROUTER_ONE_LABEL');
    expect(fn).toContain('routerOneWeakFallbackEnabled()');
  });
  it('every PRO_CHAIN_V2_* code (and its user-facing ENGINE_ROUTING fold) is our routing, never a finding about the app', () => {
    const files = [resolve(__dirname, '../src/server/routes/agentv3.ts'),
      ...readdirSync(resolve(__dirname, '../src/server/AgentV3/proChainV2')).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts')).map((x) => resolve(__dirname, '../src/server/AgentV3/proChainV2', x))];
    const codes = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/code: '(PRO_CHAIN_V2_[A-Z_]+)'/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThanOrEqual(10);
    for (const c of [...codes, 'ENGINE_ROUTING']) {
      expect(PROCESS_ONLY_CODES.has(c), c).toBe(true);
      expect(isAppFinding({ ts: 0, phase: 'provider', severity: 'warning', code: c, message: 'x', autoResolved: true }), c).toBe(false);
    }
  });
});
