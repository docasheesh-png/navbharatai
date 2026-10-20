import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildSourcePublication } from '../src/server/AgentV3/BuildSourcePublication';

afterEach(() => vi.useRealTimers());
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
describe('normal queued retirement joins owned source/plan publications', () => {
  it('cancels the progress timer and blocks new issue calls after body cleanup closes publication', async () => {
    vi.useFakeTimers();
    const writes: string[] = []; const publication = createBuildSourcePublication();
    publication.schedule(() => { void publication.issue(async () => { writes.push('stale timer'); return 'saved'; }); }, 3000);
    publication.close(); await vi.advanceTimersByTimeAsync(3000);
    expect(writes).toEqual([]);
    expect(await publication.join()).toBe(true);
    await publication.issue(async () => { writes.push('late child'); return 'saved'; });
    expect(writes).toEqual([]);
    expect(await publication.join()).toBe(false); // Observed late source work is not evidence of quiescence.
    expect(vi.getTimerCount()).toBe(0);
  });
  it('joins a no-snapshot final save and a pending plan-memory replacement before returning ready', async () => {
    const files = deferred<string>(); const memory = deferred<string>(); const publication = createBuildSourcePublication();
    publication.track(files.promise); publication.track(memory.promise);
    let joined = false; const finish = publication.join().then((value) => { joined = value; return value; });
    files.resolve('saved'); await Promise.resolve(); await Promise.resolve();
    expect(joined).toBe(false);
    memory.resolve('saved'); expect(await finish).toBe(true);
  });
  it.each(['failed', 'no-store', 'skipped-unconfirmed'])('does not grant readiness for %s publication', async (status) => {
    const publication = createBuildSourcePublication(); publication.track(Promise.resolve(status));
    expect(await publication.join()).toBe(false);
  });
  it('a hanging owned write pauses automatic continuation instead of treating the timeout as a drain', async () => {
    vi.useFakeTimers(); const publication = createBuildSourcePublication(); const write = deferred<string>();
    publication.track(write.promise); const joined = publication.join(1000);
    await vi.advanceTimersByTimeAsync(1000); expect(await joined).toBe(false);
    expect(vi.getTimerCount()).toBe(0); write.resolve('saved');
  });
  it('a post-close raw promise is tracked but cannot be mistaken for the earlier publication set', async () => {
    const publication = createBuildSourcePublication(); publication.close(); publication.track(Promise.resolve('saved'));
    expect(await publication.join()).toBe(false);
  });
});
