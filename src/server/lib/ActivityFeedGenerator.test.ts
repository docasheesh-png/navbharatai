import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateActivityFeedIntegration, ACTIVITYFEED_SERVICE_SOURCE } from './ActivityFeedGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateActivityFeedIntegration (wiring)', () => {
  it('emits the activity-feed service, routes and README', () => {
    const out = generateActivityFeedIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/activity/activityFeedService.ts');
    expect(paths).toContain('server/activity/routes.ts');
    expect(paths).toContain('server/activity/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/activity/routes.ts']).toContain('export const activityFeedRouter');
    expect(out.files['server/activity/routes.ts']).toContain('/unseen');
  });
});

// Materialize + execute the emitted domain logic — the stable-cursor-pagination + unseen-count rules are real
// business rules, verified against the actual emitted code.
describe('emitted ActivityFeedService — stable cursor pagination + unseen count (real logic)', () => {
  const artifact = join(here, `._activityfeed_emitted_${process.pid}.ts`);
  writeFileSync(artifact, ACTIVITYFEED_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface ActivityEvent { id: number; actor: string; verb: string; object: string; meta: Record<string, unknown>; createdAt: string }
  interface FeedPage { events: ActivityEvent[]; nextCursor: number | null }
  interface FeedQuery { cursor?: number | null; limit?: number }
  interface Service {
    record(actor: string, verb: string, object: string, meta?: Record<string, unknown>, now?: Date): ActivityEvent;
    feed(query?: FeedQuery): FeedPage;
    actorFeed(actor: string, query?: FeedQuery): FeedPage;
    markSeen(viewer: string): number;
    unseenCount(viewer: string): number;
    size(): number;
  }
  interface Emitted { ActivityFeedService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('assigns monotonic ids and validates required fields', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    const a = svc.record('alice', 'created', 'post:1');
    const b = svc.record('bob', 'liked', 'post:1');
    expect(b.id).toBe(a.id + 1);
    expect(() => svc.record('', 'x', 'y')).toThrow(/actor is required/);
    expect(() => svc.record('alice', '', 'y')).toThrow(/verb is required/);
    expect(() => svc.record('alice', 'x', '')).toThrow(/object is required/);
  });

  it('pages newest-first with a stable cursor and a correct nextCursor', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    for (let i = 1; i <= 5; i++) svc.record('u', 'did', `thing:${i}`); // ids 1..5
    const p1 = svc.feed({ limit: 2 });
    expect(p1.events.map((e) => e.id)).toEqual([5, 4]); // newest first
    expect(p1.nextCursor).toBe(4);
    const p2 = svc.feed({ cursor: p1.nextCursor, limit: 2 });
    expect(p2.events.map((e) => e.id)).toEqual([3, 2]);
    expect(p2.nextCursor).toBe(2);
    const p3 = svc.feed({ cursor: p2.nextCursor, limit: 2 });
    expect(p3.events.map((e) => e.id)).toEqual([1]); // last item
    expect(p3.nextCursor).toBeNull(); // no more pages
  });

  it('THE INVARIANT: appending new events mid-walk never duplicates or skips items', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    for (let i = 1; i <= 6; i++) svc.record('u', 'did', `thing:${i}`); // ids 1..6

    // Start paging the feed at page size 2. Fetch page 1 (ids 6,5).
    const p1 = svc.feed({ limit: 2 });
    expect(p1.events.map((e) => e.id)).toEqual([6, 5]);

    // Now a burst of NEW events arrives between page fetches (the live-feed race).
    svc.record('u', 'did', 'thing:7'); // id 7
    svc.record('u', 'did', 'thing:8'); // id 8

    // Continue the SAME walk with the cursor from page 1. It must keep returning strictly older ids —
    // the new events (7,8) do NOT leak into the walk and nothing gets skipped or repeated.
    const collected: number[] = [...p1.events.map((e) => e.id)];
    let cursor: number | null = p1.nextCursor;
    while (cursor !== null) {
      const page: FeedPage = svc.feed({ cursor, limit: 2 });
      collected.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
    }
    // The walk that began at id 6 must have visited exactly 6,5,4,3,2,1 — no dupes, no skips, and NOT 7/8.
    expect(collected).toEqual([6, 5, 4, 3, 2, 1]);
    expect(new Set(collected).size).toBe(collected.length); // no duplicates
    expect(collected).not.toContain(7);
    expect(collected).not.toContain(8);

    // A fresh walk from the top now sees the new events at the head.
    expect(svc.feed({ limit: 2 }).events.map((e) => e.id)).toEqual([8, 7]);
  });

  it('actorFeed filters to one actor with the same stable pagination', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    svc.record('alice', 'a', 'x'); // 1
    svc.record('bob', 'b', 'y');   // 2
    svc.record('alice', 'c', 'z'); // 3
    svc.record('bob', 'd', 'w');   // 4
    const page = svc.actorFeed('alice', { limit: 10 });
    expect(page.events.map((e) => e.id)).toEqual([3, 1]); // only alice, newest first
    expect(page.nextCursor).toBeNull();
  });

  it('unseenCount tracks events newer than markSeen', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    svc.record('u', 'a', 'x');
    svc.record('u', 'b', 'y');
    expect(svc.unseenCount('viewer')).toBe(2); // never seen anything
    svc.markSeen('viewer');
    expect(svc.unseenCount('viewer')).toBe(0); // caught up
    svc.record('u', 'c', 'z');
    svc.record('u', 'd', 'w');
    expect(svc.unseenCount('viewer')).toBe(2); // two new since markSeen
    svc.markSeen('viewer');
    expect(svc.unseenCount('viewer')).toBe(0);
  });

  it('caps and floors the page limit (1..100)', async () => {
    const { ActivityFeedService } = await load();
    const svc = new ActivityFeedService();
    for (let i = 0; i < 150; i++) svc.record('u', 'did', `t:${i}`);
    expect(svc.feed({ limit: 1000 }).events.length).toBe(100); // capped at 100
    expect(svc.feed({ limit: 0 }).events.length).toBe(1);      // floored at 1
    expect(svc.feed({ limit: -5 }).events.length).toBe(1);
  });
});
