import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: null as any, bucketName: vi.fn(() => ''), storage: vi.fn() }));
vi.mock('firebase-admin', () => ({ apps: [{}], storage: mocks.storage }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => mocks.db }));
vi.mock('../src/server/lib/workspaceAssetStorage', () => ({ workspaceAssetBucketName: mocks.bucketName }));
import { firebaseAttachmentBackend, ProAttachmentStore, PRO_ATTACHMENT_COLLECTION } from '../src/server/lib/proAttachmentStore';
import { eraseConversationOriginals } from '../src/server/lib/proAttachmentLifecycle';

// Exercise the real Firestore backend and lifecycle, not a mocked erase() success.
// Firestore remains available for ordinary conversations; GCS is deliberately absent.
function fixture() {
  const documents = new Map<string, any>();
  const batchSizes: number[] = [];
  const collection = (path: string): any => ({
    doc: (id: string) => ({ path: `${path}/${id}`, collection: (name: string) => collection(`${path}/${id}/${name}`) }),
    limit: (count: number) => ({ get: async () => {
      const docs = [...documents.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
        .slice(0, count).map(key => ({ ref: { path: key } }));
      return { empty: docs.length === 0, docs };
    } }),
  });
  mocks.db = {
    collection,
    batch: () => {
      const deletes: string[] = [];
      return { delete: (ref: { path: string }) => { deletes.push(ref.path); }, commit: async () => {
        if (deletes.length > 500) throw new Error('Firestore batch limit exceeded');
        batchSizes.push(deletes.length); for (const path of deletes) documents.delete(path);
      } };
    },
    runTransaction: async (run: (tx: any) => Promise<unknown>) => {
      const writes = new Map<string, any>();
      const result = await run({
        get: async (ref: { path: string }) => ({ exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) }),
        set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)),
      });
      for (const [key, value] of writes) documents.set(key, value);
      return result;
    },
  };
  const store = new ProAttachmentStore(firebaseAttachmentBackend(), () => ({ maxBytes: 1000, maxFiles: 3 }));
  const ownerPath = `${PRO_ATTACHMENT_COLLECTION}/${Buffer.from('alice').toString('base64url')}`;
  return { store, documents, ownerPath, batchSizes };
}

beforeEach(() => {
  vi.stubEnv('PRO_ATTACHMENTS_ENABLED', 'off');
  mocks.bucketName.mockClear(); mocks.storage.mockClear();
  mocks.storage.mockImplementation(() => { throw new Error('GCS must not be contacted'); });
});
afterEach(() => { vi.unstubAllEnvs(); mocks.db = null; });

describe('disabled original uploads do not require a bucket to erase empty scopes', () => {
  it.each(['chat', 'message', 'legacy-message', 'unknown-chat', 'account'])('allows %s removal without stored originals or a bucket', async (scope) => {
    const { store, documents } = fixture();
    if (scope === 'account') await store.erase('alice');
    else await eraseConversationOriginals(store, 'alice', scope === 'unknown-chat' ? null : 'session',
      scope === 'message' ? '123' : undefined, scope === 'message' || scope === 'legacy-message');
    expect(mocks.bucketName).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
    if (scope === 'chat' || scope === 'message') expect([...documents.keys()].some(key => key.includes('/deleted_scopes/'))).toBe(true);
  });

  it('erases more than 500 scope fences in bounded pages while retaining the blocked owner', async () => {
    const { store, documents, ownerPath, batchSizes } = fixture();
    for (let i = 0; i < 1201; i++) documents.set(`${ownerPath}/deleted_scopes/scope-${i}`, { blocked: true });
    await store.erase('alice');
    expect(batchSizes).toEqual([200, 200, 200, 200, 200, 200, 1]);
    expect([...documents.keys()]).toEqual([ownerPath]);
    expect(documents.get(ownerPath).blocked).toBe(true);
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it('still refuses transcript removal when an existing original cannot be removed', async () => {
    const { store, documents, ownerPath } = fixture();
    const id = '12345678-1234-1234-1234-123456789abc';
    documents.set(ownerPath, { uid: 'alice', files: { [id]: {
      id, name: 'report.bin', size: 1, sha256: '0'.repeat(64), sessionId: 'session', messageId: '123', state: 'ready', leaseUntil: 0,
    } } });
    await expect(eraseConversationOriginals(store, 'alice', 'session', '123', true)).rejects.toThrow('not configured');
    expect(documents.get(ownerPath).files[id].state).toBe('deleting');
    expect(mocks.bucketName).toHaveBeenCalled();
  });

  it('does not mistake an unavailable metadata store for proof of no attachments', async () => {
    const { store } = fixture(); mocks.db = null;
    await expect(eraseConversationOriginals(store, 'alice', 'session')).rejects.toThrow('storage is unavailable');
    expect(mocks.storage).not.toHaveBeenCalled();
  });
});
