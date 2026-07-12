// P-COLLAB.4 — Team-scoped shared library (prompts / templates / components).
//
// The existing SyncedTemplates/ComponentLibrary are GLOBAL (one instance for everyone). This adds a
// per-TEAM curated library so a team can save and reuse its own prompts, project templates, and saved
// components. Scoped by teamId (a team is `teamId === owner uid`, per TeamStore); the routes enforce
// that only ACTIVE members of the team may read/contribute. Mirrors ShareStore/UserCostStore: VITEST-skip,
// best-effort (never throws), pure builders unit-tested.
//
// Collection: `teams/{teamId}/library/{itemId}`

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export type LibraryKind = 'prompt' | 'template' | 'component';
const KINDS: LibraryKind[] = ['prompt', 'template', 'component'];

export interface LibraryItem {
  id: string;
  teamId: string;
  kind: LibraryKind;
  title: string;
  content: string;
  createdBy: string;
  createdAt: number;
}

/** Max stored content per item (keeps a template/component snapshot bounded). */
export const MAX_LIBRARY_CONTENT = 200_000;

/** Coerce an arbitrary kind string to a known LibraryKind (default 'prompt'). */
export function normalizeKind(raw: unknown): LibraryKind {
  const k = String(raw ?? '').trim().toLowerCase();
  return (KINDS as string[]).includes(k) ? (k as LibraryKind) : 'prompt';
}

/** Build a validated library item from request input. Pure. Returns null when title/content are empty. */
export function buildLibraryItem(input: {
  id: string; teamId: string; kind: unknown; title: unknown; content: unknown; createdBy: string; now: number;
}): LibraryItem | null {
  const title = String(input.title ?? '').trim().slice(0, 200);
  const content = String(input.content ?? '').slice(0, MAX_LIBRARY_CONTENT);
  if (!title || !content.trim() || !input.teamId || !input.id) return null;
  return {
    id: input.id,
    teamId: String(input.teamId),
    kind: normalizeKind(input.kind),
    title,
    content,
    createdBy: String(input.createdBy || ''),
    createdAt: input.now,
  };
}

class TeamLibraryStore {
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

  private col(teamId: string) {
    const db = this.getDb();
    return db ? db.collection('teams').doc(teamId).collection('library') : null;
  }

  async add(item: LibraryItem): Promise<boolean> {
    const col = this.col(item.teamId);
    if (!col) return false;
    try { await col.doc(item.id).set(item, { merge: false }); return true; } catch { return false; }
  }

  async list(teamId: string, kind?: LibraryKind): Promise<LibraryItem[]> {
    const col = this.col(teamId);
    if (!col || !teamId) return [];
    try {
      const snap = await col.get();
      const out: LibraryItem[] = [];
      snap.forEach((d) => out.push(d.data() as LibraryItem));
      const filtered = kind ? out.filter((i) => i.kind === kind) : out;
      return filtered.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /** Remove an item — only if it belongs to `teamId` (path-scoped, so cross-team deletes are impossible). */
  async remove(teamId: string, itemId: string): Promise<boolean> {
    const col = this.col(teamId);
    if (!col || !teamId || !itemId) return false;
    try {
      const ref = col.doc(itemId);
      const doc = await ref.get();
      if (!doc.exists) return false;
      await ref.delete();
      return true;
    } catch {
      return false;
    }
  }
}

export const teamLibraryStore = new TeamLibraryStore();
