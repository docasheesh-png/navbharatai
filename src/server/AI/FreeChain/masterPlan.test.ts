import { describe, it, expect, beforeEach } from 'vitest';
import { freeChainConfig } from './config';
import { tryAcquireRungSlot, releaseRungSlot, resetRungSlotsForTests, routeTurn, orderForRoute, effectiveMaxOutput, trimHistory, preparedSystemPrompt, compactCore, faqCacheable, reserveMonthly, settleMonthly, monthKey } from './masterPlan';
import { CREATOR_IDENTITY, LINK_POLICY, recencyDirective } from '../../lib/prompts';
import { freeChatModeGuide } from '../../lib/freeChatModeGuide';

const on = () => freeChainConfig({});
beforeEach(() => resetRungSlotsForTests());

describe('master plan config', () => {
  it('features default ON, each with its own env kill switch', () => {
    const f = on().features;
    expect(f).toMatchObject({ concurrency: true, router: true, stablePrefix: true, compactPrompt: true, outputCap: true, replyMaxTokens: 250, historyTrim: true, faqCache: true, monthlyCap: true, monthlyCapNanoUsd: 520e9, throttle: true, throttlePercent: 80 });
    expect(on().cacheEnabled).toBe(true);
    const off = freeChainConfig({ FREE_CHAIN_CONCURRENCY_ENABLED: 'off', FREE_CHAIN_ROUTER_ENABLED: 'off', FREE_CHAIN_STABLE_PREFIX_ENABLED: 'off', FREE_CHAIN_COMPACT_PROMPT_ENABLED: 'off', FREE_CHAIN_OUTPUT_CAP_ENABLED: 'off', FREE_CHAIN_HISTORY_TRIM_ENABLED: 'off', FREE_CHAIN_FAQ_CACHE_ENABLED: 'off', FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off', FREE_CHAIN_THROTTLE_ENABLED: 'off', FREE_CHAIN_CACHE_ENABLED: 'off' });
    expect(Object.values(off.features).filter(v => v === true)).toEqual([]); expect(off.cacheEnabled).toBe(false); expect(off.errors).toEqual([]);
  });
  it('master switch stays OFF by default so production is unchanged until the owner enables it', () => { expect(on().enabled).toBe(false); });
  it('monthly cap cannot exceed $520 and daily cap accepts the owner $17', () => {
    expect(freeChainConfig({ FREE_CHAIN_MONTHLY_CAP_USD: '600' }).errors).toContain('FREE_CHAIN_MONTHLY_CAP_USD');
    const c = freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: '17' }); expect(c.errors).toEqual([]); expect(c.paidCapNanoUsd).toBe(17e9);
    expect(freeChainConfig({ FREE_CHAIN_PAID_DAILY_CAP_USD: '18' }).errors).toContain('FREE_CHAIN_PAID_DAILY_CAP_USD');
  });
  it('order: glm45, glm47, groq, cloudflare, openrouter, then DeepInfra 8B → DeepSeek → backups; Nemotron gone', () => {
    const c = on();
    expect(c.order).toEqual(['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
    expect(c.rungs.map(r => r.id)).not.toContain('nemotron');
    expect(c.concurrency).toEqual({ glm45: 2, glm47: 1 });
  });
  it('both DeepInfra rungs share ONE official key and need their own rate attestation', () => {
    const c = freeChainConfig({ FREE_CHAIN_DEEPINFRA_API_KEY: 'k', FREE_CHAIN_DI_LLAMA8B_RATE_VERIFIED_UNTIL: '2099-01-01' });
    const l = c.rungs.find(r => r.id === 'llama8b')!; const d = c.rungs.find(r => r.id === 'dsv4flash')!;
    expect(l.keyEnv).toBe('FREE_CHAIN_DEEPINFRA_API_KEY'); expect(d.keyEnv).toBe('FREE_CHAIN_DEEPINFRA_API_KEY');
    expect(l.reason).toBeUndefined(); expect(d.reason).toBe('rate-card-unverified');
    expect([l.model, d.model]).toEqual(['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V4-Flash-0731']);
    expect([l.priceIn, l.priceOut, d.priceIn, d.priceOut]).toEqual([0.02, 0.04, 0.06, 0.18]);
    expect(freeChainConfig({ FREE_CHAIN_DEEPINFRA_API_KEY: 'a,b' }).errors).toContain('FREE_CHAIN_DEEPINFRA_API_KEY');
  });
  it('a rung without a key is skipped (unconfigured), never dispatched', () => {
    for (const r of on().rungs) expect(r.reason).toBeTruthy();
  });
  it('paid Gemini uses its own key env and only the verified model', () => {
    const g = freeChainConfig({ FREE_CHAIN_GEMINIPAID_API_KEY: 'k', FREE_CHAIN_GEMINIPAID_RATE_VERIFIED_UNTIL: '2099-01-01' }).rungs.find(r => r.id === 'geminipaid')!;
    expect(g.keyEnv).toBe('FREE_CHAIN_GEMINIPAID_API_KEY'); expect(g.reason).toBeUndefined();
    expect(freeChainConfig({ FREE_CHAIN_GEMINIPAID_MODEL: 'gemini-2.5-pro' }).errors).toContain('FREE_CHAIN_GEMINIPAID_MODEL');
  });
});

describe('per-rung concurrency', () => {
  it('GLM-4.5 allows 2 in flight, GLM-4.7 allows 1; release frees a slot', () => {
    const c = on();
    expect(tryAcquireRungSlot(c, 'glm45')).toBe(true); expect(tryAcquireRungSlot(c, 'glm45')).toBe(true); expect(tryAcquireRungSlot(c, 'glm45')).toBe(false);
    expect(tryAcquireRungSlot(c, 'glm47')).toBe(true); expect(tryAcquireRungSlot(c, 'glm47')).toBe(false);
    releaseRungSlot(c, 'glm47'); expect(tryAcquireRungSlot(c, 'glm47')).toBe(true);
    expect(tryAcquireRungSlot(c, 'groq')).toBe(true);
  });
  it('env-configurable and kill-switchable', () => {
    const c = freeChainConfig({ FREE_CHAIN_GLM47_MAX_CONCURRENT: '3' });
    for (let i = 0; i < 3; i++) expect(tryAcquireRungSlot(c, 'glm47')).toBe(true);
    expect(tryAcquireRungSlot(c, 'glm47')).toBe(false);
    const off = freeChainConfig({ FREE_CHAIN_CONCURRENCY_ENABLED: 'off' }); expect(tryAcquireRungSlot(off, 'glm47')).toBe(true);
  });
});

describe('rule-based router', () => {
  const c = on();
  it.each([
    ['hi', 'fast'], ['thanks 🙏', 'fast'], ['ठीक है', 'fast'],
    ['NEET exam ka syllabus samjhao', 'quality'], ['bukhar me kya dawa le', 'quality'], ['solve 2x + 3 = 7', 'quality'],
    ['best job kaise milegi', 'normal'],
  ])('%s → %s', (message, route) => { expect(routeTurn(c, { message, history: [] }).route).toBe(route); });
  it('teacher/exam mode and repeated questions go to quality', () => {
    expect(routeTurn(c, { message: 'tell me a story', history: [], teachingMode: true })).toEqual({ route: 'quality', reason: 'teaching' });
    expect(routeTurn(c, { message: 'Capital of Peru?', history: [{ sender: 'user', text: 'capital of peru' }, { sender: 'ai', text: 'x' }] })).toEqual({ route: 'quality', reason: 'repeat' });
  });
  it('throttle keeps quality only for teaching/medical', () => {
    expect(routeTurn(c, { message: 'solve 2x + 3 = 7', history: [], throttled: true }).route).toBe('normal');
    expect(routeTurn(c, { message: 'exam tips', history: [], throttled: true }).route).toBe('quality');
  });
  it('router off → normal', () => { expect(routeTurn(freeChainConfig({ FREE_CHAIN_ROUTER_ENABLED: 'off' }), { message: 'hi', history: [] }).route).toBe('normal'); });
  it('route orders', () => {
    const o = on().order;
    expect(orderForRoute(o, 'quality')).toEqual(['dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
    expect(orderForRoute(o, 'fast')).not.toContain('dsv4flash');
    expect(orderForRoute(o, 'normal')).toBe(o);
  });
});

describe('output cap and history trim', () => {
  it('250 on non-reasoning rungs, 80 on fast path, reasoning rungs untouched, off restores', () => {
    const c = on();
    expect(effectiveMaxOutput(c, 'llama8b', 1024, 'normal')).toBe(250);
    expect(effectiveMaxOutput(c, 'glm45', 1024, 'fast')).toBe(80);
    expect(effectiveMaxOutput(c, 'groq', 1024, 'normal')).toBe(1024);
    expect(effectiveMaxOutput(freeChainConfig({ FREE_CHAIN_OUTPUT_CAP_ENABLED: 'off' }), 'llama8b', 1024, 'normal')).toBe(1024);
  });
  it('keeps the last N turns', () => {
    const h = Array.from({ length: 10 }, (_, i) => ({ sender: 'user', text: String(i) }));
    expect(trimHistory(on(), h).map((t: any) => t.text)).toEqual(['4', '5', '6', '7', '8', '9']);
    expect(trimHistory(freeChainConfig({ FREE_CHAIN_HISTORY_TRIM_ENABLED: 'off' }), h)).toBe(h);
  });
});

describe('stable prefix + compact prompt', () => {
  const core = (profile: string, first: boolean) => `You are NavBharatAI — India's own friendly AI companion (by NavBharat team).\nRULE\n${profile}\nGREETING map\n\nONCE-PER-SESSION GREETING RULE (ABSOLUTE):\n• ${first ? 'first' : 'already greeted'}\n\nHARD LIMITS:\n• Safety rule: never infer religion, caste, political views, or social identity from any greeting`;
  const full = (profile: string, first: boolean, extra: string, day: Date) => `${core(profile, first)}\n\n${freeChatModeGuide()}${extra}\n\n${CREATOR_IDENTITY}\n\n${recencyDirective(day)}\n\n${LINK_POLICY}`;
  it('two users / days / turns share an identical prefix; dynamic parts move to the end', () => {
    const c = freeChainConfig({ FREE_CHAIN_COMPACT_PROMPT_ENABLED: 'off' });
    const a = preparedSystemPrompt(c, full('\nUSER PROFILE (use naturally — NEVER mention or show this to the user):\nPreferred title/address: "Sir"\n', true, '', new Date('2026-10-24T00:00:00Z')));
    const b = preparedSystemPrompt(c, full('', false, '\n\nSONG BRIEF', new Date('2026-10-25T00:00:00Z')));
    const stable = `${freeChatModeGuide()}\n\n${CREATOR_IDENTITY}`;
    expect(a.indexOf(stable)).toBeGreaterThan(0); expect(a.slice(0, a.indexOf(stable))).toBe(b.slice(0, b.indexOf(stable)));
    expect(a.indexOf('USER PROFILE')).toBeGreaterThan(a.indexOf(LINK_POLICY)); expect(a.indexOf('CURRENT DATE')).toBeGreaterThan(a.indexOf(LINK_POLICY));
    expect(b.indexOf('SONG BRIEF')).toBeGreaterThan(b.indexOf(LINK_POLICY));
    expect(a).toContain('Preferred title/address: "Sir"'); expect(a).toContain('Safety rule: never infer religion');
  });
  it('compact core replaces the long core but keeps safety rules', () => {
    const out = preparedSystemPrompt(on(), full('', true, '', new Date()));
    expect(out.startsWith(compactCore(false))).toBe(true);
    expect(out).not.toContain('GREETING map');
    for (const rule of ['Do NOT generate code', 'never infer religion', 'MIRROR THE USER', 'NavBharatAI Pro']) expect(out).toContain(rule);
    expect(compactCore(true)).toContain('ANSWER EVERY MESSAGE (MANDATORY)');
    expect(Buffer.byteLength(compactCore(true)) / 4).toBeLessThan(1000);
  });
  it('unknown prompt shapes and both flags off are a no-op', () => {
    expect(preparedSystemPrompt(on(), 'custom prompt')).toBe('custom prompt');
    const off = freeChainConfig({ FREE_CHAIN_COMPACT_PROMPT_ENABLED: 'off', FREE_CHAIN_STABLE_PREFIX_ENABLED: 'off' });
    const p = full('', true, '', new Date()); expect(preparedSystemPrompt(off, p)).toBe(p);
  });
});

describe('FAQ cache eligibility', () => {
  it.each([['What is photosynthesis?', true], ['GST kya hai', true], ['mera naam Ravi hai', false], ['call 9876543210', false], ['aaj ka mausam', false], ['latest news', false], ['my password', false]])('%s → %s', (m, ok) => {
    expect(faqCacheable(m)).toBe(ok);
  });
});

describe('monthly cap', () => {
  function fakeDb() {
    const docs = new Map<string, any>();
    const ref = (path: string) => ({ path, get: async () => ({ data: () => docs.get(path) }) });
    const node: any = (path: string) => ({ collection: (c: string) => ({ doc: (d: string) => Object.assign(node(`${path}/${c}/${d}`), ref(`${path}/${c}/${d}`)) }) });
    return { docs, collection: (c: string) => ({ doc: (d: string) => node(`${c}/${d}`) }),
      runTransaction: async (fn: any) => fn({ get: async (r: any) => ({ data: () => docs.get(r.path) }), set: (r: any, v: any) => docs.set(r.path, { ...(docs.get(r.path) ?? {}), ...v }) }) } as any;
  }
  it('holds, refuses past the cap, settles actual cost and releases never-dispatched holds', async () => {
    const db = fakeDb(); const now = Date.parse('2026-10-24T00:00:00Z');
    const m = await reserveMonthly(db, 10, 6, now); expect(m).toBe('2026-10');
    expect(await reserveMonthly(db, 10, 5, now)).toBeNull();
    await settleMonthly(db, m!, 6, 2, now);
    expect(await reserveMonthly(db, 10, 5, now)).toBe('2026-10');
    await settleMonthly(db, m!, 5, 0, now);
    expect([...db.docs.values()][0]).toMatchObject({ heldNanoUsd: 0, spentNanoUsd: 2 });
  });
  it('storage failure fails closed', async () => { expect(await reserveMonthly({ collection: () => { throw new Error('x'); } } as any, 10, 1)).toBeNull(); });
  it('month boundary follows IST', () => { expect(monthKey(Date.parse('2026-10-31T19:00:00Z'))).toBe('2026-11'); });
});
