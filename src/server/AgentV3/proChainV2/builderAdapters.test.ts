import { describe, it, expect, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { OpenAiToolRunner, type OpenAiChatClient } from '../providers/OpenAiToolRunner';
import type { NamedRunner } from '../providers/MultiProviderTurnRunner';
import type { ClaudeToolDef, RunTurnParams } from '../ClaudeClient';
import { qubaxBuilderRungs, mitrifyBuilderRungs, estimateTurnTokens, type SupplierCallEvent, type RungFactory } from './builderAdapters';
import { __setQubaxBuilderCatalogForTests, parseQubaxCatalog, qubaxBuilderModels, refreshQubaxBuilderCatalog, qubaxCatalogRate } from './qubaxBuilder';
import { mitrifyBuilderBaseUrl, mitrifyBuilderModels, mitrifyConfiguredRate } from './mitrifyBuilder';
import { redactSecrets } from './redact';

const QX_KEY = 'qbx_live_SECRETSECRETSECRET123';
const MF_KEY = 'mtf_live_SECRETSECRETSECRET456';
const TOOLS: ClaudeToolDef[] = [{ name: 'write_file', description: 'Write', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } }];
const PARAMS: RunTurnParams = { model: 'claude-default', system: 'You build apps.', messages: [{ role: 'user', content: 'make a calculator' }], tools: TOOLS };

type Call = { url: string; body: any; auth: string | null };
/** A fake HTTP supplier: records every request, answers from a script. */
function fakeHttp(script: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init?.headers);
    const call = { url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get('authorization') };
    calls.push(call);
    return script(call);
  }) as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const toolReply = (usage = true) => ({
  id: 'c', object: 'chat.completion', created: 1, model: 'x',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: 'writing', tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_file', arguments: '{"path":"App.tsx","content":"x"}' } }] } }],
  ...(usage ? { usage: { prompt_tokens: 120, completion_tokens: 30 } } : {}),
});

/** The production factory's shape: OpenAI SDK client + the builder's OpenAiToolRunner, one rung per model. */
function factoryWith(f: typeof fetch): RungFactory {
  return (label, apiKey, baseURL, models) => models.map((model): NamedRunner => {
    const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 5_000, fetch: f });
    return { name: label, modelId: model, runner: new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model, timeoutMs: 5_000 }) };
  });
}

beforeEach(() => __setQubaxBuilderCatalogForTests(null));

describe('Qubax builder adapter (from zero — chat files untouched)', () => {
  it('tool-call round trip: Bearer key, model, tools out; tool_use + measured usage back', async () => {
    const http = fakeHttp(() => json(200, toolReply()));
    const events: SupplierCallEvent[] = [];
    const [rung] = qubaxBuilderRungs(factoryWith(http.f), { QUBAX_API_KEY: QX_KEY }, (e) => events.push(e), http.f);
    const res = await rung.runner.runTurn(PARAMS);
    const chat = http.calls.find((c) => c.url.endsWith('/chat/completions'))!;
    expect(chat.url).toBe('https://api.qubax.ai/v1/chat/completions');
    expect(chat.auth).toBe(`Bearer ${QX_KEY}`);
    expect(chat.body.model).toBe('glm-5.3');
    expect(chat.body.tools[0].function.name).toBe('write_file');
    expect(chat.body.tool_choice).toBe('auto');
    expect(res.toolUses).toEqual([{ id: 't1', name: 'write_file', input: { path: 'App.tsx', content: 'x' } }]);
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.measured).toBeUndefined();
    expect(events).toEqual([expect.objectContaining({ provider: 'ENGINE_QX', ok: true, model: 'glm-5.3' })]);
    expect(rung.name).toBe('ENGINE_QX');
  });

  it('429 → the error propagates (so the chain moves on) and the admin fact carries status, never the key', async () => {
    const http = fakeHttp(() => json(429, { error: { message: `rate limited for key ${QX_KEY}`, code: 'rate_limit' } }));
    const events: SupplierCallEvent[] = [];
    const [rung] = qubaxBuilderRungs(factoryWith(http.f), { QUBAX_API_KEY: QX_KEY }, (e) => events.push(e), http.f);
    await expect(rung.runner.runTurn(PARAMS)).rejects.toBeTruthy();
    const e = events[0];
    expect(e).toMatchObject({ provider: 'ENGINE_QX', ok: false, status: 429 });
    expect(JSON.stringify(events)).not.toContain(QX_KEY);
    expect(JSON.stringify(events)).not.toContain('SECRETSECRET');
  });

  it('timeout → error propagates and is recorded as a failed call', async () => {
    const http = fakeHttp((call) => new Promise<Response>((_r, reject) => setTimeout(() => reject(Object.assign(new Error('Request timed out.'), { name: 'TimeoutError' })), 5)));
    const events: SupplierCallEvent[] = [];
    const [rung] = qubaxBuilderRungs(factoryWith(http.f), { QUBAX_API_KEY: QX_KEY }, (e) => events.push(e), http.f);
    await expect(rung.runner.runTurn(PARAMS)).rejects.toBeTruthy();
    expect(events[0]).toMatchObject({ ok: false });
  });

  it('no usage returned → tokens ESTIMATED (never a silent ₹0) and labelled', async () => {
    const http = fakeHttp(() => json(200, toolReply(false)));
    const events: SupplierCallEvent[] = [];
    const [rung] = qubaxBuilderRungs(factoryWith(http.f), { QUBAX_API_KEY: QX_KEY }, (e) => events.push(e), http.f);
    const res = await rung.runner.runTurn(PARAMS);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.usage.measured).toBeUndefined();
    expect(events[0]).toMatchObject({ ok: true, usageEstimated: true });
  });

  it('not configured / switched off ⇒ no rung at all', () => {
    const f = fakeHttp(() => json(200, {})).f;
    expect(qubaxBuilderRungs(factoryWith(f), {}, undefined, f)).toEqual([]);
    expect(qubaxBuilderRungs(factoryWith(f), { QUBAX_API_KEY: QX_KEY, PRO_CHAIN_V2_QUBAX: 'off' }, undefined, f)).toEqual([]);
  });

  it('catalogue: keeps only tool-capable ready models, reads per-token price as USD/MTok, keeps last good on failure', async () => {
    const body = { data: [
      { id: 'glm-5.3', is_ready: true, context_length: 1_000_000, max_output_length: 131072, capabilities: { tools: true }, pricing: [{ label: 'token', prompt: '0.000000009', completion: '0.00000015662', input_cache_read: '0.000000001' }] },
      { id: 'kimi-k2.7-code', is_ready: true, context_length: 262144, capabilities: { tools: false }, pricing: [{ label: 'token', prompt: '0.0000000247', completion: '0.0000000989' }] },
      { id: 'glm-5.2', is_ready: false, context_length: 1_000_000, capabilities: { tools: true }, pricing: [] },
      { id: 'free-zero', is_ready: true, context_length: 200000, capabilities: { tools: true }, pricing: [{ label: 'token', prompt: '0', completion: '0' }] },
    ] };
    const ok = fakeHttp(() => json(200, body));
    await refreshQubaxBuilderCatalog(ok.f, Date.now(), true);
    expect(ok.calls[0].url).toBe('https://api.qubax.ai/v1/models');
    expect(ok.calls[0].auth).toBeNull(); // public GET, no key sent
    expect(qubaxBuilderModels({}).models).toEqual(['glm-5.3']);
    const r = qubaxCatalogRate('glm-5.3')!;
    expect(r.inputPerMTok).toBeCloseTo(0.009, 9);
    expect(r.outputPerMTok).toBeCloseTo(0.15662, 9);
    expect(r.cacheReadPerMTok).toBeCloseTo(0.001, 9);
    expect(qubaxCatalogRate('free-zero')).toBeUndefined(); // 0/0 is not trusted as "free"
    await refreshQubaxBuilderCatalog(fakeHttp(() => json(500, {})).f, Date.now(), true);
    expect(qubaxCatalogRate('glm-5.3')).toBeDefined();
    expect(parseQubaxCatalog({ nope: 1 }).size).toBe(0);
    expect(qubaxBuilderModels({ QUBAX_BUILDER_MODELS: 'kimi-k2.7-code' }).models).toEqual(['kimi-k2.7-code']); // all rejected ⇒ configured, unverified
  });
});

describe('Mitrify builder adapter (from zero — chat files untouched)', () => {
  it('tool-call round trip against the configured base URL and model', async () => {
    const http = fakeHttp(() => json(200, toolReply()));
    const events: SupplierCallEvent[] = [];
    const env = { MITRIFY_API_KEY: MF_KEY, MITRIFY_BUILDER_MODEL: 'glm-5.3' };
    const [rung] = mitrifyBuilderRungs(factoryWith(http.f), env, (e) => events.push(e));
    const res = await rung.runner.runTurn(PARAMS);
    expect(http.calls[0].url).toBe('https://mitrify.com/v1/chat/completions');
    expect(http.calls[0].auth).toBe(`Bearer ${MF_KEY}`);
    expect(http.calls[0].body.model).toBe('glm-5.3');
    expect(http.calls[0].body.tools).toHaveLength(1);
    expect(res.toolUses[0].name).toBe('write_file');
    expect(events[0]).toMatchObject({ provider: 'ENGINE_MF', ok: true });
  });
  it('error path is redacted; no key ⇒ no rung; base URL must be https', async () => {
    const http = fakeHttp(() => json(500, { error: { message: `upstream died Authorization: Bearer ${MF_KEY}` } }));
    const events: SupplierCallEvent[] = [];
    const [rung] = mitrifyBuilderRungs(factoryWith(http.f), { MITRIFY_API_KEY: MF_KEY }, (e) => events.push(e));
    await expect(rung.runner.runTurn(PARAMS)).rejects.toBeTruthy();
    expect(events[0]).toMatchObject({ ok: false, status: 500 });
    expect(JSON.stringify(events)).not.toContain('SECRETSECRET');
    expect(mitrifyBuilderRungs(factoryWith(http.f), {})).toEqual([]);
    expect(mitrifyBuilderBaseUrl({ MITRIFY_BASE_URL: 'http://evil.example/v1' })).toBe('https://mitrify.com/v1');
    expect(mitrifyBuilderModels({})).toEqual(['mitrify/auto-cheap']);
    expect(mitrifyBuilderModels({ MITRIFY_MODEL: 'a' })).toEqual(['a']);
    expect(mitrifyConfiguredRate({ MITRIFY_BUILDER_RATE_IN: '0.2', MITRIFY_BUILDER_RATE_OUT: '0.6' })).toEqual({ inputPerMTok: 0.2, outputPerMTok: 0.6 });
    expect(mitrifyConfiguredRate({ MITRIFY_BUILDER_RATE_IN: '0.2' })).toBeUndefined();
  });
});

describe('helpers', () => {
  it('estimate is ~4 chars/token and never 0', () => {
    const est = estimateTurnTokens(PARAMS, { text: '', toolUses: [], stopReason: null, usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [] });
    expect(est.inputTokens).toBeGreaterThan(10);
    expect(est.outputTokens).toBe(1);
  });
  it('redaction removes configured keys and credential shapes', () => {
    const out = redactSecrets(`key=${QX_KEY} Bearer abcdefghijklmnop sk-1234567890abcdef ok`, [QX_KEY]);
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).not.toContain('sk-1234567890');
    expect(out).toContain('ok');
  });
});
