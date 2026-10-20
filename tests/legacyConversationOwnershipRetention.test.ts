import type * as admin from 'firebase-admin';
import { describe, expect, it } from 'vitest';
import { FirestoreConversationStore } from '../src/server/AgentV3/FirestoreConversationStore';
import { upsertConversationTurn } from '../src/server/AgentV3/ConversationStore';
import { deleteUserData, type RetentionFirestore } from '../src/server/lib/DataRetentionManager';
import { workspaceIdFor } from '../src/server/lib/workspaceIdentity';

type Row = Record<string, unknown>;

/** Shared state for the actual conversation writer and account eraser; parent deletion is not a cascade. */
class StatefulFirestore {
  readonly rows = new Map<string, Row>();
  readonly queries: string[] = [];
  readonly deletions: string[] = [];

  doc(path: string) {
    const db = this;
    const ref = {
      id: path.slice(path.lastIndexOf('/') + 1),
      get: async () => ({ exists: db.rows.has(path), data: () => db.rows.get(path), ref }),
      set: async (row: Row, options?: { merge?: boolean }) => {
        db.rows.set(path, { ...(options?.merge ? db.rows.get(path) : {}), ...row });
      },
      delete: async () => { db.deletions.push(path); db.rows.delete(path); },
      collection: (name: string) => db.collection(`${path}/${name}`),
    };
    return ref;
  }

  collection(path: string) {
    const db = this;
    const query = (
      filters: Array<{ field: string; op: '==' | '<'; value: unknown }> = [],
      order?: { field: string; direction: 'asc' | 'desc' },
      cap = Infinity,
    ) => ({
      where: (field: string, op: '==' | '<', value: unknown) => query([...filters, { field, op, value }], order, cap),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => query(filters, { field, direction }, cap),
      limit: (n: number) => query(filters, order, n),
      select: () => query(filters, order, cap),
      get: async () => {
        db.queries.push(path);
        let rows = [...db.rows.entries()].filter(([key]) =>
          key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'));
        for (const { field, op, value } of filters) {
          rows = rows.filter(([, row]) => op === '==' ? row[field] === value
            : typeof row[field] === 'number' && typeof value === 'number' && row[field] < value);
        }
        if (order) rows.sort(([, a], [, b]) =>
          (Number(a[order.field]) - Number(b[order.field])) * (order.direction === 'desc' ? -1 : 1));
        const docs = rows.slice(0, cap).map(([key, row]) => ({
          id: key.slice(path.length + 1), ref: db.doc(key), data: () => row,
        }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    });
    return {
      ...query(),
      doc: (id: string) => db.doc(`${path}/${id}`),
      listDocuments: async () => [...new Set([...db.rows.keys()]
        .filter((key) => key.startsWith(`${path}/`))
        .map((key) => key.slice(path.length + 1).split('/')[0]))]
        .map((id) => db.doc(`${path}/${id}`)),
    };
  }

  async runTransaction<T>(body: (transaction: {
    get: (ref: ReturnType<StatefulFirestore['doc']>) => ReturnType<ReturnType<StatefulFirestore['doc']>['get']>;
    set: (ref: ReturnType<StatefulFirestore['doc']>, row: Row, options?: { merge?: boolean }) => void;
    delete: (ref: ReturnType<StatefulFirestore['doc']>) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<() => Promise<unknown>> = [];
    const result = await body({
      get: (ref) => ref.get(),
      set: (ref, row, options) => { writes.push(() => ref.set(row, options)); },
      delete: (ref) => { writes.push(() => ref.delete()); },
    });
    for (const write of writes) await write();
    return result;
  }
}

describe('legacy conversation attribution at actual write and account-erasure boundaries', () => {
  it('retains foreign turns appended under a parent carrying the deleting account userId', async () => {
    const db = new StatefulFirestore();
    const store = new FirestoreConversationStore(db as unknown as admin.firestore.Firestore);
    const workspace = workspaceIdFor('abc', 'd-session1')!;
    expect(workspaceIdFor('abc-d', 'session1')).toBe(workspace);

    await upsertConversationTurn(store, {
      conversationId: workspace, workspaceId: workspace, userId: 'abc', title: 'First account',
      turn: [{ role: 'user', content: 'First account turn' }],
      patch: { updatedAt: 1, timelineAppend: [{ type: 'narration', text: 'First account timeline' }] },
    });
    // The current production upsert appends to this existing ID without comparing its stored owner.
    await upsertConversationTurn(store, {
      conversationId: workspace, workspaceId: workspace, userId: 'abc-d', title: 'Foreign account',
      turn: [{ role: 'user', content: 'Foreign account turn' }],
      patch: { updatedAt: 2, timelineAppend: [{ type: 'narration', text: 'Foreign account timeline' }] },
    });
    const before = await store.get(workspace, { includeTimeline: true });
    expect(before!.userId).toBe('abc');
    expect(before!.messages).toEqual([
      { role: 'user', content: 'First account turn', ts: 1 },
      { role: 'user', content: 'Foreign account turn', ts: 2 },
    ]);
    expect(before!.timeline).toEqual([
      { type: 'narration', text: 'First account timeline' },
      { type: 'narration', text: 'Foreign account timeline' },
    ]);
    const originalConversationRows = [...db.rows.entries()].filter(([path]) => path.startsWith('agentv3_conversations/'));
    db.rows.set('users/abc', { name: 'Deleting account' });
    db.rows.set('users/abc-d', { name: 'Foreign account' });
    db.rows.set('user_build_history/own-reference', { userId: 'abc', sessionId: 'd-session1' });
    db.rows.set('user_build_history/foreign-reference', { userId: 'abc-d', sessionId: 'session1' });
    db.queries.length = 0;

    const report = await deleteUserData(db as RetentionFirestore, 'abc');
    const eraseQueries = [...db.queries];

    // Assert actual bytes first: a reverted cascade must fail because it erased a foreign turn.
    expect(await store.get(workspace, { includeTimeline: true })).toEqual(before);
    expect([...db.rows.entries()].filter(([path]) => path.startsWith('agentv3_conversations/'))).toEqual(originalConversationRows);
    expect(db.deletions.some((path) => path.startsWith('agentv3_conversations/'))).toBe(false);
    expect(eraseQueries.some((path) => path.startsWith('agentv3_conversations'))).toBe(false);
    expect(db.rows.has('users/abc')).toBe(false);
    expect(db.rows.has('user_build_history/own-reference')).toBe(false);
    expect(db.rows.has('users/abc-d')).toBe(true);
    expect(db.rows.has('user_build_history/foreign-reference')).toBe(true);
    expect(report.collections.find((row) => row.collection === 'agentv3_conversations')).toEqual({
      collection: 'agentv3_conversations', deleted: 0, refusal: 'ownership-unverified',
      error: 'Legacy conversation ownership cannot be confirmed; conversation records and children are retained.',
    });
    expect(report.totalDeleted).toBe(2);

    const retry = await deleteUserData(db as RetentionFirestore, 'abc');
    expect(retry.totalDeleted).toBe(0);
    expect(retry.collections.find((row) => row.collection === 'agentv3_conversations')?.refusal).toBe('ownership-unverified');
    expect(await store.get(workspace, { includeTimeline: true })).toEqual(before);
  });
});
