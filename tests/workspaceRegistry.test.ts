import { describe, it, expect } from 'vitest';
import { WorkspaceRegistry } from '../src/server/AppMakerLab/WorkspaceRegistry';
import { MemoryWorkspaceRepository } from '../src/server/AppMakerLab/repositories/MemoryWorkspaceRepository';
import type { WorkspaceMetadata } from '../src/server/AppMakerLab/types/workspace';

function ws(id: string): WorkspaceMetadata {
  return { workspaceId: id, projectName: 'TestApp', sourceType: 'generated', status: 'idle', createdAt: new Date(), updatedAt: new Date() };
}

describe('WorkspaceRegistry', () => {
  it('get() returns undefined before registration', async () => {
    const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
    expect(await registry.get('ws-unknown')).toBeUndefined();
  });

  it('register() then get() returns the workspace', async () => {
    const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
    await registry.register(ws('ws-1'));
    const result = await registry.get('ws-1');
    expect(result?.workspaceId).toBe('ws-1');
  });

  it('update() applies partial updates', async () => {
    const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
    await registry.register(ws('ws-2'));
    await registry.update('ws-2', { status: 'ready' });
    const result = await registry.get('ws-2');
    expect(result?.status).toBe('ready');
  });

  it('delete() removes the workspace', async () => {
    const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
    await registry.register(ws('ws-3'));
    await registry.delete('ws-3');
    expect(await registry.get('ws-3')).toBeUndefined();
  });

  it('list() returns all registered workspaces', async () => {
    const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
    await registry.register(ws('ws-a'));
    await registry.register(ws('ws-b'));
    const all = await registry.list();
    expect(all.length).toBe(2);
  });
});
