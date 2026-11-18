/** Traffic Manager V2, P8/P9: vision and image generation obey drain/disable only when their path is covered. */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';
import { drawWithNavBharat } from '../../lib/navbharatImageEngine';
import { familyOfEngineName, IMAGE_ENGINE_FAMILY, legacyPathAllows } from './legacyControl';
import { __resetTrafficControlSyncForTests, adoptTrafficControl } from './controlSync';
import type { ControlDoc } from './controlTypes';

const families = new Set(PROVIDER_FAMILIES.map(f => f.id));
const doc = (over: Partial<ControlDoc>): ControlDoc => ({ global: { gateway: 'on' }, surfaces: {}, providers: {}, models: {}, revision: 1, updatedAtMs: 1, actor: 'a', reason: 'r', ...over });
afterEach(() => __resetTrafficControlSyncForTests());

describe('census', () => {
  it('every vision provider label maps to a kill-switch family', () => {
    for (const p of ['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE']) {
      const f = familyOfEngineName(p); expect(f, p).not.toBeNull(); expect(families.has(f!), `${p} → ${f}`).toBe(true);
    }
  });
  it('every image engine maps to a kill-switch family', () => {
    for (const [e, f] of Object.entries(IMAGE_ENGINE_FAMILY)) expect(families.has(f), `${e} → ${f}`).toBe(true);
  });
  it('the vision loop asks, next to its health skip', () => {
    expect(readFileSync('src/server/lib/visionChain.ts', 'utf8')).toMatch(/shouldSkipProvider\(provider\)\) continue;[\s\S]{0,300}legacyPathAllows\('vision', familyOfEngineName\(provider\)\)\) continue;/);
  });
});

describe('image generation: skip only, off by default', () => {
  const env = { POLLINATIONS_API_KEY: 'pk_test', GROK_API_KEY: 'xai-test' } as unknown as NodeJS.ProcessEnv;
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => { calls.push(String(url)); return new Response('{}', { status: 500 }); }) as unknown as typeof fetch;
  it('coverage off: a disabled engine is still tried (today\'s behaviour)', async () => {
    calls.length = 0;
    adoptTrafficControl(doc({ providers: { pollinations: { state: 'disabled', trafficCapPct: 100 } } }));
    await drawWithNavBharat('a red apple', { w: 512, h: 512 }, { env, fetchImpl, timeoutMs: 1000 });
    expect(calls.some(u => /pollinations/.test(u))).toBe(true);
  });
  it('coverage on: the disabled engine is skipped and the next one is tried', async () => {
    calls.length = 0;
    adoptTrafficControl(doc({ revision: 2, providers: { pollinations: { state: 'disabled', trafficCapPct: 100 } }, coverage: { image: true } }));
    await drawWithNavBharat('a red apple', { w: 512, h: 512 }, { env, fetchImpl, timeoutMs: 1000 });
    expect(calls.some(u => /pollinations/.test(u))).toBe(false);
    expect(calls.some(u => /api\.x\.ai/.test(u))).toBe(true);
  });
  it('coverage of one path never covers another', () => {
    const d = doc({ providers: { xai: { state: 'disabled', trafficCapPct: 100 } }, coverage: { image: true } });
    expect(legacyPathAllows('image', 'xai', d)).toBe(false);
    expect(legacyPathAllows('vision', 'xai', d)).toBe(true);
    expect(legacyPathAllows('chat-router', 'xai', d)).toBe(true);
  });
});
