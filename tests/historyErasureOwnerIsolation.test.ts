import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  paths: new Map<string, Record<string, unknown>>(),
  deleted: [] as string[],
  collections: [] as string[],
}));

function collection(path: string) {
  state.collections.push(path);
  let start = '';
  let end = '\uffff';
  let pageSize = Infinity;
  const query = {
    orderBy: () => query,
    startAt: (key: string) => { start = key; return query; },
    endAt: (key: string) => { end = key; return query; },
    limit: (size: number) => { pageSize = size; return query; },
    get: async () => {
      const depth = path.split('/').length + 1;
      const docs = [...state.paths.keys()]
        .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === depth)
        .filter((key) => { const id = key.slice(path.length + 1); return id >= start && id <= end; })
        .sort().slice(0, pageSize)
        .map((key) => ({ id: key.slice(path.length + 1), ref: ref(key), data: () => state.paths.get(key) }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return query;
}
function ref(path: string) {
  return {
    path,
    firestore: db,
    collection: (name: string) => collection(`${path}/${name}`),
    delete: async () => { state.paths.delete(path); state.deleted.push(path); },
  };
}
const db = {
  collection,
  batch: () => {
    const refs: Array<ReturnType<typeof ref>> = [];
    return { delete: (target: ReturnType<typeof ref>) => refs.push(target), commit: async () => {
      for (const target of refs) await target.delete();
    } };
  },
};

vi.mock('firebase-admin', () => ({ apps: [{}], firestore: { FieldPath: { documentId: () => '__name__' } } }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => db }));

const { deleteUserWorkspaceData } = await import('../src/server/lib/workspaceDataErase');
beforeEach(() => {
  vi.stubEnv('VITEST', '');
  state.paths.clear();
  state.deleted.length = 0;
  state.collections.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('account erase requires independent history ownership', () => {
  it('retains full-key and bare histories when neither a parent marker nor key shape proves ownership', async () => {
    const own = 'build_history_v2/agentv3-alice-shared123';
    const other = 'build_history_v2/agentv3-bob-shared123';
    const legacy = 'build_history/shared123';
    const legacyWorkspaceShapedId = 'build_history/agentv3-alice-shared123';
    const collidedWorkspaceId = 'agentv3-alice-x-shared123';
    // alice/session=x-shared123 and alice-x/session=shared123 name the same physical history.
    expect(collidedWorkspaceId).toBe(`agentv3-${'alice'}-${'x-shared123'}`);
    expect(collidedWorkspaceId).toBe(`agentv3-${'alice-x'}-${'shared123'}`);
    const collided = `build_history_v2/${collidedWorkspaceId}`;
    for (const path of [own, other, collided, legacy, legacyWorkspaceShapedId, 'build_history_v2/agentv3-anon-shared123']) {
      state.paths.set(path, { workspaceId: path.slice(path.indexOf('/') + 1) });
      state.paths.set(`${path}/versions/v1`, { files: { 'app.ts': path } });
    }
    state.paths.set(`${own}/versions/v2`, { files: { 'app.ts': 'second own version' } });
    const before = [...state.paths.entries()];
    // A full-key parent makes versions reachable, but cannot independently attribute their bytes.
    // This remains true after the source workspace disappears.
    const result = await deleteUserWorkspaceData('alice');
    expect([...state.paths.entries()]).toEqual(before);
    expect(state.paths.get(`${collided}/versions/v1`)).toEqual({ files: { 'app.ts': collided } });
    expect(state.deleted).toEqual([]);
    expect(state.collections).toEqual([]);
    expect(result).toEqual({ uid: 'alice', collections: [], totalDeleted: 0, refusal: 'ownership-unverified' });
  });
});
