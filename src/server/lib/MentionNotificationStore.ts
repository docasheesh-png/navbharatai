// P-COLLAB.5 (delivery) / T1-mention-inbox — the per-user in-app notification store that finally DELIVERS
// an @mention. MentionRouter already RESOLVES who was tagged; the missing piece (recorded as an open item
// under constitution rule 6) was a place to actually notify them. This is it.
//
// Mirrors TeamLibraryStore / UserCostStore exactly: VITEST-skip getDb, best-effort (never throws), pure
// builders unit-tested. Collection: `users/{uid}/notifications/{id}` — path-scoped per recipient, so a
// user can only ever read/mark their OWN notifications.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { resolveMentions, type MentionMember } from './MentionRouter';

export interface MentionNotification {
  id: string;
  /** Recipient uid. */
  uid: string;
  kind: 'mention';
  /** A short excerpt of the message that mentioned them. */
  text: string;
  /** Email of the member who wrote the mention. */
  fromEmail: string;
  teamId: string;
  createdAt: number;
  read: boolean;
}

/** Max stored excerpt length — keeps a notification small. */
export const MAX_NOTIF_TEXT = 500;
/** How many notifications a user's inbox returns (newest first). */
export const MAX_INBOX = 50;

/** Build a validated mention notification. Pure. Returns null on missing recipient/team. */
export function buildMentionNotification(input: {
  id: string; uid: string; text: unknown; fromEmail: unknown; teamId: string; now: number;
}): MentionNotification | null {
  if (!input.id || !input.uid || !input.teamId) return null;
  return {
    id: input.id,
    uid: String(input.uid),
    kind: 'mention',
    text: String(input.text ?? '').trim().slice(0, MAX_NOTIF_TEXT),
    fromEmail: String(input.fromEmail ?? '').trim().slice(0, 200),
    teamId: String(input.teamId),
    createdAt: input.now,
    read: false,
  };
}

/**
 * Turn a mention message into the notifications to deliver. Pure: resolves the @mentions in `text` against
 * the team members, then builds one notification per DISTINCT mentioned member — EXCLUDING the sender (you
 * never notify yourself for tagging yourself). `idFor(index)` supplies a stable id per notification.
 */
export function deliverMentions(
  text: string,
  members: MentionMember[],
  opts: { fromUid: string; fromEmail: string; teamId: string; now: number; idFor: (i: number) => string },
): MentionNotification[] {
  const { mentioned } = resolveMentions(text, members);
  const out: MentionNotification[] = [];
  for (const m of mentioned) {
    if (m.uid === opts.fromUid) continue; // don't notify yourself
    const n = buildMentionNotification({
      id: opts.idFor(out.length), uid: m.uid, text, fromEmail: opts.fromEmail, teamId: opts.teamId, now: opts.now,
    });
    if (n) out.push(n);
  }
  return out;
}

class MentionNotificationStore {
  private db: admin.firestore.Firestore | null = null;
  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private col(uid: string) {
    const db = this.getDb();
    return db && uid ? db.collection('users').doc(uid).collection('notifications') : null;
  }

  /** Deliver a batch of notifications (each to its own recipient). Best-effort; returns how many stored. */
  async addMany(notifications: MentionNotification[]): Promise<number> {
    let stored = 0;
    for (const n of notifications) {
      const col = this.col(n.uid);
      if (!col) continue;
      try { await col.doc(n.id).set(n, { merge: false }); stored++; } catch { /* best-effort per notification */ }
    }
    return stored;
  }

  /** A user's inbox, newest first, bounded. */
  async listForUser(uid: string): Promise<MentionNotification[]> {
    const col = this.col(uid);
    if (!col) return [];
    try {
      const snap = await col.get();
      const out: MentionNotification[] = [];
      snap.forEach((d) => out.push(d.data() as MentionNotification));
      return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_INBOX);
    } catch {
      return [];
    }
  }

  /** Mark specific notifications read — path-scoped to `uid`, so cross-user writes are impossible. */
  async markRead(uid: string, ids: string[]): Promise<boolean> {
    const col = this.col(uid);
    if (!col || !ids?.length) return false;
    try {
      await Promise.all(ids.slice(0, MAX_INBOX).map((id) => col.doc(String(id)).set({ read: true }, { merge: true })));
      return true;
    } catch {
      return false;
    }
  }
}

export const mentionNotificationStore = new MentionNotificationStore();
