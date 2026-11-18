import { afterEach, describe, expect, it } from 'vitest';
import { buildTrafficBoard } from './trafficBoard';
import { IMAGE_PROVIDER_IDS, VISION_PROVIDER_IDS, providerCapabilities } from './providerCapabilities';
import {
  classifyTrafficError, noteProviderCall, percentile, providerInFlight, resetTrafficHealthForTests,
  shouldSkipProvider, TRAFFIC_RECOVERY_MS, trafficProviderViews,
} from './trafficHealth';

const SUSPENDED = '429 Your account org-example is suspended due to insufficient balance, please recharge';

afterEach(() => {
  resetTrafficHealthForTests();
  delete process.env.AGENTV3_TRAFFIC_HEALTH;
});

describe('traffic health', () => {
  it('classifies the suspended Kimi balance error as a recharge failure', () => {
    expect(classifyTrafficError(new Error(SUSPENDED))).toBe('suspended');
    expect(classifyTrafficError(new Error('OpenAI-compatible call timed out after 15000ms — the provider had not started answering'))).toBe('timeout');
    expect(classifyTrafficError(new Error('invalid_completion safe=terminal_fold status=404'))).toBe('invalid');
    expect(classifyTrafficError(new Error('429 The service may be temporarily overloaded'))).toBe('rate-limit');
  });

  it('skips a suspended provider immediately and allows one recovery call after the window', () => {
    noteProviderCall({ provider: 'KIMI', model: 'kimi-k2.7-code', surface: 'builder', ok: false, totalMs: 400, error: new Error(SUSPENDED), at: 1_000 });
    expect(shouldSkipProvider('kimi', 1_000)).toBe(true);
    expect(shouldSkipProvider('KIMI#2', 1_000)).toBe(false); // independently funded credential
    expect(shouldSkipProvider('KIMI', 1_000 + TRAFFIC_RECOVERY_MS)).toBe(false);
    expect(shouldSkipProvider('KIMI', 1_000 + TRAFFIC_RECOVERY_MS + 1)).toBe(true);
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: true, totalMs: 800, firstByteMs: 200, at: 2_000 });
    expect(shouldSkipProvider('KIMI', 9_000)).toBe(false);
  });

  it('marks a provider down only after repeated timeouts, and reports p50 and p95', () => {
    for (let i = 0; i < 2; i += 1) noteProviderCall({ provider: 'GLM', surface: 'chat', ok: false, totalMs: 15000, error: new Error('timed out'), at: i });
    expect(shouldSkipProvider('GLM', 10)).toBe(false);
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: false, totalMs: 15000, error: new Error('timed out'), at: 3 });
    expect(shouldSkipProvider('GLM', 3)).toBe(true);
    noteProviderCall({ provider: 'ENGINE_R1', surface: 'builder', ok: true, totalMs: 100, firstByteMs: 10, at: 1 });
    noteProviderCall({ provider: 'ENGINE_R1', surface: 'builder', ok: true, totalMs: 300, firstByteMs: 30, at: 2 });
    noteProviderCall({ provider: 'ENGINE_R1', surface: 'builder', ok: true, totalMs: 500, firstByteMs: 50, at: 3 });
    const view = trafficProviderViews().find((row) => row.provider === 'ENGINE_R1');
    expect(view?.totalP50).toBe(percentile([100, 300, 500], 50));
    expect(view?.totalP95).toBe(percentile([100, 300, 500], 95));
    expect(view?.firstByteP50).toBe(30);
  });

  it('does not leave a cancelled or undispatched recovery probe stuck forever', () => {
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: false, error: new Error(SUSPENDED), at: 0 });
    expect(shouldSkipProvider('KIMI', TRAFFIC_RECOVERY_MS)).toBe(false);
    expect(shouldSkipProvider('KIMI', TRAFFIC_RECOVERY_MS + 1)).toBe(true);
    expect(shouldSkipProvider('KIMI', 2 * TRAFFIC_RECOVERY_MS)).toBe(false);
  });

  it('does not release a second recovery while a physical attempt still owns its slot', () => {
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: false, error: new Error(SUSPENDED), at: 0 });
    expect(shouldSkipProvider('GLM', TRAFFIC_RECOVERY_MS)).toBe(false);
    providerInFlight('GLM', 1);
    expect(shouldSkipProvider('GLM', 2 * TRAFFIC_RECOVERY_MS)).toBe(true);
    providerInFlight('GLM', -1);
    expect(shouldSkipProvider('GLM', 2 * TRAFFIC_RECOVERY_MS)).toBe(false);
  });

  it('a failed recovery with a different error permits another bounded probe', () => {
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: false, error: new Error(SUSPENDED), at: 0 });
    expect(shouldSkipProvider('GLM', TRAFFIC_RECOVERY_MS)).toBe(false);
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: false, error: new Error('429 rate limit'), at: TRAFFIC_RECOVERY_MS + 10 });
    expect(shouldSkipProvider('GLM', 2 * TRAFFIC_RECOVERY_MS)).toBe(true);
    expect(shouldSkipProvider('GLM', 2 * TRAFFIC_RECOVERY_MS + 10)).toBe(false);
  });

  it('keeps provider state bounded even when diagnostic names vary', () => {
    for (let i = 0; i < 300; i++) noteProviderCall({ provider: `test-${i}`, surface: 'builder', ok: true });
    expect(trafficProviderViews()).toHaveLength(256);
  });

  it('chat/image overlap and the Qubax builder alias keep their real capabilities', () => {
    expect(providerCapabilities('GEMINI', new Set())).toMatchObject({ chat: true, imageGen: true, vision: true });
    expect(providerCapabilities('ENGINE_QX', new Set(['ENGINE_QX']))).toMatchObject({ build: true, vision: true });
    noteProviderCall({ provider: 'QUBAX', surface: 'qubax', ok: false, error: new Error(SUSPENDED), at: 0 });
    expect(shouldSkipProvider('ENGINE_QX', 1)).toBe(true);
  });

  it('the kill switch stops the skip', () => {
    process.env.AGENTV3_TRAFFIC_HEALTH = 'off';
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: false, error: new Error(SUSPENDED), at: 1 });
    expect(shouldSkipProvider('KIMI', 1)).toBe(false);
  });

  it('the board lists a recharge alert and the vision and image providers the product already has', () => {
    noteProviderCall({ provider: 'KIMI', surface: 'builder', ok: false, error: new Error(SUSPENDED), at: 5 });
    const board = buildTrafficBoard([
      { id: 'kimi', label: 'Kimi', configured: true, enabled: true, model: 'kimi-k2.7-code' },
      { id: 'glm-builder', label: 'GLM', configured: true, enabled: true, model: 'glm-4.7-flash' },
    ], ['GLM', 'KIMI']);
    expect(board.alerts).toEqual([expect.objectContaining({ provider: 'KIMI', issue: 'needs recharge' })]);
    expect(board.vision).toEqual([...VISION_PROVIDER_IDS]);
    expect(board.imageGen).toEqual([...IMAGE_PROVIDER_IDS]);
    const glm = board.rows.find((row) => row.provider === 'GLM');
    expect(glm?.capabilities).toMatchObject({ build: true, vision: true, hindiProbe: null, longContext: null });
    expect(glm?.price).toEqual(expect.objectContaining({ inputPerMTok: expect.any(Number), outputPerMTok: expect.any(Number) }));
  });
});
