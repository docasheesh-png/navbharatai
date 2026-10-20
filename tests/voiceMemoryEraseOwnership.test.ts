import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  queries: [] as string[],
  deleted: [] as string[],
}));

function document(path: string): any {
  const ref = {
    get: async () => ({ exists: state.rows.has(path), data: () => structuredClone(state.rows.get(path)), ref }),
    set: async (row: Record<string, unknown>) => { state.rows.set(path, structuredClone(row)); },
    update: async (patch: Record<string, unknown>) => {
      if (!state.rows.has(path)) throw new Error('Document does not exist');
      state.rows.set(path, structuredClone({ ...state.rows.get(path), ...patch }));
    },
    delete: async () => { state.deleted.push(path); state.rows.delete(path); },
    collection: (name: string) => collection(`${path}/${name}`),
  };
  return ref;
}

function collection(path: string): any {
  const query = (field?: string, value?: unknown, cap = Infinity): any => ({
    where: (nextField: string, _op: string, nextValue: unknown) => query(nextField, nextValue, cap),
    limit: (n: number) => query(field, value, n),
    get: async () => {
      state.queries.push(path);
      const docs = [...state.rows.entries()]
        .filter(([key, row]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
          && (field === undefined || row[field] === value))
        .slice(0, cap).map(([key]) => ({ ref: document(key) }));
      return { docs };
    },
  });
  return {
    ...query(),
    doc: (id: string) => document(`${path}/${id}`),
    listDocuments: async () => [...state.rows.keys()]
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map((key) => document(key)),
  };
}

const db = { collection };
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => db }));
vi.mock('firebase-admin', () => ({ apps: [{}], initializeApp: vi.fn() }));

const { voiceMemoryStore } = await import('../src/server/sonic/VoiceMemoryStore');
const { memoryKey } = await import('../src/server/sonic/voiceMemory');
const { conversationIdFromBody } = await import('../src/server/professionals/conversationId');
const { deleteUserData } = await import('../src/server/lib/DataRetentionManager');

beforeEach(() => {
  state.rows.clear(); state.queries.length = 0; state.deleted.length = 0;
  // Run the actual production writer against the stateful database, without an external service.
  vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => vi.unstubAllEnvs());

describe('voice memory account erasure requires attribution beyond a composite key', () => {
  it.each([false, true])('retains actual mixed-owner voice turns regardless of first writer (reverse=%s)', async (reverse) => {
    // These are two valid authenticated UIDs and valid init conversation IDs for the same known
    // professional. The websocket passes all three directly to this production memory writer.
    const callers = [
      { uid: 'abc', conversationId: 'teacher_ai__chat', text: 'First account private voice turn' },
      { uid: 'abc__teacher_ai', conversationId: 'chat', text: 'Other account private voice turn' },
    ];
    if (reverse) callers.reverse();
    for (const caller of callers) expect(conversationIdFromBody(caller.conversationId)).toBe(caller.conversationId);
    const [first, second] = callers;
    const key = memoryKey(first.uid, 'teacher_ai', first.conversationId);
    expect(memoryKey(second.uid, 'teacher_ai', second.conversationId)).toBe(key);

    await voiceMemoryStore.append(first.uid, 'teacher_ai', [{ role: 'user', content: first.text }], first.conversationId);
    await voiceMemoryStore.append(second.uid, 'teacher_ai', [{ role: 'user', content: second.text }], second.conversationId);
    const path = `sonic_voice_memory/${key}`;
    const mixed = structuredClone(state.rows.get(path));
    expect(mixed).toMatchObject({ userId: first.uid, turns: [
      { role: 'user', content: first.text }, { role: 'user', content: second.text },
    ] });
    state.rows.set(`users/${first.uid}`, { account: 'deleting' });
    state.rows.set(`users/${second.uid}`, { account: 'retained' });
    state.queries.length = 0;

    const report = await deleteUserData(db, first.uid);

    // Assert retained bytes before metadata: removing the refusal must fail by deleting foreign text.
    expect(state.rows.get(path)).toEqual(mixed);
    expect(state.queries).not.toContain('sonic_voice_memory');
    expect(state.deleted).toEqual([`users/${first.uid}`]);
    expect(state.rows.has(`users/${second.uid}`)).toBe(true);
    expect(report.totalDeleted).toBe(1);
    expect(report.collections.find((entry) => entry.collection === 'sonic_voice_memory')).toEqual({
      collection: 'sonic_voice_memory', deleted: 0, refusal: 'ownership-unverified',
      error: 'Legacy voice conversation ownership cannot be confirmed; records are retained.',
    });

    const retry = await deleteUserData(db, first.uid);
    expect(retry.totalDeleted).toBe(0);
    expect(state.rows.get(path)).toEqual(mixed);
  });
});
