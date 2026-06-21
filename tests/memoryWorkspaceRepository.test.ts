import { describe, it, expect } from 'vitest';
import { MemoryWorkspaceRepository } from '../src/server/AppMakerLab/repositories/MemoryWorkspaceRepository';
import { NotFoundError } from '../src/server/AppMakerLab/errors/AppMakerErrors';
import type { WorkspaceMetadata } from '../src/server/AppMakerLab/types/workspace';

function ws(id: string): WorkspaceMetadata {
  return { workspaceId: id, projectName: 'MyApp', sourceType: 'generated', status: 'idle', createdAt: new Date(), updatedAt: new Date() };
}

describe('MemoryWorkspaceRepository', () => {
  it('get() returns undefined for an unregistered workspace', async () => {
    const r = new MemoryWorkspaceRepository();
    expect(await r.get('unknown')).toBeUndefined();
  });

  it('register() then get() returns the stored workspace', async () => {
    const r = new MemoryWorkspaceRepository();
    await r.register(ws('ws-1'));
    const result = await r.get('ws-1');
    expect(result?.workspaceId).toBe('ws-1');
  });

  it('update() merges partial updates', async () => {
    const r = new MemoryWorkspaceRepository();
    await r.register(ws('ws-2'));
    await r.update('ws-2', { status: 'ready' });
    const result = await r.get('ws-2');
    expect(result?.status).toBe('ready');
    expect(result?.projectName).toBe('MyApp'); // unchanged field preserved
  });

  it('update() throws NotFoundError for an unregistered workspace', async () => {
    const r = new MemoryWorkspaceRepository();
    await expect(r.update('ghost', { status: 'ready' })).rejects.toThrow(NotFoundError);
  });

  it('delete() removes the workspace', async () => {
    const r = new MemoryWorkspaceRepository();
    await r.register(ws('ws-3'));
    await r.delete('ws-3');
    expect(await r.get('ws-3')).toBeUndefined();
  });

  it('list() returns all registered workspaces', async () => {
    const r = new MemoryWorkspaceRepository();
    await r.register(ws('ws-a'));
    await r.register(ws('ws-b'));
    const list = await r.list();
    expect(list).toHaveLength(2);
    const ids = list.map((w) => w.workspaceId);
    expect(ids).toContain('ws-a');
    expect(ids).toContain('ws-b');
  });

  it('list() returns empty array when no workspaces are registered', async () => {
    const r = new MemoryWorkspaceRepository();
    expect(await r.list()).toHaveLength(0);
  });
});
