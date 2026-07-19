import { describe, it, expect, beforeEach } from 'vitest';
import { loadOfflineLlm, resetOfflineLlm, STAGE1_MODEL, type EngineFactory } from './offlineLlmEngine';

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
    await expect(loadOfflineLlm({ factory: flaky })).rejects.toThrow(/init failed/i);
    // retry succeeds because the failed promise was not cached
    const llm = await loadOfflineLlm({ factory: flaky });
    expect(await llm.generate([{ role: 'user', content: 'x' }])).toBe('ok');
  });
});
