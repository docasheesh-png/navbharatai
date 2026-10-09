/**
 * Q-784 — IF AN ERASER DELETES A PARENT, SOMETHING MUST DELETE ITS CHILDREN FIRST.
 *
 * 🔴 WHY THIS EXISTS AS A SCAN AND NOT AS A THIRD FIX. Firestore does not cascade, and this repo has
 * now found the same consequence three separate times:
 *
 *   · Q-134 (2026-10-05) — the account erase deleted each workspace's latest diagnostics report and
 *     left its whole `history` subcollection behind: every past build report, intact and unreachable.
 *   · Q-767 (2026-10-09) — `purgeExpired` would have done it to `user_reports/{id}/shot`, orphaning
 *     the screenshot of every expired support ticket.
 *   · Q-784 (2026-10-09) — `shares` was erased by `{field:'ownerId'}` with no `subs`, so every
 *     `shares/{token}/feedback/{autoId}` a visitor left on a shared app survived the owner's account.
 *
 * Each time the instance was fixed and the CLASS was left to be rediscovered by whoever happened to
 * read the right store next. Twice the capability to express the fix already existed and the entry
 * simply did not use it, which is the worst version: nothing was missing except somebody noticing.
 *
 * 🔒 SO THE HUNT IS MECHANICAL NOW. This reads every `<db>.collection(A).doc(…).collection(B)` write in
 * `src/server` — resolving both names through the file's own string constants, because a constant's
 * NAME is exactly what hid three stores from the collection census — and asserts the implication: if
 * ANY eraser or purge is registered to delete A, then B is declared somewhere that deletes it first.
 * A new parent/child pair in an erased collection fails here on the day it is written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  USER_SCOPED_COLLECTIONS, USER_SCOPED_SUBCOLLECTIONS, RETENTION_POLICIES,
} from '../src/server/lib/DataRetentionManager';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../src/server/lib/workspaceDataErase';

const root = resolve(__dirname, '..');

/**
 * `<handle>.collection(A).doc(…).collection(B)`.
 *
 * A and B must each be a quoted literal or an UPPER_CASE constant — never a lowercase variable. That
 * is not tidiness: `DataRetentionManager`'s own generic loop contains `parent.doc(uid).collection(sub)`,
 * and reading those as a store called `parent` with a child called `sub` is precisely the kind of
 * false positive that gets a scan's findings dismissed.
 */
const PAIR = /\b(?:db|d|store)\.collection\(\s*('[a-zA-Z0-9_]+'|[A-Z][A-Z0-9_]*)\s*\)\s*\.doc\([^()]*(?:\([^()]*\))?[^()]*\)\s*\.collection\(\s*('[a-zA-Z0-9_]+'|[A-Z][A-Z0-9_]*)\s*\)/g;
const STRING_CONST = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'([a-zA-Z0-9_]+)'/g;

interface Pair { parent: string; child: string; file: string }

function scanPairs(): Pair[] {
  const out: Pair[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.ts$/.test(p) || /\.test\.ts$/.test(p)) continue;
      const src = readFileSync(p, 'utf8');
      const named = new Map<string, string>();
      STRING_CONST.lastIndex = 0;
      for (const m of src.matchAll(STRING_CONST)) named.set(m[1], m[2]);
      const value = (token: string): string | null =>
        token.startsWith("'") ? token.slice(1, -1) : named.get(token) ?? null;
      PAIR.lastIndex = 0;
      for (const m of src.matchAll(PAIR)) {
        const parent = value(m[1]);
        const child = value(m[2]);
        if (parent && child) out.push({ parent, child, file: p.replace(`${root}/`, '') });
      }
    }
  };
  walk(join(root, 'src/server'));
  return out;
}

/**
 * Parents that have children and that NO eraser deletes — so there is nothing to cascade from, and the
 * implication below is silent about them. Each needs the reason, or this list becomes the hiding place
 * the whole test was written to remove.
 */
const PARENT_IS_NEVER_DELETED: Record<string, string> = {
  teams: 'classified `platform`: a team outlives any one member, and removing a member is a status '
    + 'change in its `members` sub, never a delete of the team (Q-682)',
  nav_store_web_apps: 'a public App Mart listing, `blocked` on Q-766 (what happens to a purchasable '
    + "listing when its author leaves is the admin's decision) with its subcollections owned by Q-682",
  promptAudits: 'the parent document is never written — only `promptAudits/{uid}/entries` exists, which '
    + 'is a USER_SCOPED_SUBCOLLECTIONS entry; registering the parent would report `deleted: 0` for ever',
  build_history: "erased by `derivedIdErase.ts`, which sweeps its `versions` sub first — the id is a "
    + 'bare sessionId that neither registry can express (Q-764)',
};

describe('Q-784 — no eraser deletes a parent and leaves its children unreachable', () => {
  const pairs = scanPairs();

  it('the scan actually found the writes — a silent zero would pass everything', () => {
    // The guard on the guard. A regex that stops matching makes every assertion below vacuously true,
    // which is how a test keeps reporting green about a thing it no longer looks at.
    expect(pairs.length).toBeGreaterThan(14);
    const seen = new Set(pairs.map((p) => `${p.parent}/${p.child}`));
    // Three witnesses: the Q-134 instance, the Q-767 instance, and the Q-784 instance.
    expect(seen).toContain('workspace_diagnostics_v3/history');
    expect(seen).toContain('user_reports/shot');
    expect(seen).toContain('shares/feedback');
    // And the false positive the pattern is written to exclude stays excluded.
    expect([...seen].filter((s) => s.startsWith('parent/'))).toEqual([]);
  });

  it('🔒 every child of an ERASED parent is declared, so it dies with its parent', () => {
    const userEntry = new Map(USER_SCOPED_COLLECTIONS.map((c) => [c.collection, c]));
    const userSubs = new Set(USER_SCOPED_SUBCOLLECTIONS.map((s) => `${s.parent}/${s.sub}`));
    // One collection can register two subcollections as two rows (nbai_app_data has `records` and
    // `ops`). A Map of the row itself keeps only the last row, which would call the first child
    // undeclared even though subcollectionsToErase deletes every one of them before the parent.
    const workspaceSubs = new Map<string, string[]>();
    for (const c of WORKSPACE_SCOPED_COLLECTIONS) {
      const list = workspaceSubs.get(c.collection) ?? [];
      if (c.sub && !list.includes(c.sub)) list.push(c.sub);
      workspaceSubs.set(c.collection, list);
    }
    const policy = new Map(RETENTION_POLICIES.map((p) => [p.collection, p]));

    const orphaning: string[] = [];
    for (const { parent, child, file } of pairs) {
      const u = userEntry.get(parent);
      const wSubs = workspaceSubs.get(parent);
      const r = policy.get(parent);
      if (!u && !wSubs && !r) {
        // Nothing deletes this parent. It must say so deliberately, not by omission.
        if (!PARENT_IS_NEVER_DELETED[parent]) {
          orphaning.push(`${parent}/${child} (${file}) — parent is in no erase path and no recorded reason`);
        }
        continue;
      }
      const declared =
        (u?.subs ?? []).includes(child)
        || userSubs.has(`${parent}/${child}`)
        || (wSubs ?? []).includes(child)
        || (r?.subs ?? []).includes(child);
      if (!declared) {
        orphaning.push(`${parent}/${child} (${file}) — the parent is deleted but this child is not`);
      }
    }
    expect(
      orphaning,
      'Firestore does not cascade, so each of these would survive its parent, intact and with no path '
      + 'left to reach it — Q-134, Q-767 and Q-784 were all this:\n' + orphaning.join('\n'),
    ).toEqual([]);
  });

  it('every parent excused from the implication states WHY', () => {
    for (const [name, why] of Object.entries(PARENT_IS_NEVER_DELETED)) {
      expect(why.length, `${name} is excused with no reason`).toBeGreaterThan(30);
    }
    // And the excuse list may not grow stale: a parent listed here that IS now erased must move out,
    // or the implication above would skip a collection somebody started deleting.
    const erased = new Set([
      ...USER_SCOPED_COLLECTIONS.map((c) => c.collection),
      ...WORKSPACE_SCOPED_COLLECTIONS.map((c) => c.collection),
      ...RETENTION_POLICIES.map((p) => p.collection),
    ]);
    const nowErased = Object.keys(PARENT_IS_NEVER_DELETED).filter((n) => erased.has(n));
    expect(nowErased, `listed as never-deleted but now erased: ${nowErased.join(', ')}`).toEqual([]);
  });

  it("🔴 `shares` declares its visitors' feedback — the instance that opened this row", () => {
    const shares = USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'shares');
    expect(shares, 'a share link is the user\'s own and must be erased with the account').toBeDefined();
    expect(shares!.subs, 'ShareStore.ts:276 writes shares/{token}/feedback/{autoId}').toEqual(['feedback']);
  });
});
