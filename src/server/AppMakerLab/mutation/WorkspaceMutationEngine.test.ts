import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceMutationEngine } from './WorkspaceMutationEngine';
import { MutationState, WorkspacePatchBatch } from './MutationTypes';

function makeBatch(id: string): WorkspacePatchBatch {
  return { id, patches: [{ path: 'a.txt', content: 'hello' }] };
}

describe('WorkspaceMutationEngine', () => {
  let coordinator: { coordinate: ReturnType<typeof vi.fn> };
  let lockManager: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let conflictDetector: { detectConflicts: ReturnType<typeof vi.fn> };
  let journal: { write: ReturnType<typeof vi.fn>; readAll: ReturnType<typeof vi.fn> };
  let executor: {
    execute: ReturnType<typeof vi.fn>;
    promote: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    recover: ReturnType<typeof vi.fn>;
  };
  let checkpointManager: any;
  let engine: WorkspaceMutationEngine;

  beforeEach(() => {
    coordinator = { coordinate: vi.fn().mockResolvedValue(undefined) };
    lockManager = { acquire: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) };
    conflictDetector = { detectConflicts: vi.fn().mockReturnValue(false) };
    journal = { write: vi.fn().mockResolvedValue(undefined), readAll: vi.fn().mockResolvedValue([]) };
    executor = {
      execute: vi.fn().mockResolvedValue(undefined),
      promote: vi.fn().mockResolvedValue(undefined),
      undo: vi.fn().mockResolvedValue(undefined),
      recover: vi.fn().mockResolvedValue(undefined),
    };
    checkpointManager = { save: vi.fn(), load: vi.fn(), saveCheckpoint: vi.fn(), loadCheckpoint: vi.fn(), deleteCheckpoint: vi.fn(), listCheckpoints: vi.fn() };

    engine = new WorkspaceMutationEngine(
      coordinator as any,
      lockManager as any,
      conflictDetector as any,
      journal as any,
      executor as any,
      checkpointManager,
    );
  });

  describe('mutate()', () => {
    it('acquires the lock before coordinating and releases it in finally', async () => {
      const batch = makeBatch('tx-1');
      await engine.mutate(batch);

      expect(lockManager.acquire).toHaveBeenCalledWith('tx-1');
      expect(coordinator.coordinate).toHaveBeenCalledWith(batch);
      expect(lockManager.release).toHaveBeenCalledWith('tx-1');
      const acquireOrder = lockManager.acquire.mock.invocationCallOrder[0];
      const coordinateOrder = coordinator.coordinate.mock.invocationCallOrder[0];
      const releaseOrder = lockManager.release.mock.invocationCallOrder[0];
      expect(acquireOrder).toBeLessThan(coordinateOrder);
      expect(coordinateOrder).toBeLessThan(releaseOrder);
    });

    it('throws and skips the coordinator when a conflict is detected', async () => {
      conflictDetector.detectConflicts.mockReturnValue(true);
      const batch = makeBatch('tx-2');

      await expect(engine.mutate(batch)).rejects.toThrow('Conflict detected');
      expect(coordinator.coordinate).not.toHaveBeenCalled();
      expect(lockManager.release).toHaveBeenCalledWith('tx-2');
    });

    it('calls executor.promote() after successful coordination', async () => {
      await engine.mutate(makeBatch('tx-3'));
      expect(executor.promote).toHaveBeenCalled();
    });

    it('releases the lock even when coordinator.coordinate() throws', async () => {
      coordinator.coordinate.mockRejectedValue(new Error('coordinate failed'));
      await expect(engine.mutate(makeBatch('tx-4'))).rejects.toThrow('coordinate failed');
      expect(lockManager.release).toHaveBeenCalledWith('tx-4');
    });

    it('releases the lock even when executor.promote() throws', async () => {
      executor.promote.mockRejectedValue(new Error('promote failed'));
      await expect(engine.mutate(makeBatch('tx-5'))).rejects.toThrow('promote failed');
      expect(lockManager.release).toHaveBeenCalledWith('tx-5');
    });
  });

  describe('rollback()', () => {
    it('calls executor.undo() for the matching transactionId', async () => {
      const batch = makeBatch('tx-6');
      journal.readAll.mockResolvedValue([
        { transactionId: 'tx-6', state: MutationState.STARTED, batch, timestamp: Date.now() },
      ]);

      await engine.rollback('tx-6');
      expect(executor.undo).toHaveBeenCalledWith(batch);
    });

    it('does nothing when the transactionId is not found in the journal', async () => {
      journal.readAll.mockResolvedValue([]);
      await engine.rollback('missing-tx');
      expect(executor.undo).not.toHaveBeenCalled();
    });
  });

  describe('recover()', () => {
    it('calls executor.recover() first', async () => {
      journal.readAll.mockResolvedValue([]);
      await engine.recover();
      expect(executor.recover).toHaveBeenCalled();
    });

    it('calls executor.undo() for non-terminal journal entries', async () => {
      const batch1 = makeBatch('tx-a');
      const batch2 = makeBatch('tx-b');
      journal.readAll.mockResolvedValue([
        { transactionId: 'tx-a', state: MutationState.STARTED, batch: batch1, timestamp: Date.now() },
        { transactionId: 'tx-b', state: MutationState.STAGED, batch: batch2, timestamp: Date.now() },
      ]);

      await engine.recover();
      expect(executor.undo).toHaveBeenCalledWith(batch1);
      expect(executor.undo).toHaveBeenCalledWith(batch2);
      expect(executor.undo).toHaveBeenCalledTimes(2);
    });

    it('skips entries in COMMITTED / FINISHED / ROLLED_BACK state', async () => {
      const committed = makeBatch('tx-c');
      const finished = makeBatch('tx-d');
      const rolledBack = makeBatch('tx-e');
      journal.readAll.mockResolvedValue([
        { transactionId: 'tx-c', state: MutationState.COMMITTED, batch: committed, timestamp: Date.now() },
        { transactionId: 'tx-d', state: MutationState.FINISHED, batch: finished, timestamp: Date.now() },
        { transactionId: 'tx-e', state: MutationState.ROLLED_BACK, batch: rolledBack, timestamp: Date.now() },
      ]);

      await engine.recover();
      expect(executor.undo).not.toHaveBeenCalled();
    });
  });
});
