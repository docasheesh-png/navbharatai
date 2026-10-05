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
import { USER_SCOPED_SUBCOLLECTIONS, SUBCOLLECTION_RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../src/server/lib/workspaceDataErase';

const root = resolve(__dirname, '..');

type Kind =
  /** Under a workspace document. MUST be in WORKSPACE_SCOPED_COLLECTIONS with this sub (erased with the account). */
  | { kind: 'workspace'; parent: string }
  /** Under a document whose id is the uid. MUST be in USER_SCOPED_SUBCOLLECTIONS (erased with the account). */
  | { kind: 'user'; parent: string }
  /** Capped per parent by the store itself, so it cannot grow with time. */
  | { kind: 'bounded'; why: string }
  /** Neither erased nor bounded yet: an OPEN queue row owns the decision. */
  | { kind: 'open'; row: string; why: string };

/** "file › sub" → what it is. `clock` adds the second obligation: a SUBCOLLECTION_RETENTION_POLICIES entry. */
const CLASSIFICATION: Record<string, Kind & { clock?: true }> = {
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

  'src/server/project/BuildHistoryStore.ts › versions': { kind: 'bounded', why: 'MAX_SAVED_VERSIONS per session; the oldest is deleted on every save' },
  'src/server/lib/navStoreWebData.ts › dataSub': { kind: 'bounded', why: 'NavData rows: MAX_ROWS_PER_APP per app, the quota that IS the admin authorization' },

  'src/server/lib/ShareStore.ts › feedback': { kind: 'open', row: 'Q-682', why: 'feedback on a share link; shares are keyed by token with an ownerId field and are in no erase path' },
  'src/server/lib/TeamStore.ts › members': { kind: 'open', row: 'Q-682', why: "a member record holds the member's uid and email; deleting that member's account does not remove it" },
  'src/server/lib/TeamLibraryStore.ts › library': { kind: 'open', row: 'Q-682', why: 'team-owned; what happens when the team owner deletes their account is undecided' },
  'src/server/lib/navStoreWeb.ts › files': { kind: 'open', row: 'Q-682', why: "a published store listing's bytes; not reached by the account erase" },
  'src/server/lib/navStoreWeb.ts › baked': { kind: 'open', row: 'Q-682', why: 'the baked page of a store listing; same parent as files' },
  'src/server/lib/navStoreWeb.ts › screenshots': { kind: 'open', row: 'Q-682', why: 'listing screenshots; same parent as files' },
  'src/server/lib/navStoreWeb.ts › reports': { kind: 'open', row: 'Q-682', why: 'abuse reports about a listing; a safety record that should get the 180-day policy' },
  'src/server/lib/userReportStore.ts › shot': { kind: 'open', row: 'Q-682', why: "the screenshot attached to a user's report; user_reports has no retention policy" },
};

/** The generic erasers name subcollections through a variable; they are the mechanism, not a store. */
const MECHANISM = new Set(['src/server/lib/DataRetentionManager.ts', 'src/server/lib/workspaceDataErase.ts']);

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

