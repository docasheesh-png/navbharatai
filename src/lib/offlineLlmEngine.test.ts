import { describe, it, expect, beforeEach } from 'vitest';
import { loadOfflineLlm, resetOfflineLlm, STAGE1_MODEL, STAGE1_MODELS, type EngineFactory } from './offlineLlmEngine';

// A fake web-llm engine so the wrapper's control flow is testable without WebGPU/GPU.
function fakeFactory(reply = 'hello from device'): { factory: EngineFactory; calls: string[]; progressSeen: number[] } {
  const calls: string[] = [];
  const progressSeen: number[] = [];
  const factory: EngineFactory = async (modelId, onProgress) => {
    calls.push(modelId);
    onProgress({ progress: 0.5, text: 'loading' } as any);
    return {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: reply } }] }) } },
      unload: async () => { calls.push('unloaded'); },
    } as any;
  };
  return { factory, calls, progressSeen };
}

describe('offlineLlmEngine — wrapper control flow (real WebGPU run verified on-device)', () => {
  beforeEach(() => resetOfflineLlm());

  it('loads via the injected factory with the default model and generates the reply text', async () => {
    const f = fakeFactory('42 is the answer');
    let progress = 0;
    const llm = await loadOfflineLlm({ factory: f.factory, onProgress: (p) => { progress = p.progress; } });
    expect(f.calls[0]).toBe(STAGE1_MODEL);
    expect(progress).toBe(0.5);
    expect(await llm.generate([{ role: 'user', content: 'hi' }])).toBe('42 is the answer');
  });

  it('caches the engine — a second load does not re-create it', async () => {
    const f = fakeFactory();
    await loadOfflineLlm({ factory: f.factory });
    await loadOfflineLlm({ factory: f.factory });
    expect(f.calls.filter((c) => c === STAGE1_MODEL).length).toBe(1);
  });

  it('honors a custom model id', async () => {
    const f = fakeFactory();
    await loadOfflineLlm({ modelId: 'Custom-Model-XYZ', factory: f.factory });
    expect(f.calls[0]).toBe('Custom-Model-XYZ');
  });

  it('unload frees the engine and clears the cache (next load re-creates)', async () => {
    const f = fakeFactory();
    const llm = await loadOfflineLlm({ factory: f.factory });
    await llm.unload();
    expect(f.calls).toContain('unloaded');
    await loadOfflineLlm({ factory: f.factory });
    expect(f.calls.filter((c) => c === STAGE1_MODEL).length).toBe(2); // re-created after unload
  });

  it('a failed init clears the cache so the user can retry (no stuck broken engine)', async () => {
    let attempt = 0;
    const flaky: EngineFactory = async () => {
      attempt++;
      if (attempt === 1) throw new Error('WebGPU init failed');
      return { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } } } as any;
    };
    // Pin a single modelId so the fallback ladder can't mask the failure.
    await expect(loadOfflineLlm({ modelId: 'M', factory: flaky })).rejects.toThrow(/init failed/i);
    // retry succeeds because the failed promise was not cached
    const llm = await loadOfflineLlm({ modelId: 'M', factory: flaky });
    expect(await llm.generate([{ role: 'user', content: 'x' }])).toBe('ok');
  });

  it('falls back to the lighter model when the primary fails to load on a weak device', async () => {
    const tried: string[] = [];
    const factory: EngineFactory = async (id) => {
      tried.push(id);
      if (id === STAGE1_MODEL) throw new Error('OOM on primary'); // weak device: primary won't init
      return { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'from fallback' } }] }) } } } as any;
    };
    const llm = await loadOfflineLlm({ factory });
    expect(tried).toEqual(STAGE1_MODELS);       // tried primary, then fell back to the lighter one
    expect(await llm.generate([{ role: 'user', content: 'x' }])).toBe('from fallback');
  });

  it('the ladder is real ids (primary first) — used when no explicit model is given', () => {
    expect(STAGE1_MODELS[0]).toBe(STAGE1_MODEL);
    expect(STAGE1_MODELS.length).toBeGreaterThanOrEqual(2);
    expect(STAGE1_MODELS.every((m) => m.endsWith('-MLC'))).toBe(true);
  });
});
