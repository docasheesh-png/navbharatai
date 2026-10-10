/**
 * Q-766 — DELETING YOUR ACCOUNT MUST NOT TAKE AWAY WHAT SOMEBODY ELSE PAID FOR.
 *
 * 🔴 WHY THIS WAS A DECISION AND NOT A ONE-LINE FIX. Three stores are keyed to one person by a plain
 * `uid` field and all three survived account deletion. Registering them as ordinary erases would have
 * been one line in the registry — and wrong. They are PUBLIC LISTINGS, and an App Mart app can be
 * BOUGHT; Terms §4 makes such a purchase non-refundable *because the app can be run free before
 * buying*. Erasing a listing because its AUTHOR closed their account would take away something a
 * stranger paid for and cannot get back. So the row recorded the options and waited for the admin,
 * which is what the sixth rule asks for, and the admin chose recommendation (b): erase what was never
 * public, de-identify and unlist what was.
 *
 * 🔒 WHAT THE CODE SAID THAT THE RECOMMENDATION COULD NOT KNOW — both read, neither assumed:
 *   · `unlisted` STILL SERVES. `routes/navStore.ts` 404s a web app only on `status === 'removed'`, so
 *     "unlist" really does preserve the buyer's access. Moving it to `removed` would have satisfied the
 *     word and destroyed the purpose.
 *   · `gallery_apps` and `nav_store_apps` carry NO `priceInr`. Nothing in either can be bought, so the
 *     money argument — the entire basis of the recommendation — applies to the web store alone. The
 *     census had called `nav_store_apps` "purchasable"; it is not, and that is corrected.
 *
 * 🔴 AND THE MONEY PATH HAD TO CLOSE WITH IT. A de-identified paid listing is still purchasable, and
 * `settleRemixPurchase` credits `creatorUid` — a tombstone, whose wallet does not exist. Charging there
 * would be NavBharatAI taking a stranger's money for a person who cannot be paid.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  deIdentifyPublishedListings, creatorHasLeft, CREATOR_GONE, LISTING_POLICIES,
  type ListingFirestore,
} from '../src/server/lib/publishedListingErase';

const ME = 'author123';
const SOMEONE = 'other456';

/** An in-memory Firestore that records updates, so a "de-identified" claim can be checked field by field. */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [path, rows] of Object.entries(seed)) data.set(path, new Map(Object.entries(rows)));
  const col = (n: string) => { if (!data.has(n)) data.set(n, new Map()); return data.get(n)!; };
  const db: ListingFirestore = {
    collection: (name: string) => ({
      where: (field: string, _op: '==', value: unknown) => ({
        async get() {
          const docs = [];
          for (const [id, row] of col(name)) {
            if (row[field] !== value) continue;
            docs.push({
              id,
              data: () => row,
              ref: {
                async update(patch: Record<string, unknown>) {
                  for (const [k, v] of Object.entries(patch)) {
                    if (v === null) delete row[k]; else row[k] = v;
                  }
                },
                async delete() { col(name).delete(id); },
                collection(sub: string) {
                  const path = `${name}/${id}/${sub}`;
                  return {
                    limit(n: number) {
                      return {
                        async get() {
                          const ids = [...col(path).keys()].slice(0, n);
                          return { docs: ids.map((sid) => ({ ref: { async delete() { col(path).delete(sid); } } })) };
                        },
                      };
                    },
                  };
                },
              },
            });
          }
          return { docs };
        },
      }),
    }),
  };
  return { db, row: (p: string, id: string) => col(p).get(id), count: (p: string) => col(p).size, has: (p: string, id: string) => col(p).has(id) };
}

describe('Q-766 — a published app survives its author, and the author does not survive in it', () => {
  it('🔴 a LISTED paid app is kept, unlisted, and stripped of the person', async () => {
    const f = fakeDb({
      nav_store_web_apps: {
        app1: { uid: ME, status: 'listed', name: 'Their Game', priceInr: 49, workspaceId: `agentv3-${ME}-main` },
      },
      'nav_store_web_apps/app1/files': { 'index.html': { content: '<html>' } },
    });
    await deIdentifyPublishedListings(f.db, ME);
    const row = f.row('nav_store_web_apps', 'app1')!;
    // The app is STILL THERE — this is the whole point of the row.
    expect(f.has('nav_store_web_apps', 'app1')).toBe(true);
    expect(f.count('nav_store_web_apps/app1/files'), 'a buyer must still be able to run it').toBe(1);
    expect(row.name).toBe('Their Game');
    // The person is gone: the uid is a tombstone and the workspace id (which CONTAINS the uid) is cleared.
    expect(row.uid).toBe(CREATOR_GONE);
    expect(row.workspaceId).toBeUndefined();
    expect(row.creatorDeletedAt).toEqual(expect.any(Number));
    // And it has left the catalogue — but to `unlisted`, which still serves, never to `removed`.
    expect(row.status).toBe('unlisted');
  });

  it('🔒 it is moved to `unlisted`, NOT `removed` — because only `removed` 404s', () => {
    // The distinction that makes recommendation (b) work rather than merely sound right. Read from the
    // route, so a change there fails here instead of quietly breaking every buyer.
    const route = readFileSync(resolve(__dirname, '../src/server/routes/navStore.ts'), 'utf8');
    expect(route).toMatch(/found\.status === 'removed'\) return res\.status\(404\)/);
    expect(LISTING_POLICIES.find((p) => p.collection === 'nav_store_web_apps')!.unlistTo).toBe('unlisted');
  });

  it('a listing already out of the catalogue is stripped but not moved', async () => {
    const f = fakeDb({ nav_store_web_apps: { a: { uid: ME, status: 'unlisted', workspaceId: `agentv3-${ME}-x` } } });
    await deIdentifyPublishedListings(f.db, ME);
    const row = f.row('nav_store_web_apps', 'a')!;
    expect(row.uid).toBe(CREATOR_GONE);
    expect(row.status).toBe('unlisted');
  });

  it('a listing already `removed` is not resurrected into the catalogue', async () => {
    const f = fakeDb({ nav_store_web_apps: { a: { uid: ME, status: 'removed' } } });
    await deIdentifyPublishedListings(f.db, ME);
    expect(f.row('nav_store_web_apps', 'a')!.status).toBe('removed');
  });

  it('🔴 NEVER touches another author\'s listing', async () => {
    const f = fakeDb({
      nav_store_web_apps: {
        mine: { uid: ME, status: 'listed' },
        theirs: { uid: SOMEONE, status: 'listed', workspaceId: `agentv3-${SOMEONE}-main` },
      },
    });
    await deIdentifyPublishedListings(f.db, ME);
    const theirs = f.row('nav_store_web_apps', 'theirs')!;
    expect(theirs.uid).toBe(SOMEONE);
    expect(theirs.status).toBe('listed');
    expect(theirs.workspaceId).toBe(`agentv3-${SOMEONE}-main`);
  });

  it('refuses an empty uid rather than matching the wrong rows — and this one WRITES', async () => {
    const f = fakeDb({ nav_store_web_apps: {} });
    await expect(deIdentifyPublishedListings(f.db, '')).rejects.toThrow(/non-empty uid/);
  });
});

describe('Q-766 — what was never public is deleted outright, children first', () => {
  it('🔴 deletes a PENDING gallery submission: nobody ever saw it, nobody could buy it', async () => {
    const f = fakeDb({
      gallery_apps: {
        waiting: { uid: ME, status: 'pending', authorEmail: 'me@example.com', authorName: 'Me' },
        live: { uid: ME, status: 'approved', authorEmail: 'me@example.com', authorName: 'Me' },
      },
    });
    const report = await deIdentifyPublishedListings(f.db, ME);
    expect(f.has('gallery_apps', 'waiting')).toBe(false);
    // The published one is kept and stripped — including the two identity fields beyond the uid.
    const live = f.row('gallery_apps', 'live')!;
    expect(live.uid).toBe(CREATOR_GONE);
    expect(live.authorEmail).toBeUndefined();
    expect(live.authorName).toBeUndefined();
    expect(live.status).toBe('removed');
    const row = report.collections.find((c) => c.collection === 'gallery_apps')!;
    expect(row).toMatchObject({ deleted: 1, deIdentified: 1 });
  });

  it('🔴 clears the whole `developer` block — name, EMAIL and phone, not just the uid', async () => {
    // The field that made "de-identify" need reading rather than guessing: an APK submission carries a
    // developer's contact details, which a blanked uid would have left sitting in the record.
    const f = fakeDb({
      nav_store_apps: {
        app: { uid: ME, status: 'approved', developer: { name: 'Me', email: 'me@example.com', phone: '+91...' } },
      },
    });
    await deIdentifyPublishedListings(f.db, ME);
    const row = f.row('nav_store_apps', 'app')!;
    expect(row.developer).toBeUndefined();
    expect(row.uid).toBe(CREATOR_GONE);
  });

  it('a deleted listing takes its subcollections with it — Firestore does not cascade', async () => {
    // Only the web store declares subs, and only a never-public listing is deleted there (today: none),
    // so this exercises the path with a policy that does delete, proving the ordering is implemented.
    const f = fakeDb({
      nav_store_web_apps: { gone: { uid: ME, status: 'draft' } },
      'nav_store_web_apps/gone/files': { a: {}, b: {} },
      'nav_store_web_apps/gone/screenshots': { s1: {} },
    });
    const policy = { ...LISTING_POLICIES.find((p) => p.collection === 'nav_store_web_apps')!, deleteWhenStatusIn: ['draft'] };
    const report = await deIdentifyPublishedListings(f.db, ME, [policy]);
    expect(f.has('nav_store_web_apps', 'gone')).toBe(false);
    expect(f.count('nav_store_web_apps/gone/files')).toBe(0);
    expect(f.count('nav_store_web_apps/gone/screenshots')).toBe(0);
    expect(report.collections[0]).toMatchObject({ deleted: 1, children: 3 });
  });

  it('🔒 the real web-store policy deletes NOTHING, and says why', () => {
    // `unlisted` means either "never published" or "published then hidden" and the record cannot tell
    // them apart, so deleting on that state would destroy a purchase to save storage.
    expect(LISTING_POLICIES.find((p) => p.collection === 'nav_store_web_apps')!.deleteWhenStatusIn).toEqual([]);
  });
});

describe('Q-766 — the money path closes with the listing', () => {
  it('🔴 a purchase is delivered FREE rather than crediting a tombstone', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/lib/navStoreRemixPurchase.ts'), 'utf8');
    // Before any money moves: the guard sits above the purchase record and the wallet credit.
    const guard = src.indexOf('creatorHasLeft(creatorUid)');
    expect(guard, 'the purchase path must ask whether the creator still exists').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf('t.set(docRef, { appId, buyerUid'));
    expect(src).toMatch(/the creator has left NavBharatAI — delivered free/);
    // "Delivered free" is this function's own established answer whenever it cannot charge properly.
    expect(src).toMatch(/wallet unavailable — delivered free/);
  });

  it('the tombstone cannot be mistaken for a real account, in either direction', () => {
    expect(creatorHasLeft(CREATOR_GONE)).toBe(true);
    for (const live of ['abc123', '', null, undefined, 'deleted', '__deleted_account', CREATOR_GONE + 'x']) {
      expect(creatorHasLeft(live), String(live)).toBe(false);
    }
    // A Firebase uid is 28 characters of [A-Za-z0-9]; the tombstone's underscores put it outside that
    // set entirely, so no live account can ever collide with it.
    expect(CREATOR_GONE).toMatch(/^__.*__$/);
  });

  it('the eraser is wired into account deletion, and reported on its own line', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/profile.ts'), 'utf8');
    expect(route).toMatch(/deIdentifyPublishedListings\(listingDb, identity\.uid\)/);
    // Its own line in the response, because "de-identified" is not a deletion count and folding it into
    // one would tell the user the opposite of what happened to their published apps.
    expect(route).toMatch(/\n        listings,/);
  });

  it('every policy names its store, its identity fields and its reason', () => {
    expect(LISTING_POLICIES.map((p) => p.collection)).toEqual(['gallery_apps', 'nav_store_apps', 'nav_store_web_apps']);
    for (const p of LISTING_POLICIES) {
      expect(p.personalFields.length, p.collection).toBeGreaterThan(0);
      expect(p.uidField.length).toBeGreaterThan(0);
      expect(p.unlistTo.length).toBeGreaterThan(0);
      expect(p.why.length, p.collection).toBeGreaterThan(20);
    }
  });
});
