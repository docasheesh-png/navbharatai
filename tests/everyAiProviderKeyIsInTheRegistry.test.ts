import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_FAMILIES } from '../src/server/lib/providerSwitches';

/**
 * Admin 2026-11-16: "ENV_REGISTRY.md me jo AI provider darj hain, aur NavBharatAI me jo use ho rahe hain — sab match hai?
 * Kahi kuch chhut gaya ho?" The audit found every provider family named but ten of their key names missing, including
 * BEDROCK_API_KEY (a live builder rung). This census keeps the registry complete: a provider family, or a new key
 * name on an existing one, cannot be added to the switch board without its name in docs/claude/ENV_REGISTRY.md.
 */
describe('every AI provider key the app reads is named in the env registry', () => {
  const registry = readFileSync('docs/claude/ENV_REGISTRY.md', 'utf8');

  it('names every PROVIDER_FAMILIES key (a regex key by its prefix)', () => {
    const missing: string[] = [];
    for (const family of PROVIDER_FAMILIES) {
      for (const key of family.keys) {
        const name = typeof key === 'string' ? key : key.source.replace(/^\^/, '').replace(/[^A-Z0-9_].*$/, '');
        if (!name || !registry.includes(name)) missing.push(`${family.id}: ${name || String(key)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('names every provider family', () => {
    const unnamed = PROVIDER_FAMILIES.filter(f => !registry.toLowerCase().includes(f.name.split(/[ /]/)[0].toLowerCase())).map(f => f.id);
    expect(unnamed).toEqual([]);
  });
});

describe('switching Gemini off withdraws every name the app reads a Gemini key from (2026-11-16 census)', () => {
  it('includes GOOGLE_API_KEY, which GeminiProvider, aiClients, imageEditRun and embeddings read', async () => {
    const { applySwitchedOff, providerHasKey, __resetProviderSwitchesForTests } = await import('../src/server/lib/providerSwitches');
    const env = { GOOGLE_API_KEY: 'synthetic-google-key' } as NodeJS.ProcessEnv;
    __resetProviderSwitchesForTests(env);
    expect(providerHasKey('gemini', env)).toBe(true);
    applySwitchedOff(['gemini'], env);
    expect(env.GOOGLE_API_KEY).toBeUndefined();
    applySwitchedOff([], env);
    expect(env.GOOGLE_API_KEY).toBe('synthetic-google-key');
    __resetProviderSwitchesForTests(env);
  });
});
