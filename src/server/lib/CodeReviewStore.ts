// P-DEV.11 — Inline Code Review comments.
//
// GitHub-PR-style review comments anchored to a specific file + line of a workspace, with resolve and
// reply. This is the durable store + a pure, unit-tested comment builder. Mirrors the repo's store
// pattern (TeamLibraryStore/ShareStore): VITEST-skip, best-effort (never throws), fails soft.
//
// Collection: `code_reviews/{workspaceId}/comments/{commentId}`
//
// HONEST SCOPE: this is the store + comment model + API core. Anchoring a comment thread to the Monaco
// editor gutter (click-a-line-to-comment) is a follow-up that would edit the hot Editor.tsx; the panel UI
// (add by file+line, list, resolve, reply) is complete and real without it.

import * as admin from 'firebase-admin';

export interface ReviewReply {
  author: string;
  body: string;
  at: number;
}

export interface ReviewComment {
  id: string;
  workspaceId: string;
  file: string;
  line: number;
  body: string;
  author: string;
  createdAt: number;
  resolved: boolean;
  replies: ReviewReply[];
}

/** Max stored length of a comment/reply body. */
export const MAX_COMMENT_BODY = 5_000;

/**
 * Build a validated review comment from request input. Pure. Returns null when the required fields
 * (file, body) are missing/blank or the line is not a non-negative integer.
 */
export function buildComment(input: {
  id: string; workspaceId: string; file: unknown; line: unknown; body: unknown; author: string; now: number;
}): ReviewComment | null {
  const file = String(input.file ?? '').trim().slice(0, 1000);
  const body = String(input.body ?? '').trim().slice(0, MAX_COMMENT_BODY);
  const lineNum = Number(input.line);
  const line = Number.isFinite(lineNum) && lineNum >= 0 ? Math.floor(lineNum) : NaN;
  if (!file || !body || !input.workspaceId || !input.id || Number.isNaN(line)) return null;
  return {
    id: input.id,
    workspaceId: String(input.workspaceId),
    file,
    line,
    body,
    author: String(input.author || ''),
    createdAt: input.now,
    resolved: false,
    replies: [],
  };
}

/** Build a validated reply. Pure. Returns null when the body is blank. */
export function buildReply(input: { author: string; body: unknown; now: number }): ReviewReply | null {
  const body = String(input.body ?? '').trim().slice(0, MAX_COMMENT_BODY);
  if (!body) return null;
  return { author: String(input.author || ''), body, at: input.now };
}

class CodeReviewStore {
  private db: admin.firestore.Firestore | null = null;
  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private col(workspaceId: string) {
    const db = this.getDb();
    return db && workspaceId ? db.collection('code_reviews').doc(workspaceId).collection('comments') : null;
  }

  async add(comment: ReviewComment): Promise<boolean> {
    const col = this.col(comment.workspaceId);
    if (!col) return false;
    try { await col.doc(comment.id).set(comment, { merge: false }); return true; } catch { return false; }
  }

  async list(workspaceId: string): Promise<ReviewComment[]> {
    const col = this.col(workspaceId);
    if (!col || !workspaceId) return [];
    try {
      const snap = await col.get();
      const out: ReviewComment[] = [];
      snap.forEach((d) => out.push(d.data() as ReviewComment));
      // Unresolved first, then newest first.
      return out.sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  async resolve(workspaceId: string, id: string, resolved: boolean): Promise<boolean> {
    const col = this.col(workspaceId);
    if (!col || !workspaceId || !id) return false;
    try {
      const ref = col.doc(id);
      const doc = await ref.get();
      if (!doc.exists) return false;
      await ref.update({ resolved });
      return true;
    } catch {
      return false;
    }
  }

  async reply(workspaceId: string, id: string, reply: ReviewReply): Promise<boolean> {
    const col = this.col(workspaceId);
    if (!col || !workspaceId || !id) return false;
    try {
      const ref = col.doc(id);
      const doc = await ref.get();
      if (!doc.exists) return false;
      await ref.update({ replies: admin.firestore.FieldValue.arrayUnion(reply) });
      return true;
    } catch {
      return false;
    }
  }
}

export const codeReviewStore = new CodeReviewStore();
