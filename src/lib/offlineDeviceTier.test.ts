import { describe, it, expect } from 'vitest';
import { recommendTier, hasWebGpu, probeDevice, TIER_INFO, type DeviceSignals } from './offlineDeviceTier';

describe('offlineDeviceTier — honest device capability → model tier', () => {
  it('no WebGPU → tier 0, unsupported (deterministic chat still works)', () => {
    const r = recommendTier({ webgpu: false, ramGB: 16 });
    expect(r.tier).toBe(0);
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/webgpu/i);
  });

  it('picks the tier by RAM when WebGPU is present', () => {
    expect(recommendTier({ webgpu: true, ramGB: 8 }).tier).toBe(3);
    expect(recommendTier({ webgpu: true, ramGB: 6 }).tier).toBe(2);
    expect(recommendTier({ webgpu: true, ramGB: 4 }).tier).toBe(1);
    expect(recommendTier({ webgpu: true, ramGB: 3 }).tier).toBe(0); // too little RAM
    expect(recommendTier({ webgpu: true, ramGB: 3 }).supported).toBe(false);
  });

  it('falls back to CPU cores when RAM is unknown (but WebGPU is present)', () => {
    expect(recommendTier({ webgpu: true, cores: 8 }).tier).toBe(2);
    expect(recommendTier({ webgpu: true, cores: 4 }).tier).toBe(1);
    expect(recommendTier({ webgpu: true }).tier).toBe(1); // WebGPU but nothing else known → cautious tier 1
  });

  it('steps the tier down when free storage cannot hold the model', () => {
    // 8 GB RAM would be tier 3 (~2000 MB), but only ~0.6 GB free → must drop to tier 1 (~400 MB) or 0.
    const r = recommendTier({ webgpu: true, ramGB: 8, storageFreeGB: 0.6 });
    expect(r.tier).toBeLessThan(3);
    // essentially no free space → unsupported
    expect(recommendTier({ webgpu: true, ramGB: 8, storageFreeGB: 0.1 }).tier).toBe(0);
    // plenty of storage keeps the RAM-based tier
    expect(recommendTier({ webgpu: true, ramGB: 8, storageFreeGB: 10 }).tier).toBe(3);
  });

  it('every tier has honest size/RAM metadata; tier 0 is free', () => {
    expect(TIER_INFO[0].approxDownloadMB).toBe(0);
    for (const t of [1, 2, 3] as const) {
      expect(TIER_INFO[t].approxDownloadMB).toBeGreaterThan(0);
      expect(TIER_INFO[t].minRamGB).toBeGreaterThan(0);
    }
  });

  it('hasWebGpu is guarded — false when absent, true only on a real adapter, never throws', async () => {
    expect(await hasWebGpu({})).toBe(false);
    expect(await hasWebGpu({ gpu: { requestAdapter: async () => null } })).toBe(false);
    expect(await hasWebGpu({ gpu: { requestAdapter: async () => ({}) } })).toBe(true);
    expect(await hasWebGpu({ gpu: { requestAdapter: async () => { throw new Error('boom'); } } })).toBe(false);
  });

  it('probeDevice gathers signals from a navigator-like and degrades gracefully', async () => {
    const nav = {
      gpu: { requestAdapter: async () => ({}) },
      deviceMemory: 8,
      hardwareConcurrency: 8,
      storage: { estimate: async () => ({ quota: 20e9, usage: 5e9 }) },
      connection: { saveData: true },
    };
    const s: DeviceSignals = await probeDevice(nav);
    expect(s.webgpu).toBe(true);
    expect(s.ramGB).toBe(8);
    expect(s.cores).toBe(8);
    expect(s.storageFreeGB).toBeCloseTo(15, 0);
    expect(s.saveData).toBe(true);
    expect(recommendTier(s).tier).toBe(3);

    // A bare navigator (no APIs) → unsupported, no throw.
    expect((await probeDevice({})).webgpu).toBe(false);
  });
});
