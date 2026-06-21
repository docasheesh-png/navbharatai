import { describe, it, expect, vi } from 'vitest';
import { MutationEngineFactory } from '../src/server/AppMakerLab/mutation/MutationEngineFactory';
import type { ICheckpointManager } from '../src/server/AppMakerLab/checkpoint/ICheckpointManager';

function mockCheckpointManager(): ICheckpointManager {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue({}),
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
    deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
    listCheckpoints: vi.fn().mockResolvedValue([]),
  } as unknown as ICheckpointManager;
}

describe('MutationEngineFactory.create', () => {
  it('returns a mutationEngine', () => {
    const { mutationEngine } = MutationEngineFactory.create(mockCheckpointManager(), 'test');
    expect(mutationEngine).toBeDefined();
    expect(typeof mutationEngine.mutate).toBe('function');
  });

  it('returns an eventBus', () => {
    const { eventBus } = MutationEngineFactory.create(mockCheckpointManager(), 'test');
    expect(eventBus).toBeDefined();
    expect(typeof eventBus.publish).toBe('function');
  });

  it('returns an eventHistoryStore', () => {
    const { eventHistoryStore } = MutationEngineFactory.create(mockCheckpointManager(), 'test');
    expect(eventHistoryStore).toBeDefined();
    expect(Array.isArray(eventHistoryStore.getHistory())).toBe(true);
  });

  it('returns separate instances for different namespaces', () => {
    const r1 = MutationEngineFactory.create(mockCheckpointManager(), 'ns-a');
    const r2 = MutationEngineFactory.create(mockCheckpointManager(), 'ns-b');
    expect(r1.mutationEngine).not.toBe(r2.mutationEngine);
  });
});
