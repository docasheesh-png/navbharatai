// Q-3392: the online Royale daily match-start cap is ONE count per app per UTC day across every Cloud Run instance,
// not one per instance — and a store that does not answer falls back to the instance's own cap, said in the log.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoyaleMatchService, LONE_WAIT_MS, CLAIM_TIMEOUT_MS, type Conn, type ServiceOptions } from '../src/server/lib/royaleOnline/matchService';
import { dailyStartClaimer, claimDailyStartInFirestore, DAY_MS, DAILY_START_COUNTER, type ClaimDailyStart } from '../src/server/lib/royaleOnline/dailyStartCap';
import { windowKey, type RateCounterStore } from '../src/server/lib/DurableRateLimit';

type Inbox = Array<Record<string, unknown>>;
const fakeConn = (): Conn & { inbox: Inbox } => {
  const inbox: Inbox = [];
  return { inbox, send: (m) => { inbox.push(m); }, close: () => { /* noop */ } };
};

/** One fake Firestore: a document per windowKey, with an atomic increment (as `FieldValue.increment` is). */
function sharedFirestore(opts: { holdReads?: boolean } = {}) {
  const docs = new Map<string, number>();
  const held: Array<() => void> = [];
  const storeFor = (appId: string, now: number): RateCounterStore => ({
    async incrementAndRead() {
      const id = windowKey(DAILY_START_COUNTER, appId, now, DAY_MS);
      const after = (docs.get(id) ?? 0) + 1;
      docs.set(id, after);
      if (opts.holdReads) await new Promise<void>((r) => held.push(r));
      return docs.get(id)!; // the read sees every increment that landed before it, like Firestore
    },
  });
  return { docs, claimer: dailyStartClaimer(storeFor), release: () => { while (held.length) held.shift()!(); }, heldCount: () => held.length };
}

const clock = { now: Date.UTC(2026, 10, 26, 10, 0, 0) };
const instance = (o: ServiceOptions) => new RoyaleMatchService({ now: () => clock.now, botsAllowed: true, ...o });

/** One lone player queues on `svc`; returns their inbox. */
function queueOne(svc: RoyaleMatchService, appId = 'store-app') {
  const c = fakeConn();
  const id = svc.connect(appId, c)!;
  svc.message(id, { t: 'queue' });
  return c.inbox;
}
const starts = (boxes: Inbox[]) => boxes.filter((b) => b.some((m) => m.t === 'start')).length;
const dailyRefused = (boxes: Inbox[]) => boxes.filter((b) => b.some((m) => m.t === 'full' && /today's online match limit/.test(String(m.reason)))).length;

afterEach(() => { vi.useRealTimers(); clock.now = Date.UTC(2026, 10, 26, 10, 0, 0); });

describe('two instances sharing one counter cannot exceed the cap together', () => {
  it('cap 3: six lone players over two instances ⇒ exactly 3 matches start, the rest are told the daily limit', async () => {
    const fs = sharedFirestore();
    const quotas = { MAX_MATCHES_PER_APP_PER_DAY: 3 };
    const a = instance({ quotas, claimDailyStart: fs.claimer }), b = instance({ quotas, claimDailyStart: fs.claimer });
    const boxes: Inbox[] = [];
    for (let round = 0; round < 3; round++) {
      boxes.push(queueOne(a), queueOne(b));
      clock.now += LONE_WAIT_MS + 1;
      a.tick(); b.tick();
      await a.settled(); await b.settled();
    }
    expect(starts(boxes)).toBe(3);
    expect(dailyRefused(boxes)).toBe(3);
    expect(a.counters.matchesStarted + b.counters.matchesStarted).toBe(3);
    // Each instance alone would have allowed 3; together they are held to 3, not 6.
    expect(a.counters.matchesStarted).toBeLessThan(3 + 3);
  });

  it('a race for the LAST slot: both instances increment before either reads ⇒ at most one start (one early, never late)', async () => {
    const fs = sharedFirestore({ holdReads: true });
    const quotas = { MAX_MATCHES_PER_APP_PER_DAY: 1 };
    const a = instance({ quotas, claimDailyStart: fs.claimer }), b = instance({ quotas, claimDailyStart: fs.claimer });
    const boxes = [queueOne(a), queueOne(b)];
    clock.now += LONE_WAIT_MS + 1;
    a.tick(); b.tick();
    await vi.waitFor(() => expect(fs.heldCount()).toBe(2));
    fs.release();
    await a.settled(); await b.settled();
    // Both read a count of 2 against a cap of 1, so both are refused: the slot is lost at the boundary, the cap is
    // never exceeded. That is the increment-then-read rule (DurableRateLimit `decideAfterIncrement`).
    expect(starts(boxes)).toBeLessThanOrEqual(1);
    expect(starts(boxes) + dailyRefused(boxes)).toBe(2);
    expect(fs.docs.get(windowKey(DAILY_START_COUNTER, 'store-app', clock.now, DAY_MS))).toBe(2);
  });

  it('after "full", the instance refuses new players without asking again — until the next UTC day', async () => {
    let calls = 0;
    const claimer: ClaimDailyStart = async () => { calls++; return 'full'; };
    const a = instance({ claimDailyStart: claimer });
    const first = queueOne(a);
    clock.now += LONE_WAIT_MS + 1; a.tick(); await a.settled();
    expect(dailyRefused([first])).toBe(1);
    const second = queueOne(a);
    expect(dailyRefused([second])).toBe(1);
    expect(calls).toBe(1);
    clock.now = Date.UTC(2026, 10, 27, 0, 0, 1); // a new UTC day
    const third = queueOne(a);
    expect(third.some((m) => m.t === 'queued')).toBe(true);
    clock.now += LONE_WAIT_MS + 1; a.tick(); await a.settled();
    expect(calls).toBe(2);
  });

  it('the counter is one document per app per UTC day', () => {
    const before = windowKey(DAILY_START_COUNTER, 'app1', Date.UTC(2026, 10, 26, 23, 59, 59), DAY_MS);
    const after = windowKey(DAILY_START_COUNTER, 'app1', Date.UTC(2026, 10, 27, 0, 0, 0), DAY_MS);
    expect(before).not.toBe(after);
    expect(windowKey(DAILY_START_COUNTER, 'app1', Date.UTC(2026, 10, 26, 0, 0, 0), DAY_MS)).toBe(before);
    expect(windowKey(DAILY_START_COUNTER, 'app2', Date.UTC(2026, 10, 26, 1), DAY_MS)).not.toBe(before);
  });
});

describe('a store that does not answer falls back to the in-memory cap, and the log says so', () => {
  const throwing = dailyStartClaimer(() => ({ async incrementAndRead(): Promise<number> { throw new Error('UNAVAILABLE'); } }));

  it('a store error never blocks play: the match starts, the log says the cap is per instance, the local cap still holds', async () => {
    const lines: string[] = [];
    const a = instance({ quotas: { MAX_MATCHES_PER_APP_PER_DAY: 1 }, claimDailyStart: throwing, log: (l) => lines.push(l) });
    const first = queueOne(a);
    clock.now += LONE_WAIT_MS + 1; a.tick(); await a.settled();
    expect(starts([first])).toBe(1);
    expect(a.counters.sharedCapFallbacks).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/shared daily match-start counter did not answer.*in-memory cap of 1 per app per day on THIS instance/);
    const second = queueOne(a);
    expect(dailyRefused([second])).toBe(1); // the instance's own cap still bounds it
  });

  it('no database handle is "unavailable", never "allowed" (the production claimer under test has no Firestore)', async () => {
    await expect(claimDailyStartInFirestore('store-app', 300, clock.now)).resolves.toBe('unavailable');
    await expect(throwing('store-app', 300, clock.now)).resolves.toBe('unavailable');
  });

  it('a claim that hangs is treated as unavailable after CLAIM_TIMEOUT_MS, so a slow store cannot freeze the queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const lines: string[] = [];
    const a = instance({ claimDailyStart: () => new Promise(() => { /* never answers */ }), log: (l) => lines.push(l) });
    const first = queueOne(a);
    clock.now += LONE_WAIT_MS + 1; a.tick();
    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS + 1);
    await a.settled();
    expect(starts([first])).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it('the fallback warning is not repeated on every start', async () => {
    const lines: string[] = [];
    const a = instance({ claimDailyStart: throwing, log: (l) => lines.push(l) });
    for (let i = 0; i < 3; i++) { queueOne(a); clock.now += LONE_WAIT_MS + 1; a.tick(); await a.settled(); }
    expect(a.counters.sharedCapFallbacks).toBe(3);
    expect(lines).toHaveLength(1);
  });
});

describe('the production service is wired to the shared counter', () => {
  it('royaleWs builds the live service with the Firestore claimer, on the durable limiter counter with a 24 h window', () => {
    const ws = readFileSync('src/server/lib/royaleOnline/royaleWs.ts', 'utf8');
    expect(ws).toMatch(/new RoyaleMatchService\(\{\s*claimDailyStart: claimDailyStartInFirestore\s*\}\)/);
    const cap = readFileSync('src/server/lib/royaleOnline/dailyStartCap.ts', 'utf8');
    expect(cap).toMatch(/firestoreRateCounter\(db, DAILY_START_COUNTER, appId, DAY_MS, now\)/);
    expect(DAY_MS).toBe(86_400_000);
  });
});
