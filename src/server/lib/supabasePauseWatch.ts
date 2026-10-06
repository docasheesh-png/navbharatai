// THE SLEEPING-DATABASE WATCH — once a day, tell an owner when Supabase has paused a database their app
// uses (admin 2026-10-06). See supabaseProjectState.ts for why a free project pauses and why we never
// wake it on our own.
//
// One notice per episode: an owner hears once that a database fell asleep (or failed, or was removed),
// not every morning while it stays that way — and hears again only if it wakes and later sleeps again.
// The notice is only remembered AFTER it was saved, so a failed send costs a repeat tomorrow, never
// silence. Exclusive in the scheduler (one instance asks Supabase, not every instance). Kill switch
// SUPABASE_PAUSE_WATCH=off. Every dependency is injectable; the sweep never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { getConnection, SUPABASE_CONNECTIONS_COLLECTION } from './supabaseConnectionStore';
import { freshAccessToken } from './supabaseProvisionFlow';
import { loadUserVaultRows } from './secrets';
import { databasesInVault } from './databaseReuse';
import { projectRefFromUrl } from './supabaseData';
import { saveNotification } from './AdminNotificationStore';
import { resolveEmailConfig, sendAlertEmail } from './alertEmail';
import {
  getProjectState, projectStateMessage, stateNeedsOwner, type ProjectState,
} from './supabaseProjectState';
import type { VaultSecretRow } from './secretScope';

/** Kill switch `SUPABASE_PAUSE_WATCH=off`; default on. */
export function pauseWatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SUPABASE_PAUSE_WATCH ?? '').trim().toLowerCase() !== 'off';
}

/** How many connected accounts one run looks at. Bounded so one run cannot become a Supabase rate-limit storm. */
export const MAX_ACCOUNTS_PER_RUN = 300;

/** Every Supabase project the user's apps are wired to, once each. PURE. */
export function projectRefsInVault(rows: readonly VaultSecretRow[] | null | undefined): string[] {
  const refs = new Set<string>();
  for (const db of databasesInVault(rows)) {
    const ref = projectRefFromUrl(db.env.VITE_SUPABASE_URL);
    if (ref) refs.add(ref);
  }
  return [...refs];
}

/** What was last told to the owner about one project. `null` state = nothing outstanding. */
export interface PauseNotice {
  userId: string;
  projectRef: string;
  noticedState: ProjectState | null;
  noticedAt: number | null;
}

/**
 * Should the owner hear about this state now? PURE.
 *  • a state that needs them, and not the one they were last told about → notify, remember it;
 *  • back to ready → forget the episode, silently (they woke it, or it never mattered);
 *  • waking / busy / unhealthy / unknown → change nothing — never a notice on a state we cannot act on.
 */
export function decidePauseNotice(
  prev: PauseNotice | null,
  state: ProjectState,
): { notify: boolean; noticedState: ProjectState | null; changed: boolean } {
  const held = prev?.noticedState ?? null;
  if (stateNeedsOwner(state)) {
    return held === state
      ? { notify: false, noticedState: held, changed: false }
      : { notify: true, noticedState: state, changed: true };
  }
  if (state === 'ready') return { notify: false, noticedState: null, changed: held !== null };
  return { notify: false, noticedState: held, changed: false };
}

/** One doc per (owner, project): what the owner was last told. Keyed `<uid>_<ref>`, with a `userId` field. */
export const PAUSE_NOTICES_COLLECTION = 'supabase_pause_notices';
const NOTICES = PAUSE_NOTICES_COLLECTION;
const noticeId = (userId: string, ref: string): string => `${userId}_${ref}`;

export interface PauseWatchDeps {
  /** Accounts that granted us their Supabase account. */
  accounts: (limit: number) => Promise<string[]>;
  rows: (userId: string) => Promise<VaultSecretRow[]>;
  /** A live token for this account, or null when the grant lapsed (then nothing can be checked). */
  token: (userId: string) => Promise<string | null>;
  state: (token: string, ref: string) => Promise<{ state: ProjectState; name: string } | null>;
  load: (userId: string, ref: string) => Promise<PauseNotice | null>;
  save: (notice: PauseNotice) => Promise<void>;
  /** Resolves true only when the bell notice was stored. */
  notify: (userId: string, message: string) => Promise<boolean>;
  email: (userId: string, message: string) => Promise<boolean>;
  now: () => number;
  env: NodeJS.ProcessEnv;
}

async function ownerEmail(userId: string): Promise<string | null> {
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const u = await admin.auth().getUser(userId);
    return u.email && u.emailVerified !== false ? u.email : null;
  } catch {
    return null;
  }
}

export const realPauseWatchDeps: PauseWatchDeps = {
  accounts: async (limit) => {
    const db = getServerDb() as any;
    if (!db) return [];
    const snap = await db.collection(SUPABASE_CONNECTIONS_COLLECTION).limit(limit).get();
    return snap.docs.map((d: { id: string }) => d.id);
  },
  rows: (userId) => loadUserVaultRows(userId),
  token: async (userId) => {
    const conn = await getConnection(userId).catch(() => null);
    if (!conn) return null;
    const fresh = await freshAccessToken(userId, conn).catch(() => null);
    return fresh && fresh.ok ? fresh.token : null;
  },
  state: async (token, ref) => {
    const r = await getProjectState(token, ref).catch(() => null);
    return r && r.ok ? { state: r.state, name: r.name } : null;
  },
  load: async (userId, ref) => {
    const db = getServerDb() as any;
    if (!db) return null;
    const snap = await db.collection(NOTICES).doc(noticeId(userId, ref)).get();
    if (!snap?.exists) return null;
    const d = snap.data() ?? {};
    return {
      userId, projectRef: ref,
      noticedState: typeof d.noticedState === 'string' ? d.noticedState as ProjectState : null,
      noticedAt: typeof d.noticedAt === 'number' ? d.noticedAt : null,
    };
  },
  save: async (n) => {
    const db = getServerDb() as any;
    if (!db) return;
    await db.collection(NOTICES).doc(noticeId(n.userId, n.projectRef)).set(n);
  },
  notify: (userId, message) => saveNotification({
    message, target: { type: 'user', userId }, createdBy: 'system', action: 'open-database',
  }).then((n) => n !== null).catch(() => false),
  email: async (userId, message) => {
    const cfg = resolveEmailConfig();
    if (!cfg.configured) return false;
    const to = await ownerEmail(userId);
    if (!to) return false;
    const r = await sendAlertEmail({ ...cfg, to: [to] }, message, {
      footer: '— NavBharatAI\nOpen NavBharatAI → Settings → App Settings → Database to wake it.',
    }).catch(() => ({ sent: false }));
    return r.sent === true;
  },
  now: () => Date.now(),
  env: process.env,
};

export interface PauseWatchSummary {
  accounts: number;
  checked: number;
  notified: number;
  /** Accounts whose grant lapsed — their databases could not be checked. Reported, never guessed. */
  unreadable: number;
  skipped: 'disabled' | null;
}

/** One pass. A failure on one account or one project never stops the rest. Never throws. */
export async function runSupabasePauseWatch(deps: Partial<PauseWatchDeps> = {}): Promise<PauseWatchSummary> {
  const d: PauseWatchDeps = { ...realPauseWatchDeps, ...deps };
  const summary: PauseWatchSummary = { accounts: 0, checked: 0, notified: 0, unreadable: 0, skipped: null };
  if (!pauseWatchEnabled(d.env)) return { ...summary, skipped: 'disabled' };
  const accounts = await d.accounts(MAX_ACCOUNTS_PER_RUN).catch(() => [] as string[]);
  for (const userId of accounts) {
    try {
      summary.accounts += 1;
      const refs = projectRefsInVault(await d.rows(userId).catch(() => []));
      if (refs.length === 0) continue;
      const token = await d.token(userId).catch(() => null);
      if (!token) { summary.unreadable += 1; continue; }
      for (const ref of refs) {
        try {
          const seen = await d.state(token, ref);
          if (!seen) continue; // could not look ⇒ nothing is said, nothing is remembered
          summary.checked += 1;
          const prev = await d.load(userId, ref).catch(() => null);
          const decision = decidePauseNotice(prev, seen.state);
          if (decision.notify) {
            const message = projectStateMessage(seen.state, seen.name);
            // Remembered only once the bell notice is stored — see the header.
            if (!(await d.notify(userId, message).catch(() => false))) continue;
            await d.email(userId, message).catch(() => false);
            summary.notified += 1;
          }
          if (decision.changed) {
            await d.save({
              userId, projectRef: ref, noticedState: decision.noticedState,
              noticedAt: decision.noticedState ? d.now() : null,
            }).catch(() => undefined);
          }
        } catch { /* one project must not stop the rest */ }
      }
    } catch { /* one account must not stop the rest */ }
  }
  return summary;
}
