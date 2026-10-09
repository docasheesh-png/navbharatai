/**
 * EVERY FIRESTORE SUBCOLLECTION MUST BE CLASSIFIED, OR THIS FAILS (Q-134, 2026-10-05).
 *
 * `everyCollectionIsClassified` makes every TOP-LEVEL collection declare what it is. Subcollections were
 * outside it, and Firestore does not cascade, so the gaps were invisible from both sides:
 *
 *   · `workspace_diagnostics_v3/{ws}/history` — every past build report — grew for ever, and the
 *     account erase deleted each workspace's latest report while leaving its whole history behind.
 *   · `users/{uid}/deviceTokens` and `users/{uid}/notifications` survived account deletion, because
 *     deleting `users/{uid}` does not delete what lies under it.
 *   · `promptAudits/{uid}/entries`, `workspace_user_actions_v1/{ws}/items` and `code_reviews/{ws}/comments`
 *     were in no erase path and no retention policy at all.
 *
 * A subcollection is GUILTY UNTIL LISTED: a new `.doc(…).collection(…)` in server code fails CI until
 * someone decides what it is. Each kind carries an obligation this test then checks against the real
 * registries, so the label cannot drift from what the code does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'glob';
import {
  USER_SCOPED_SUBCOLLECTIONS, SUBCOLLECTION_RETENTION_POLICIES,
  USER_SCOPED_COLLECTIONS, RETENTION_POLICIES, FOREIGN_PARENT_USER_DOCS,
} from '../src/server/lib/DataRetentionManager';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../src/server/lib/workspaceDataErase';

const root = resolve(__dirname, '..');

type Kind =
  /** Under a workspace document. MUST be in WORKSPACE_SCOPED_COLLECTIONS with this sub (erased with the account). */
  | { kind: 'workspace'; parent: string }
  /** Under a document whose id is the uid. MUST be in USER_SCOPED_SUBCOLLECTIONS (erased with the account). */
  | { kind: 'user'; parent: string }
  /**
   * Capped per parent by the store itself, so it cannot grow with time.
   *
   * `parent` is optional and only needed when such a subcollection ALSO carries a clock — Q-766's
   * `nav_store_web_apps` → `reports` is bounded per listing and still gets 180 days, because it holds the
   * REPORTER's identity and must outlive the author's departure.
   */
  | { kind: 'bounded'; why: string; parent?: string }
  /**
   * Declared as a `subs` of the PARENT's own `USER_SCOPED_COLLECTIONS` entry, which deletes the children
   * before the parent (Q-682). Covers both parent shapes the registry supports: a parent found by a
   * FIELD (`shares`, by `ownerId`) and a parent whose doc id is the uid (`teams`).
   */
  | { kind: 'parent-subs'; parent: string }
  /**
   * Bounded by the PARENT's own `RETENTION_POLICIES` entry carrying `subs`, so the children expire with
   * the record rather than outliving it (Q-767: `user_reports/{id}/shot`).
   */
  | { kind: 'retained-parent'; parent: string }
  /** Neither erased nor bounded yet: an OPEN queue row owns the decision. */
  | { kind: 'open'; row: string; why: string };

/** "file › sub" → what it is. `clock` adds the second obligation: a SUBCOLLECTION_RETENTION_POLICIES entry. */
const CLASSIFICATION: Record<string, Kind & { clock?: true; erasedBy?: string; foreignParent?: true }> = {
  'src/server/AgentV3/WorkspaceFileStore.ts › files': { kind: 'workspace', parent: 'workspace_files_v3' },
  'src/server/AgentV3/WorkspaceAssetStore.ts › assets': { kind: 'workspace', parent: 'workspace_assets_v3' },
  'src/server/AgentV3/CheckpointStore.ts › items': { kind: 'workspace', parent: 'workspace_checkpoints_v3' },
  'src/server/AgentV3/EmbeddingStore.ts › files': { kind: 'workspace', parent: 'workspace_embeddings_v3' },
  'src/server/AgentV3/DiagnosticsStore.ts › history': { kind: 'workspace', parent: 'workspace_diagnostics_v3', clock: true },
  'src/server/AgentV3/UserActionStore.ts › items': { kind: 'workspace', parent: 'workspace_user_actions_v1' },
  'src/server/lib/CodeReviewStore.ts › comments': { kind: 'workspace', parent: 'code_reviews' },

  'src/server/lib/DeviceTokenStore.ts › deviceTokens': { kind: 'user', parent: 'users' },
  'src/server/lib/MentionNotificationStore.ts › notifications': { kind: 'user', parent: 'users' },
  'src/server/AgentV3/PromptAuditStore.ts › entries': { kind: 'user', parent: 'promptAudits', clock: true },

  /**
   * 🔴 `bounded` WAS TRUE AND WAS NOT ENOUGH (Q-764, 2026-10-09). This subcollection cannot GROW —
   * `MAX_SAVED_VERSIONS` per session, oldest dropped on every save — and that is the only thing this
   * kind ever claimed. It said nothing about account deletion, and `build_history/{sessionId}` sat
   * outside both erasers (a bare sessionId, no uid field), so every saved version of every app
   * survived for ever. `erasedBy` is the obligation that was missing: a subcollection may be bounded
   * AND still owe an erasure, and the test now reads the named module rather than trusting this line.
   */
  'src/server/project/BuildHistoryStore.ts › versions': {
    kind: 'bounded',
    why: 'MAX_SAVED_VERSIONS per session; the oldest is deleted on every save',
    erasedBy: 'src/server/lib/derivedIdErase.ts',
  },
  'src/server/lib/navStoreWebData.ts › dataSub': { kind: 'bounded', why: 'NavData rows: MAX_ROWS_PER_APP per app, the quota that IS the admin authorization' },

  /**
   * ── Q-682, resolved 2026-10-09 as that row recommended ───────────────────────────────────────────
   * The admin's answer to "yes/no per item" was to complete the row, so its own recommendations stand.
   */
  'src/server/lib/ShareStore.ts › feedback': { kind: 'parent-subs', parent: 'shares' },
  /**
   * TWO obligations, because it has two homes. `teams/{myUid}/members` is my own team's list, erased as
   * a `subs` of the `teams` entry; `teams/{someoneElse}/members/{myUid}` is MY record under SOMEBODY
   * ELSE'S parent — the fifth reachability shape, which no registry could express until Q-682, so a
   * departing member's uid and email stayed in every team they had joined.
   */
  'src/server/lib/TeamStore.ts › members': { kind: 'parent-subs', parent: 'teams', foreignParent: true },
  'src/server/lib/TeamLibraryStore.ts › library': { kind: 'parent-subs', parent: 'teams' },
  /**
   * ── Q-682 items 6–8, resolved with Q-766 (2026-10-09) ────────────────────────────────────────────
   * These three ARE the app. A listing can have been bought, and Terms §4 makes that purchase
   * non-refundable *because the app can be run free before buying* — so they are deliberately KEPT when
   * the author leaves: `publishedListingErase.ts` de-identifies and unlists the listing instead of
   * deleting it, and `unlisted` still serves (only `removed` 404s). They are bounded per listing, not
   * by time: one app's files, one baked page per version, at most a handful of screenshots.
   */
  'src/server/lib/navStoreWeb.ts › files': { kind: 'bounded', why: "the published app's own bytes, one doc per file of one listing; kept when the author leaves because a buyer paid for it (Q-766), and deleted with the listing when it was never public" },
  'src/server/lib/navStoreWeb.ts › baked': { kind: 'bounded', why: 'one pre-rendered page per published version of one listing, capped at BAKED_MAX_GZ_BYTES; same reasoning as `files` (Q-766)' },
  'src/server/lib/navStoreWeb.ts › screenshots': { kind: 'bounded', why: 'the handful of images the creator uploaded for one listing (`sanitizeScreenshots` caps the count); same reasoning as `files` (Q-766)' },
  /**
   * The ONE sub here that does not belong to the author at all: it holds the REPORTER's uid. So it
   * survives the author's departure — an abuse record an author can erase by closing their account is
   * not a record (the `safety_flags` precedent) — and is bounded by a clock instead, at the 180 days
   * Privacy §9 publishes for every other report-and-review record.
   */
  'src/server/lib/navStoreWeb.ts › reports': { kind: 'bounded', why: "what a viewer reported about a published app, holding the REPORTER's uid rather than the author's", clock: true, parent: 'nav_store_web_apps' },
  /**
   * Q-682's recommendation (5) — the 180-day retention policy, not deletion on erase: a support ticket
   * is a record a person must be able to review, like `app_mart_comment_reports`. Shipped in Q-767,
   * which also had to teach `purgeExpired` to delete children at all.
   */
  'src/server/lib/userReportStore.ts › shot': { kind: 'retained-parent', parent: 'user_reports' },
};

/** The generic erasers name subcollections through a variable; they are the mechanism, not a store. */
const MECHANISM = new Set([
  'src/server/lib/DataRetentionManager.ts',
  'src/server/lib/workspaceDataErase.ts',
  // Joined 2026-10-09: the third reachability shape (a derived doc id). Like the two above it names
  // the subcollection through a variable, so it is the mechanism, not a store that owns one.
  'src/server/lib/derivedIdErase.ts',
  // Joined 2026-10-09 for the same reason (Q-766): it deletes a never-public listing's `files`,
  // `baked` and `screenshots` through `policy.subs`, so the only name the scan can see there is the
  // loop variable. It owns no subcollection of its own.
  'src/server/lib/publishedListingErase.ts',
]);

function found(): string[] {
  const out = new Set<string>();
  for (const f of [...globSync('src/server/**/*.ts', { cwd: root }), 'server.ts']) {
    if (/\.test\.ts$/.test(f) || MECHANISM.has(f)) continue;
    const s = readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const re = /(?:\.doc\((?:[^()]|\([^()]*\))*\)|\b(?:root|ref|parent))\s*\.collection\(\s*([^)\s,(]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const arg = m[1];
      let name = arg;
      if (/^['"]/.test(arg)) name = arg.replace(/['"]/g, '');
      else {
        const c = s.match(new RegExp(`const ${arg}\\s*=\\s*'([^']+)'`));
        if (c) name = c[1];
      }
      out.add(`${f} › ${name}`);
    }
  }
  return [...out].sort();
}

describe('every subcollection is classified', () => {
  const all = found();

  it('finds the known subcollections (the scan is looking at the right shape)', () => {
    expect(all).toContain('src/server/AgentV3/DiagnosticsStore.ts › history');
    expect(all).toContain('src/server/lib/DeviceTokenStore.ts › deviceTokens');
    expect(all.length).toBeGreaterThanOrEqual(20);
  });

  it('has no unclassified subcollection', () => {
    expect(all.filter((k) => !(k in CLASSIFICATION))).toEqual([]);
  });

  /**
   * A subcollection that names a dedicated eraser must really be named in it. Reading the module is the
   * whole point: Q-764's defect was a label that read as coverage while nothing erased the data, and a
   * map entry asserting its own correctness would reproduce exactly that.
   */
  it('🔒 every subcollection that names a dedicated eraser is actually swept by it', () => {
    const named = Object.entries(CLASSIFICATION).filter(([, v]) => v.erasedBy);
    expect(named.length).toBeGreaterThanOrEqual(1);
    for (const [key, v] of named) {
      const sub = key.split('›')[1].trim();
      const src = readFileSync(join(root, v.erasedBy!), 'utf8');
      expect(src, `${v.erasedBy} does not mention '${sub}', so it cannot be erasing it`).toContain(`'${sub}'`);
    }
  });

  it('keeps no stale entry', () => {
    expect(Object.keys(CLASSIFICATION).filter((k) => !all.includes(k))).toEqual([]);
  });

  it('a workspace subcollection is erased with the account', () => {
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (c.kind !== 'workspace') continue;
      const sub = key.split(' › ')[1];
      expect(WORKSPACE_SCOPED_COLLECTIONS, key).toContainEqual({ collection: c.parent, sub });
    }
  });

  it('a user subcollection is erased with the account', () => {
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (c.kind !== 'user') continue;
      expect(USER_SCOPED_SUBCOLLECTIONS, key).toContainEqual({ parent: c.parent, sub: key.split(' › ')[1] });
    }
  });

  it('a clocked subcollection has its retention policy', () => {
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (!c.clock || !('parent' in c)) continue;
      expect(SUBCOLLECTION_RETENTION_POLICIES.some((p) => p.parent === c.parent && p.subcollection === key.split(' › ')[1]), key).toBe(true);
    }
  });

  it('a `parent-subs` child is really declared on its parent\'s erase entry', () => {
    // Not prose: the parent's own USER_SCOPED_COLLECTIONS entry must name this subcollection, which is
    // what makes `deleteUserData` page the children out BEFORE the parent.
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (c.kind !== 'parent-subs') continue;
      const sub = key.split(' › ')[1];
      const entry = USER_SCOPED_COLLECTIONS.find((e) => e.collection === c.parent);
      expect(entry, `${key}: '${c.parent}' is not erased with the account at all`).toBeDefined();
      expect(entry!.subs ?? [], key).toContain(sub);
    }
  });

  it('a `retained-parent` child is really declared on its parent\'s retention policy', () => {
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (c.kind !== 'retained-parent') continue;
      const sub = key.split(' › ')[1];
      const policy = RETENTION_POLICIES.find((p) => p.collection === c.parent);
      expect(policy, `${key}: '${c.parent}' is on no clock, so its children expire with nothing`).toBeDefined();
      expect(policy!.subs ?? [], key).toContain(sub);
    }
  });

  it('🔒 a child that also lives under SOMEBODY ELSE\'S parent is swept there too', () => {
    // The fifth reachability shape. Without this the member row in MY OWN team would be erased and the
    // one in every team I joined would not — a half-erase that reads as done.
    for (const [key, c] of Object.entries(CLASSIFICATION)) {
      if (!c.foreignParent || !('parent' in c)) continue;
      const sub = key.split(' › ')[1];
      expect(
        FOREIGN_PARENT_USER_DOCS.some((f) => f.parent === c.parent && f.sub === sub),
        `${key} is also written under other people's parents and must be swept there`,
      ).toBe(true);
    }
    // And every entry in that registry records WHY, since a scan is the expensive mechanism.
    for (const f of FOREIGN_PARENT_USER_DOCS) expect(f.why.length).toBeGreaterThan(30);
  });

  it('every open entry points at a row that is in the queue', () => {
    const queue = readFileSync(join(root, 'BUILD_REPORT_QUEUE.md'), 'utf8');
    for (const c of Object.values(CLASSIFICATION)) {
      if (c.kind === 'open') expect(queue).toMatch(new RegExp(`^\\| ${c.row} `, 'm'));
    }
  });
});

describe('the published window matches the purge (Q-134)', () => {
  it('the Privacy Policy states the build-report window the purge actually keeps', () => {
    const policy = readFileSync(join(root, 'src/content/legal/privacyPolicy.ts'), 'utf8');
    const history = SUBCOLLECTION_RETENTION_POLICIES.find((p) => p.parent === 'workspace_diagnostics_v3' && p.subcollection === 'history');
    expect(history?.ttlDays).toBe(180);
    expect(policy).toContain('the reports of your past builds (what you asked for, what the build engine did, and what failed) are kept for **180 days**');
  });
});

