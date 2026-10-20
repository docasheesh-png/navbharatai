import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveChannel, liveEventsAllowedFor, FirestoreLiveChannel, type LiveChannelDb } from './LiveChannel';

// Under VITEST the FirestoreLiveChannel skips Firestore entirely (getDb() → null), so these tests
// exercise the REAL in-memory mirror path — publish/flush/readSince/close logic — not a mock.

describe('liveEventsAllowedFor — the decision that stops one session\'s events bleeding into another', () => {
  it('caller without a workspaceId gets everything (back-compat, account-wide watch)', () => {
    expect(liveEventsAllowedFor(null, 'agentv3-u1-s1')).toBe(true);
    expect(liveEventsAllowedFor(undefined, undefined)).toBe(true);
    expect(liveEventsAllowedFor('', 'agentv3-u1-s1')).toBe(true);
  });

  it('matching workspace → delivered', () => {
    expect(liveEventsAllowedFor('agentv3-u1-s1', 'agentv3-u1-s1')).toBe(true);
  });

  it('a DIFFERENT session\'s events are refused (the stuck-chat-reappears-everywhere bug)', () => {
    expect(liveEventsAllowedFor('agentv3-u1-NEW_SESSION', 'agentv3-u1-OLD_SESSION')).toBe(false);
  });

  it('UNSTAMPED events (a pre-upgrade ghost doc) are refused for a session-scoped caller — conservative deny', () => {
    expect(liveEventsAllowedFor('agentv3-u1-s1', undefined)).toBe(false);
  });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function durableChannel() {
  const objects = new Map<string, unknown>();
  const writes: Array<{ promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void; value: Record<string, unknown> }> = [];
  const deletion = deferred();
  const set = vi.fn((value: Record<string, unknown>) => {
    const hold = { ...deferred(), value: structuredClone(value) };
    writes.push(hold);
    return hold.promise.then(() => { objects.set('channel', hold.value); });
  });
  const remove = vi.fn(() => deletion.promise.then(() => { objects.delete('channel'); }));
  const db: LiveChannelDb = { collection: () => ({ doc: () => ({ set, delete: remove, get: async () => ({ exists: objects.has('channel'), data: () => objects.get('channel') }) }) }) };
  return { channel: new FirestoreLiveChannel(() => db), objects, writes, deletion, set, remove };
}
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('closeAndWait joins actual captured Firestore writes before confirmed deletion', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for every already-started flush, including out-of-order completion, then awaits the delete ACK', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old-first'], 'workspace-A'); vi.advanceTimersByTime(1500);
    f.channel.publish('owner', ['old-second'], 'workspace-A'); vi.advanceTimersByTime(1500);
    expect(f.set).toHaveBeenCalledTimes(2);
    let completed = false;
    const close = f.channel.closeAndWait('owner').then((ok) => { completed = true; return ok; });
    expect(f.remove).not.toHaveBeenCalled();
    f.writes[1].resolve(); await microtasks();
    expect(f.remove).not.toHaveBeenCalled(); expect(completed).toBe(false);
    f.writes[0].resolve(); await microtasks();
    expect(f.remove).toHaveBeenCalledTimes(1); expect(completed).toBe(false);
    f.deletion.resolve();
    expect(await close).toBe(true); expect(f.objects.size).toBe(0);
    vi.advanceTimersByTime(6000); expect(f.set).toHaveBeenCalledTimes(2);
  });

  it('drops pending events and cancels their timer instead of starting another stale flush', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['not-yet-flushed'], 'workspace-A');
    const close = f.channel.closeAndWait('owner'); await microtasks();
    expect(f.set).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledTimes(1);
    f.deletion.resolve(); expect(await close).toBe(true);
    vi.advanceTimersByTime(6000); expect(f.set).not.toHaveBeenCalled();
    expect((await f.channel.readSince('owner', 0)).events).toEqual([]);
  });

  it('refuses an old delete when a newer local state appears while its flush is pending', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old'], 'workspace-A'); vi.advanceTimersByTime(1500);
    const close = f.channel.closeAndWait('owner');
    f.channel.publish('owner', ['new'], 'workspace-B'); vi.advanceTimersByTime(1500);
    expect(f.set).toHaveBeenCalledTimes(1); // The new write waits behind the old close.
    f.writes[0].resolve();
    expect(await close).toBe(false); await microtasks();
    expect(f.remove).not.toHaveBeenCalled(); expect(f.set).toHaveBeenCalledTimes(2);
    f.writes[1].resolve(); await microtasks();
    expect(f.objects.get('channel')).toMatchObject({ workspaceId: 'workspace-B' });
    expect((await f.channel.readSince('owner', 0)).workspaceId).toBe('workspace-B');
  });

  it('holds a newer local flush behind an already-issued old delete, so the delete cannot erase new bytes', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old-pending'], 'workspace-A');
    const close = f.channel.closeAndWait('owner'); await microtasks();
    expect(f.remove).toHaveBeenCalledTimes(1);
    f.channel.publish('owner', ['new'], 'workspace-B'); vi.advanceTimersByTime(1500);
    expect(f.set).not.toHaveBeenCalled();
    f.deletion.resolve(); expect(await close).toBe(false); await microtasks();
    expect(f.set).toHaveBeenCalledTimes(1);
    f.writes[0].resolve(); await microtasks();
    expect(f.objects.get('channel')).toMatchObject({ workspaceId: 'workspace-B' });
  });

  it('duplicate close calls join the same captured cleanup, and legacy close remains fire-and-forget', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old'], 'workspace-A'); vi.advanceTimersByTime(1500);
    const first = f.channel.closeAndWait('owner');
    expect(f.channel.closeAndWait('owner')).toBe(first);
    expect(f.channel.close('owner')).toBeUndefined();
    f.writes[0].resolve(); await microtasks(); expect(f.remove).toHaveBeenCalledTimes(1);
    f.deletion.resolve(); expect(await first).toBe(true);
  });

  it.each([false, true])('an uncertain earlier write prevents a success claim even after deletion (already-settled=%s)', async (alreadySettled) => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old'], 'workspace-A'); vi.advanceTimersByTime(1500);
    f.writes[0].reject(Error('write acknowledgement lost'));
    if (alreadySettled) await microtasks();
    const close = f.channel.closeAndWait('owner'); await microtasks();
    expect(f.remove).toHaveBeenCalledTimes(1); f.deletion.resolve();
    expect(await close).toBe(false);
  });

  it('a failed delete returns false without throwing or leaving the captured local state active', async () => {
    vi.useFakeTimers(); const f = durableChannel();
    f.channel.publish('owner', ['old'], 'workspace-A');
    const close = f.channel.closeAndWait('owner'); await microtasks();
    f.deletion.reject(Error('delete acknowledgement unknown'));
    expect(await close).toBe(false);
    expect((await f.channel.readSince('owner', 0)).events).toEqual([]);
    vi.advanceTimersByTime(3000); expect(f.set).not.toHaveBeenCalled();
  });

  it('missing or throwing explicit storage providers cannot report confirmed cleanup', async () => {
    for (const provider of [() => null, () => { throw Error('storage unavailable'); }]) {
      const channel = new FirestoreLiveChannel(provider);
      channel.publish('owner', ['pending'], 'workspace-A');
      expect(await channel.closeAndWait('owner')).toBe(false);
      expect((await channel.readSince('owner', 0)).events).toEqual([]);
    }
    expect(await new FirestoreLiveChannel(() => null).closeAndWait('')).toBe(false);
  });
});

describe('FirestoreLiveChannel (in-memory mirror path) — workspace stamping + close() leaves no tail', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publish() stamps the channel with the build\'s workspaceId and readSince() returns it', async () => {
    vi.useFakeTimers();
    liveChannel.publish('user-stamp-test', [{ type: 'narration', text: 'hi' }], 'agentv3-u1-sessA');
    vi.advanceTimersByTime(2000); // let the 1.5s throttle flush run
    const read = await liveChannel.readSince('user-stamp-test', 0);
    expect(read.events.length).toBe(1);
    expect(read.seq).toBe(1);
    expect(read.workspaceId).toBe('agentv3-u1-sessA');
    liveChannel.close('user-stamp-test');
  });

  it('close() removes the channel entirely — a later poll from ANY session gets nothing to replay', async () => {
    vi.useFakeTimers();
    liveChannel.publish('user-close-test', [{ type: 'narration', text: 'old build event' }], 'agentv3-u1-sessOld');
    vi.advanceTimersByTime(2000);
    expect((await liveChannel.readSince('user-close-test', 0)).events.length).toBe(1);
    liveChannel.close('user-close-test');
    const after = await liveChannel.readSince('user-close-test', 0);
    expect(after.events).toEqual([]);       // the ghost tail is GONE, not waiting to reappear
    expect(after.workspaceId).toBeUndefined();
  });

  it('close() drops UN-FLUSHED pending events too (never writes one last stale batch)', async () => {
    vi.useFakeTimers();
    liveChannel.publish('user-pending-test', [{ type: 'narration', text: 'never-flushed' }], 'agentv3-u1-sessX');
    // close BEFORE the 1.5s flush timer fires — the pending batch must be discarded, not written.
    liveChannel.close('user-pending-test');
    vi.advanceTimersByTime(5000);
    const read = await liveChannel.readSince('user-pending-test', 0);
    expect(read.events).toEqual([]);
  });

  it('a cursor past the current seq returns nothing (a reader never re-applies what it already saw)', async () => {
    vi.useFakeTimers();
    liveChannel.publish('user-cursor-test', ['a', 'b'], 'agentv3-u1-sessB');
    vi.advanceTimersByTime(2000);
    const first = await liveChannel.readSince('user-cursor-test', 0);
    expect(first.events.length).toBe(2);
    const second = await liveChannel.readSince('user-cursor-test', first.seq);
    expect(second.events).toEqual([]);
    liveChannel.close('user-cursor-test');
  });
});
