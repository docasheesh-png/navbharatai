import { describe, expect, it, vi } from 'vitest';
import { claimCurrentQueueItem, reconcileCurrentQueue, QueueSessionScope } from './queueSessionScope';

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('queued claims stay in their issuing chat', () => {
  it('submits the captured session after a successful claim and editor flush', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const claim = vi.fn(async () => ({ id: 'step-a' })), flush = vi.fn(async () => {}), run = vi.fn();
    expect(await claimCurrentQueueItem({ scope, claim, beforeBuild: flush, run })).toBe('started');
    expect(claim).toHaveBeenCalledWith('workspace-a');
    expect(flush).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ id: 'step-a' }, expect.objectContaining({ workspaceId: 'workspace-a', sessionId: 'session-a' }));
  });

  it('a delayed claim cannot append or execute its prompt after a workspace switch', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const pending = gate<{ id: string } | null>(), flush = vi.fn(async () => {}), run = vi.fn();
    const result = claimCurrentQueueItem({ scope, claim: () => pending.promise, beforeBuild: flush, run });
    scope.update('workspace-b', 'session-b', 'owner'); pending.resolve({ id: 'step-a' });
    expect(await result).toBe('stale'); expect(flush).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });

  it('navigation while the editor flushes also prevents execution', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const flushing = gate<void>(), entered = gate<void>(), run = vi.fn();
    const result = claimCurrentQueueItem({ scope, claim: async () => ({ id: 'step-a' }), beforeBuild: async () => { entered.resolve(); await flushing.promise; }, run });
    await entered.promise; scope.invalidate(); scope.update('workspace-b', 'session-b', 'owner'); flushing.resolve();
    expect(await result).toBe('stale'); expect(run).not.toHaveBeenCalled();
  });

  it('leaving and reopening the same workspace cannot revive an earlier callback', () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const earlier = scope.capture(); scope.invalidate(); scope.update('workspace-a', 'session-a', 'owner');
    expect(scope.isCurrent(earlier)).toBe(false);
  });

  it('a delayed A claim stays stale after switching A to B and back to A', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const pending = gate<{ id: string } | null>(), run = vi.fn();
    const result = claimCurrentQueueItem({ scope, claim: () => pending.promise, run });
    scope.update('workspace-b', 'session-b', 'owner'); scope.update('workspace-a', 'session-a', 'owner');
    pending.resolve({ id: 'step-a' }); expect(await result).toBe('stale'); expect(run).not.toHaveBeenCalled();
  });

  it('ordinary rerenders preserve freshness, while an account change invalidates it', () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const earlier = scope.capture(); scope.update('workspace-a', 'session-a', 'owner');
    expect(scope.isCurrent(earlier)).toBe(true);
    scope.update('workspace-a', 'session-a', 'other'); expect(scope.isCurrent(earlier)).toBe(false);
  });
});

describe('queue reconciliation is fresh evidence', () => {
  it('a successful fresh read replaces queue rows and clears a recoverable error', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    let items: string[] = []; let error: string | null = 'temporary outage';
    expect(await reconcileCurrentQueue({ scope, load: async () => ['pending-step'], apply: (next) => { items = next; error = null; }, onError: (next) => { error = String(next); } })).toBe(true);
    expect(items).toEqual(['pending-step']); expect(error).toBeNull();
  });

  it('an old read cannot repopulate another chat or clear its newer error', async () => {
    const scope = new QueueSessionScope(); scope.update('workspace-a', 'session-a', 'owner');
    const pending = gate<string[]>(); let items = ['workspace-b-step']; let error: string | null = 'new chat outage';
    const result = reconcileCurrentQueue({ scope, load: () => pending.promise, apply: (next) => { items = next; error = null; }, onError: (next) => { error = String(next); } });
    scope.update('workspace-b', 'session-b', 'owner'); pending.resolve(['workspace-a-step']);
    expect(await result).toBe(false); expect(items).toEqual(['workspace-b-step']); expect(error).toBe('new chat outage');
  });
});
