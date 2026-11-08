import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { SandboxStore } from '../src/server/AgentV3/SandboxStore';
import { snapshotMatchesFiles } from '../src/server/AgentV3/snapshotIdentity';

const unchanged = { workspaceId: 'ws', sandboxId: 'vm', recipe: { command: 'keep' }, session: { observationId: 'keep' }, allocation: { generation: 2 } };
function fixture(initial: Record<string, unknown>) {
  let row = structuredClone(initial);
  const set = vi.fn(async (fields: Record<string, unknown>, options: { merge: boolean }) => {
    expect(options).toEqual({ merge: true });
    for (const [key, value] of Object.entries(fields)) {
      if (value === FieldValue.delete()) delete row[key]; else row[key] = value;
    }
  });
  const db = { collection: () => ({ doc: () => ({ set }) }) };
  return { store: new SandboxStore(() => db as unknown as admin.firestore.Firestore), set, row: () => row };
}
describe('snapshot recapture never inherits another capture’s source hash', () => {
  it.each([null, undefined, ''])('unknown hash %s clears old evidence, preserving artifact reference and unrelated data', async (hash) => {
    const f = fixture({ ...unchanged, snapshotUrl: 'old-url', snapshotAt: 1, snapshotFilesHash: 'old-hash' });
    await f.store.saveSnapshot('ws', 'new-url', 2, hash);
    expect(f.row()).toEqual({ ...unchanged, snapshotUrl: 'new-url', snapshotAt: 2, updatedAt: expect.any(Number) });
    expect(snapshotMatchesFiles(f.row().snapshotFilesHash as string | undefined, 'old-hash')).toBeUndefined();
  });
  it('same-URL recapture with unknown source also clears prior hash', async () => {
    const f = fixture({ ...unchanged, snapshotUrl: 'same-url', snapshotFilesHash: 'old-hash' });
    await f.store.saveSnapshot('ws', 'same-url', 2, null);
    expect(f.row().snapshotUrl).toBe('same-url'); expect(f.row()).not.toHaveProperty('snapshotFilesHash');
    expect(f.row().sandboxId).toBe('vm');
  });
  it('a known replacement records only the new hash', async () => {
    const f = fixture({ ...unchanged, snapshotFilesHash: 'old-hash' });
    await f.store.saveSnapshot('ws', 'new-url', 2, 'new-hash');
    expect(snapshotMatchesFiles(f.row().snapshotFilesHash as string, 'new-hash')).toBe(true);
    expect(snapshotMatchesFiles(f.row().snapshotFilesHash as string, 'old-hash')).toBe(false);
  });
  it('a first unknown capture writes URL/time without inventing a hash', async () => {
    const f = fixture({ ...unchanged }); await f.store.saveSnapshot('ws', 'first-url', 2);
    expect(f.row()).toEqual({ ...unchanged, snapshotUrl: 'first-url', snapshotAt: 2, updatedAt: expect.any(Number) });
  });
  it('failed writes remain best-effort and do not claim changed metadata', async () => {
    const f = fixture({ ...unchanged, snapshotFilesHash: 'old-hash' }); f.set.mockRejectedValue(Error('unavailable'));
    await expect(f.store.saveSnapshot('ws', 'new-url', 2)).resolves.toBeUndefined();
    expect(f.row().snapshotFilesHash).toBe('old-hash');
  });
});
