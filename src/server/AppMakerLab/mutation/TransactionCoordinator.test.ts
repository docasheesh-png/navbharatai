import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionCoordinator } from './TransactionCoordinator';
import { MutationState, WorkspacePatchBatch } from './MutationTypes';
import { EventType } from '../eventbus/EventTypes';

function makeBatch(id: string): WorkspacePatchBatch {
  return { id, patches: [{ path: 'a.txt', content: 'hello' }] };
}

describe('TransactionCoordinator', () => {
  let journal: { write: ReturnType<typeof vi.fn>; readAll: ReturnType<typeof vi.fn> };
  let executor: { execute: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> };
  let auditor: { log: ReturnType<typeof vi.fn> };
  let eventBus: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> };
  let coordinator: TransactionCoordinator;

  beforeEach(() => {
    journal = { write: vi.fn().mockResolvedValue(undefined), readAll: vi.fn().mockResolvedValue([]) };
    executor = { execute: vi.fn().mockResolvedValue(undefined), undo: vi.fn().mockResolvedValue(undefined) };
    auditor = { log: vi.fn() };
    eventBus = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(), unsubscribe: vi.fn() };

    coordinator = new TransactionCoordinator(journal as any, executor as any, auditor as any, eventBus as any);
  });

  function states(): string[] {
    return journal.write.mock.calls.map((call) => call[0].state);
  }

  function eventTypes(): string[] {
    return eventBus.publish.mock.calls.map((call) => call[0].type);
  }

  it('writes STARTED → STAGED → COMMITTED → FINISHED to the journal on success', async () => {
    await coordinator.coordinate(makeBatch('tx-1'));
    expect(states()).toEqual([
      MutationState.STARTED,
      MutationState.STAGED,
      MutationState.COMMITTED,
      MutationState.FINISHED,
    ]);
  });

  it('emits WORKSPACE_MUTATION_STARTED and WORKSPACE_MUTATION_COMMITTED events', async () => {
    await coordinator.coordinate(makeBatch('tx-2'));
    expect(eventTypes()).toContain(EventType.WORKSPACE_MUTATION_STARTED);
    expect(eventTypes()).toContain(EventType.WORKSPACE_MUTATION_COMMITTED);
  });

  it('calls executor.undo() when executor.execute() fails', async () => {
    executor.execute.mockRejectedValue(new Error('execute failed'));
    const batch = makeBatch('tx-3');

    await expect(coordinator.coordinate(batch)).rejects.toThrow('execute failed');
    expect(executor.undo).toHaveBeenCalledWith(batch);
  });

  it('writes ROLLED_BACK after a successful undo', async () => {
    executor.execute.mockRejectedValue(new Error('execute failed'));
    await expect(coordinator.coordinate(makeBatch('tx-4'))).rejects.toThrow();
    expect(states()).toContain(MutationState.ROLLED_BACK);
  });

  it('emits WORKSPACE_MUTATION_ROLLED_BACK after a successful undo', async () => {
    executor.execute.mockRejectedValue(new Error('execute failed'));
    await expect(coordinator.coordinate(makeBatch('tx-5'))).rejects.toThrow();
    expect(eventTypes()).toContain(EventType.WORKSPACE_MUTATION_ROLLED_BACK);
  });

  it('writes CORRUPTED and rethrows the undo error when undo itself throws', async () => {
    executor.execute.mockRejectedValue(new Error('execute failed'));
    executor.undo.mockRejectedValue(new Error('undo failed'));
    const batch = makeBatch('tx-6');

    await expect(coordinator.coordinate(batch)).rejects.toThrow('undo failed');
    expect(states()).toContain('CORRUPTED');
    expect(eventTypes()).toContain(EventType.WORKSPACE_MUTATION_CORRUPTED);
    // Must NOT reach ROLLED_BACK once undo itself has failed.
    expect(states()).not.toContain(MutationState.ROLLED_BACK);
  });
});
