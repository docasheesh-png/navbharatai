import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveChannel, liveEventsAllowedFor } from './LiveChannel';

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
