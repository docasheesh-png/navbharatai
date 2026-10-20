import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  paths: new Map<string, Record<string, unknown>>(),
  deleted: [] as string[],
}));

function collection(path: string) {
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
});
afterEach(() => vi.unstubAllEnvs());

describe('account erase follows canonical history ownership', () => {
  it('erases owned versions after the source app is gone, retaining another owner and unowned legacy rows', async () => {
    const own = 'build_history_v2/agentv3-alice-shared123';
    const other = 'build_history_v2/agentv3-bob-shared123';
    const legacy = 'build_history/shared123';
    const legacyWorkspaceShapedId = 'build_history/agentv3-alice-shared123';
    for (const path of [own, other, legacy, legacyWorkspaceShapedId, 'build_history_v2/agentv3-anon-shared123']) {
      state.paths.set(path, { workspaceId: path.slice(path.indexOf('/') + 1) });
      state.paths.set(`${path}/versions/v1`, { files: { 'app.ts': path } });
    }
    state.paths.set(`${own}/versions/v2`, { files: { 'app.ts': 'second own version' } });
    // No workspace_files_v3 parent remains: the history's own parent marker makes it reachable.
    const result = await deleteUserWorkspaceData('alice');
    expect(result.collections.find((row) => row.collection === 'build_history_v2'))
      .toMatchObject({ workspaces: 1, documents: 2 });
    expect(state.paths.has(own)).toBe(false);
    expect(state.paths.has(`${own}/versions/v1`)).toBe(false);
    expect(state.paths.has(`${own}/versions/v2`)).toBe(false);
    for (const kept of [other, legacy, legacyWorkspaceShapedId, 'build_history_v2/agentv3-anon-shared123']) {
      expect(state.paths.has(kept)).toBe(true);
      expect(state.paths.has(`${kept}/versions/v1`)).toBe(true);
    }
    expect(state.deleted.at(-1)).toBe(own);
    expect(state.deleted.slice(0, -1)).toEqual([`${own}/versions/v1`, `${own}/versions/v2`]);
  });
});
