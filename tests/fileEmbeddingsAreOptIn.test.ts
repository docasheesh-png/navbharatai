// A PROVIDER CREDENTIAL IS NOT A FEATURE SWITCH.
//
// Found 2026-09-15, on the day the admin bought an OpenAI key and asked only what to name it in
// Cloud Run. Setting `OPENAI_API_KEY` alone would have started a spend nobody could see:
// `ToolDispatcher` calls `EmbeddingStore.addFile()` on every write, every batched file and every
// edit, so a normal build fires dozens of embedding calls — on every tier, free included, on
// NavBharatAI's own account, through the OpenAI SDK directly and therefore in NO build ledger, no
// rate card, and invisible to the mid-build cost ceiling. And `search()`, the only thing that reads
// the index back, is called from no live code path — so the spend bought nothing at all.
//
// These tests pin the fix: BOTH the flag and the key are required, and the flag is checked FIRST.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmbeddingStore, fileEmbeddingsEnabled } from '../src/server/AgentV3/EmbeddingSearch';

const FLAG = 'AGENTV3_FILE_EMBEDDINGS';
const FAKE_KEY = 'sk-not-a-real-key-and-must-never-be-used';

describe('file embeddings are OPT-IN — the key alone must not spend', () => {
  const prior = process.env[FLAG];
  beforeEach(() => { delete process.env[FLAG]; });
  afterEach(() => { if (prior === undefined) delete process.env[FLAG]; else process.env[FLAG] = prior; });

  it('is OFF when the flag is unset — an opt-in feature defaults to costing nothing', () => {
    expect(fileEmbeddingsEnabled()).toBe(false);
  });

  it('a key with the flag unset embeds nothing', async () => {
    const s = new EmbeddingStore(FAKE_KEY);
    expect(await s.embed('anything')).toBeNull();
  });

  it('a key with the flag unset indexes nothing — addFile stays a no-op', async () => {
    const s = new EmbeddingStore(FAKE_KEY);
    await s.addFile('src/App.tsx', 'export function App() {}');
    expect(s.size).toBe(0);
  });

  it('a key with the flag explicitly OFF embeds nothing', async () => {
    process.env[FLAG] = 'off';
    const s = new EmbeddingStore(FAKE_KEY);
    expect(await s.embed('anything')).toBeNull();
    expect(fileEmbeddingsEnabled()).toBe(false);
  });

  it('the flag ON with NO key still embeds nothing — both are required', async () => {
    process.env[FLAG] = 'on';
    expect(fileEmbeddingsEnabled()).toBe(true);
    const s = new EmbeddingStore('');
    expect(await s.embed('anything')).toBeNull();
    await s.addFile('src/App.tsx', 'export const x = 1;');
    expect(s.size).toBe(0);
  });

  it('reads every dialect the shared env parser accepts, not just "on"', () => {
    for (const on of ['on', 'ON', ' true ', '1', 'yes', 'enabled']) {
      process.env[FLAG] = on;
      expect(fileEmbeddingsEnabled(), `"${on}" should mean ON`).toBe(true);
    }
    for (const off of ['off', 'OFF', 'false', '0', 'no', 'disabled']) {
      process.env[FLAG] = off;
      expect(fileEmbeddingsEnabled(), `"${off}" should mean OFF`).toBe(false);
    }
  });

  it('an unreadable value means OFF, never ON — a typo must not start a spend', () => {
    process.env[FLAG] = 'ture';
    expect(fileEmbeddingsEnabled()).toBe(false);
  });

  it('is read at CALL time, so switching it in Cloud Run bites without a restart', () => {
    process.env[FLAG] = 'on';
    expect(fileEmbeddingsEnabled()).toBe(true);
    process.env[FLAG] = 'off';
    expect(fileEmbeddingsEnabled()).toBe(false);
  });
});

// THE REVERSION GUARD. The behavioural tests above would still pass if the flag line were deleted
// (a real API call with a fake key fails and is caught, returning null either way) — so the order
// itself is asserted from the source. Comments are stripped first: a guard that can be satisfied by
// its own documentation is not a guard.
describe('the flag is checked BEFORE the key, in the source', () => {
  it('getClient consults fileEmbeddingsEnabled() ahead of the apiKey check', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/EmbeddingSearch.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const body = src.slice(src.indexOf('private async getClient('));
    expect(body).toContain('getClient(');
    const flagAt = body.indexOf('fileEmbeddingsEnabled()');
    const keyAt = body.indexOf('this.apiKey');
    expect(flagAt, 'getClient must consult the flag').toBeGreaterThan(-1);
    expect(keyAt, 'getClient must still consult the key').toBeGreaterThan(-1);
    expect(flagAt, 'the flag must be checked before the key').toBeLessThan(keyAt);
  });
});
