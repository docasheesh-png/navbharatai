import { describe, it, expect, vi } from 'vitest';
import { CheckpointManager } from '../src/server/AppMakerLab/checkpoint/CheckpointManager';
import type { CheckpointStorage } from '../src/server/AppMakerLab/checkpoint/CheckpointStorage';
import type { Checkpoint } from '../src/server/AppMakerLab/checkpoint/CheckpointTypes';
import type { IEventBus } from '../src/server/AppMakerLab/eventbus/IEventBus';

function checkpoint(id: string): Checkpoint {
  return { id, taskId: 't-1', status: 'PREPARED', retryCount: 0, patchState: {}, workspaceHash: 'abc', timestamp: Date.now() };
}

function makeStorage(): CheckpointStorage {
  const store = new Map<string, any>();
  return {
    save: vi.fn().mockImplementation(async (id: string, data: any) => { store.set(id, data); }),
    load: vi.fn().mockImplementation(async (id: string) => store.get(id)),
    delete: vi.fn().mockImplementation(async (id: string) => { store.delete(id); }),
    listCheckpoints: vi.fn().mockResolvedValue([]),
  } as unknown as CheckpointStorage;
}

function makeEventBus(): IEventBus {
  return { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() } as unknown as IEventBus;
}

describe('CheckpointManager', () => {
  it('saveCheckpoint calls storage.save', async () => {
    const storage = makeStorage();
    const manager = new CheckpointManager(storage, makeEventBus());
    await manager.saveCheckpoint(checkpoint('chk-1'));
    expect(storage.save).toHaveBeenCalledWith('chk-1', expect.objectContaining({ id: 'chk-1' }));
  });

  it('loadCheckpoint calls storage.load', async () => {
    const storage = makeStorage();
    const chk = checkpoint('chk-2');
    (storage.save as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (storage.load as ReturnType<typeof vi.fn>).mockResolvedValue(chk);
    const manager = new CheckpointManager(storage, makeEventBus());
    const result = await manager.loadCheckpoint('chk-2');
    expect(result.id).toBe('chk-2');
  });

  it('deleteCheckpoint calls storage.delete', async () => {
    const storage = makeStorage();
    const manager = new CheckpointManager(storage, makeEventBus());
    await manager.deleteCheckpoint('chk-3');
    expect(storage.delete).toHaveBeenCalledWith('chk-3');
  });

  it('saveCheckpoint publishes CHECKPOINT_CREATED event', async () => {
    const eventBus = makeEventBus();
    const manager = new CheckpointManager(makeStorage(), eventBus);
    await manager.saveCheckpoint(checkpoint('chk-4'));
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'CHECKPOINT_CREATED' }));
  });
});
