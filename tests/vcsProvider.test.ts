/**
 * Tests for VCSProvider — commit/branch/tag/rollback operations.
 * Uses mock VCSStateManager, CheckpointManager, and EventBus so no filesystem
 * I/O occurs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VCSProvider } from '../src/server/AppMakerLab/vcs/VCSProvider';
import type { VCSState, Commit } from '../src/server/AppMakerLab/vcs/VCSTypes';
import type { ICheckpointManager } from '../src/server/AppMakerLab/checkpoint/ICheckpointManager';

function makeStateMgr(initialState?: Partial<VCSState>) {
  let state: VCSState = {
    head: 'INITIAL',
    branches: [],
    tags: [],
    LKGCommitHash: 'INITIAL',
    ...initialState,
  };
  const txs: Map<string, any> = new Map();

  return {
    getState: vi.fn(async () => ({ ...state })),
    saveState: vi.fn(async (s: VCSState) => { state = { ...s }; }),
    getTransaction: vi.fn(async (id: string) => txs.get(id) ?? null),
    saveTransaction: vi.fn(async (tx: any) => { txs.set(tx.id, { ...tx }); }),
    updateTransactionPhase: vi.fn(async (id: string, phase: string) => {
      const tx = txs.get(id);
      if (tx) txs.set(id, { ...tx, phase });
    }),
    listTransactions: vi.fn(async () => [...txs.values()]),
  };
}

function makeCheckpointMgr(): ICheckpointManager {
  const checkpoints = new Map<string, any>();
  return {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    saveCheckpoint: vi.fn(async (cp) => checkpoints.set(cp.id, cp)),
    loadCheckpoint: vi.fn(async (id) => checkpoints.get(id) ?? null),
    deleteCheckpoint: vi.fn(async (id) => checkpoints.delete(id)),
    listCheckpoints: vi.fn(async () => [...checkpoints.values()]),
  };
}

function makeEventBus() {
  const events: any[] = [];
  return {
    publish: vi.fn((ev) => events.push(ev)),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    _events: events,
  };
}

describe('VCSProvider.commit', () => {
  it('returns a Commit with a message and id', async () => {
    const sm = makeStateMgr();
    const cm = makeCheckpointMgr();
    const eb = makeEventBus();
    const vcs = new VCSProvider(sm as any, cm, eb as any);

    const commit = await vcs.commit('ws-1', 'Initial commit');
    expect(typeof commit.id).toBe('string');
    expect(commit.message).toBe('Initial commit');
    expect(typeof commit.timestamp).toBe('number');
  });

  it('publishes VCS_COMMIT_STARTED and VCS_COMMIT_COMPLETED events', async () => {
    const sm = makeStateMgr();
    const cm = makeCheckpointMgr();
    const eb = makeEventBus();
    const vcs = new VCSProvider(sm as any, cm, eb as any);

    await vcs.commit('ws-1', 'My commit');
    const types = eb._events.map((e: any) => e.type);
    expect(types).toContain('VCS_COMMIT_STARTED');
    expect(types).toContain('VCS_COMMIT_COMPLETED');
  });
});

describe('VCSProvider.createBranch', () => {
  it('returns branch with given name', async () => {
    const sm = makeStateMgr({ head: 'abc123' });
    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), makeEventBus() as any);

    const branch = await vcs.createBranch('ws-1', 'feature/auth');
    expect(branch.name).toBe('feature/auth');
    expect(branch.commitId).toBe('abc123');
  });

  it('saves state with new branch', async () => {
    const sm = makeStateMgr();
    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), makeEventBus() as any);

    await vcs.createBranch('ws-1', 'dev');
    expect(sm.saveState).toHaveBeenCalled();
  });
});

describe('VCSProvider.deleteBranch', () => {
  it('removes the branch from state', async () => {
    const sm = makeStateMgr({ branches: [{ name: 'main', commitId: 'x' }, { name: 'temp', commitId: 'y' }] });
    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), makeEventBus() as any);

    await vcs.deleteBranch('temp');
    const savedState = sm.saveState.mock.calls[0][0] as VCSState;
    expect(savedState.branches.find((b: any) => b.name === 'temp')).toBeUndefined();
    expect(savedState.branches.find((b: any) => b.name === 'main')).toBeDefined();
  });
});

describe('VCSProvider.createTag', () => {
  it('returns tag with name and commitId', async () => {
    const sm = makeStateMgr();
    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), makeEventBus() as any);

    const tag = await vcs.createTag('v1.0.0', 'hash-abc');
    expect(tag.name).toBe('v1.0.0');
    expect(tag.commitId).toBe('hash-abc');
  });
});

describe('VCSProvider.updateLKG', () => {
  it('publishes VCS_LKG_UPDATED event', async () => {
    const sm = makeStateMgr();
    const eb = makeEventBus();
    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), eb as any);

    await vcs.updateLKG('new-hash');
    const types = eb._events.map((e: any) => e.type);
    expect(types).toContain('VCS_LKG_UPDATED');
  });
});

describe('VCSProvider.recover', () => {
  it('rolls back PREPARING transactions', async () => {
    const sm = makeStateMgr();
    // Manually add a transaction in PREPARING state
    sm.listTransactions.mockResolvedValue([
      { id: 'tx-prep', phase: 'PREPARING', checkpointId: 'chk-1' },
    ]);
    sm.getTransaction.mockResolvedValue({ id: 'tx-prep', phase: 'PREPARING', checkpointId: 'chk-1' });

    const vcs = new VCSProvider(sm as any, makeCheckpointMgr(), makeEventBus() as any);
    await vcs.recover();
    // After rollback, updateTransactionPhase should be called with ROLLED_BACK
    const calls = sm.updateTransactionPhase.mock.calls;
    expect(calls.some((c: any[]) => c[1] === 'ROLLED_BACK')).toBe(true);
  });
});
