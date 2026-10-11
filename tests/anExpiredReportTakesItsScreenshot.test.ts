/**
 * Q-767 — WHEN A RECORD EXPIRES, ITS CHILDREN GO FIRST. FIRESTORE DOES NOT CASCADE.
 *
 * 🔴 THE DEFECT THIS CLOSES, BEFORE IT COULD SHIP. `purgeExpired` deleted each expired document with
 * `d.ref.delete()` and nothing else. That was harmless only because no policy had ever been written for
 * a collection that OWNS children — and Q-767 was about to write one. `user_reports/{id}` keeps its
 * screenshot in `user_reports/{id}/shot/{shotId}`, deliberately: a compressed image is a large fraction
 * of Firestore's 1 MiB document cap, so it had to be its own document. Expire the report alone and the
 * PICTURE survives — for ever, with no path left to reach it, delete it, or answer a request about it.
 * The one part of a support ticket that can show a person's face would have been the one part retention
 * never touched.
 *
 * 🧬 IT IS Q-134'S CLASS, IN THE OTHER MECHANISM. Q-134 found the account eraser deleting each
 * workspace's latest diagnostics report and orphaning its entire `history` subcollection; the fix added
 * `subs` to the ERASE registry. Nobody then asked whether the TTL purge — the second mechanism that
 * deletes documents — had the same hole. It did. Both now page children out first, with the same
 * loud-failure rule: a database handle that cannot reach a declared subcollection is a real error, not
 * something to shrug at, because the alternative is reporting a deletion that did not happen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  purgeExpired, retentionCutoffMs, RETENTION_POLICIES, cappedCollections, DEFAULT_MAX_PER_RUN,
  type RetentionFirestore, type RetentionPolicy, type RetentionQueryDoc,
} from '../src/server/lib/DataRetentionManager';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const OLD = NOW - 200 * 86_400_000;

/** A fake whose documents own children, and that remembers the exact order of deletions. */
function fakeDb(parents: Array<{ id: string; at: number; kids: string[] }>, opts: { noSubs?: boolean } = {}) {
  const order: string[] = [];
  const alive = new Set<string>();
  for (const p of parents) { alive.add(p.id); for (const k of p.kids) alive.add(`${p.id}/shot/${k}`); }

  const docFor = (p: { id: string; kids: string[] }): RetentionQueryDoc => ({
    ref: {
      delete: async () => { order.push(p.id); alive.delete(p.id); },
      // `noSubs` models a handle that cannot reach subcollections at all — an older or narrower fake.
      ...(opts.noSubs ? {} : {
        collection: (_name: string) => ({
          limit: (_n: number) => ({
            get: async () => ({
              docs: p.kids
                .filter((k) => alive.has(`${p.id}/shot/${k}`))
                .map((k) => ({
                  ref: { delete: async () => { order.push(`${p.id}/shot/${k}`); alive.delete(`${p.id}/shot/${k}`); } },
                })),
            }),
          }),
        }),
      }),
    },
  });

  const db: RetentionFirestore = {
    collection: () => ({
      doc: () => { throw new Error('not used by the purge'); },
      where: (_f: string, _op: '==' | '<', bound: unknown) => {
        const expired = parents.filter((p) => p.at < Number(bound) && alive.has(p.id));
        const q = { get: async () => ({ docs: expired.map(docFor) }), limit: () => q };
        return q;
      },
    }),
  };
  return { db, order, alive };
}

const POLICY: RetentionPolicy = {
  collection: 'user_reports', ttlDays: 180, timestampField: 'at', timestampKind: 'epochMs', subs: ['shot'],
};

describe('Q-767 — an expired report does not leave its screenshot behind', () => {
  it('🔴 deletes the screenshot AND the report, and nothing is left alive', async () => {
    const { db, alive } = fakeDb([{ id: 'rep_1', at: OLD, kids: ['image', 'shot_2'] }]);
    const report = await purgeExpired(db, NOW, [POLICY]);
    expect(alive.size, `orphaned for ever: ${[...alive].join(', ')}`).toBe(0);
    // Children count toward the tally, so the number reported is the number of documents really removed.
    expect(report.totalDeleted).toBe(3);
    expect(report.collections[0]).toMatchObject({ collection: 'user_reports', deleted: 3 });
    expect(report.collections[0].error).toBeUndefined();
  });

  it('🔴 CHILDREN FIRST — the one ordering that can ever be correct', async () => {
    // Deleting the parent first is not merely untidy: there is then no reference from which to reach the
    // children, so they are unreachable by any later run of anything.
    const { db, order } = fakeDb([{ id: 'rep_1', at: OLD, kids: ['image'] }]);
    await purgeExpired(db, NOW, [POLICY]);
    expect(order).toEqual(['rep_1/shot/image', 'rep_1']);
  });

  it('a report that is NOT expired keeps its screenshot', async () => {
    // The bound is `<` cutoff, so the purge can only ever remove old records. The child sweep must not
    // run wider than the parent query that selected it.
    const { db, alive, order } = fakeDb([{ id: 'fresh', at: NOW - 86_400_000, kids: ['image'] }]);
    const report = await purgeExpired(db, NOW, [POLICY]);
    expect(order).toEqual([]);
    expect(alive.has('fresh')).toBe(true);
    expect(alive.has('fresh/shot/image')).toBe(true);
    expect(report.totalDeleted).toBe(0);
  });

  it('several expired reports each take their own children', async () => {
    const { db, alive, order } = fakeDb([
      { id: 'a', at: OLD, kids: ['image'] },
      { id: 'b', at: OLD, kids: ['image', 'x'] },
    ]);
    await purgeExpired(db, NOW, [POLICY]);
    expect(alive.size).toBe(0);
    expect(order).toEqual(['a/shot/image', 'a', 'b/shot/image', 'b/shot/x', 'b']);
  });

  it('🔒 a handle that cannot reach the subcollection FAILS LOUDLY and keeps the parent', async () => {
    // The alternative — shrugging and deleting the parent anyway — would report a successful expiry while
    // leaving the heaviest, most personal half of the record alive and unreachable.
    const { db, alive } = fakeDb([{ id: 'rep_1', at: OLD, kids: ['image'] }], { noSubs: true });
    const report = await purgeExpired(db, NOW, [POLICY]);
    expect(report.collections[0].error).toMatch(/cannot reach the 'shot' subcollection/);
    expect(report.totalDeleted).toBe(0);
    expect(alive.has('rep_1'), 'the parent must survive a failure that leaves its children behind').toBe(true);
  });

  it('a policy with NO subs is untouched by any of this', async () => {
    // Every other policy in the registry owns no children, and must keep behaving exactly as before.
    const { db, order } = fakeDb([{ id: 'log_1', at: OLD, kids: [] }]);
    await purgeExpired(db, NOW, [{ ...POLICY, collection: 'server_logs', subs: undefined }]);
    expect(order).toEqual(['log_1']);
  });

  it('the registry declares `subs` exactly where a collection really owns children', () => {
    // `user_reports` is the only policied collection with a subcollection today. If another gains one,
    // this is the line that should make somebody look.
    const withSubs = RETENTION_POLICIES.filter((p) => (p.subs?.length ?? 0) > 0).map((p) => p.collection);
    expect(withSubs).toEqual(['user_reports']);
    expect(RETENTION_POLICIES.find((p) => p.collection === 'user_reports')!.subs).toEqual(['shot']);
  });

  it('the cutoff arithmetic the purge is given is the window the policy states', () => {
    expect(retentionCutoffMs(NOW, 180)).toBe(NOW - 180 * 86_400_000);
  });
});

/**
 * Q-767, the other half — A WINDOW NOBODY CAN KEEP MUST NOT REPORT ITSELF KEPT.
 *
 * Each policy may delete at most `maxPerRun` documents a night. For a store whose ARRIVAL rate is
 * higher than that cap, the window is fiction: the collection grows for ever while the census, the
 * Load board and the Privacy Policy all say it is on a clock — and the purge's own log line, a single
 * total, read exactly like a clean run. `build_events` takes one row per published bus event, so it is
 * the realistic candidate, and nothing in a session can measure its real rate. So this does not guess a
 * larger number: it makes the condition announce itself, which is the fifth rule's "fix the system's
 * honesty too" rather than a number chosen by feel.
 */
describe('Q-767 — a purge that ran out of allowance says so', () => {
  const policy: RetentionPolicy = {
    collection: 'build_events', ttlDays: 90, timestampField: 'ts', timestampKind: 'epochMs', maxPerRun: 2,
  };

  it('🔴 flags the collection when the run deleted its full allowance', async () => {
    const { db } = fakeDb([
      { id: 'e1', at: OLD, kids: [] }, { id: 'e2', at: OLD, kids: [] }, { id: 'e3', at: OLD, kids: [] },
    ]);
    // The fake's `limit` is a no-op, so the query returns all three and the real guard is the cap in
    // the purge itself — which is the thing under test.
    const report = await purgeExpired(db, NOW, [policy]);
    expect(report.collections[0].capped, 'a full-allowance run must not look like a clean one').toBe(true);
    expect(cappedCollections(report)).toEqual(['build_events']);
  });

  it('does NOT flag a run that found less than its allowance — the ordinary case', async () => {
    const { db } = fakeDb([{ id: 'e1', at: OLD, kids: [] }]);
    const report = await purgeExpired(db, NOW, [policy]);
    expect(report.collections[0].capped).toBeUndefined();
    expect(cappedCollections(report)).toEqual([]);
  });

  it('and a run that found nothing is not flagged either', async () => {
    const { db } = fakeDb([{ id: 'fresh', at: NOW, kids: [] }]);
    const report = await purgeExpired(db, NOW, [policy]);
    expect(report.totalDeleted).toBe(0);
    expect(cappedCollections(report)).toEqual([]);
  });

  it('🔒 the nightly job really reports it, instead of printing a clean total', () => {
    // A flag no caller reads is the same silence in a new place. `server.ts` sits at the repo ROOT, which
    // is how a dead wiring there has escaped a `src/`-scoped search before (safeguard #6).
    const boot = readFileSync(resolve(__dirname, '../server.ts'), 'utf8');
    expect(boot).toMatch(/cappedCollections/);
    expect(boot).toMatch(/hit the per-run cap on/);
  });

  it('every policy either takes the shared default or states its own cap deliberately', () => {
    // Not a style rule: `maxPerRun` is the one field whose wrong value fails SILENTLY and for ever, so an
    // override must be a number somebody chose, never a leftover.
    for (const p of RETENTION_POLICIES) {
      if (p.maxPerRun === undefined) continue;
      expect(p.maxPerRun, `${p.collection} overrides the cap — it must mean to`).toBeGreaterThan(0);
      expect(p.maxPerRun).not.toBe(DEFAULT_MAX_PER_RUN);
    }
  });
});
