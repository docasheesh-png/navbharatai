import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceCommandController } from './WorkspaceCommandController';
import { WorkspaceQueryController } from './WorkspaceQueryController';
import { WorkspaceController } from './WorkspaceController';
import { WorkspaceRegistry } from './WorkspaceRegistry';
import { MemoryWorkspaceRepository } from './repositories/MemoryWorkspaceRepository';
import { NotFoundError } from './errors/AppMakerErrors';
import type { IWorkspaceManager } from './interfaces/IWorkspaceManager';
import type { WorkspaceFileSummary } from './types/workspace';
import type { GeneratedFile } from './types/files';

// A spy manager that records the mutating calls so tests can assert the WRITE path ran (or didn't).
function makeManager() {
  const calls: string[] = [];
  const manager: IWorkspaceManager = {
    async createWorkspace(id) { calls.push(`create:${id}`); return `/ws/${id}`; },
    async saveFiles(id, files) { calls.push(`saveFiles:${id}:${files.length}`); },
    async writeFile(id, path) { calls.push(`writeFile:${id}:${path}`); },
    async getWorkspaceInfo(id): Promise<WorkspaceFileSummary> { calls.push(`getInfo:${id}`); return { rootPath: `/ws/${id}`, files: ['index.html'] }; },
    async deleteWorkspace(id) { calls.push(`delete:${id}`); },
  };
  return { manager, calls };
}

function setup() {
  const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
  const { manager, calls } = makeManager();
  return {
    registry, manager, calls,
    command: new WorkspaceCommandController(manager, registry),
    query: new WorkspaceQueryController(manager, registry),
    facade: new WorkspaceController(manager, registry),
  };
}

const FILES: GeneratedFile[] = [{ path: 'index.html', content: '<h1>hi</h1>' }];

describe('WorkspaceCommandController (write path)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('createWorkspace creates on the manager AND registers metadata', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    expect(ctx.calls).toContain('create:w1');
    const meta = await ctx.registry.get('w1');
    expect(meta).toMatchObject({ workspaceId: 'w1', projectName: 'My App', sourceType: 'generated', status: 'ready' });
  });

  it('saveFiles throws NotFoundError when the workspace is unknown (and does NOT touch the manager)', async () => {
    await expect(ctx.command.saveFiles('missing', FILES)).rejects.toBeInstanceOf(NotFoundError);
    expect(ctx.calls.some(c => c.startsWith('saveFiles'))).toBe(false);
  });

  it('saveFiles writes through the manager once the workspace exists', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    await ctx.command.saveFiles('w1', FILES);
    expect(ctx.calls).toContain('saveFiles:w1:1');
  });

  it('deleteWorkspace removes from BOTH the manager and the registry', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    await ctx.command.deleteWorkspace('w1');
    expect(ctx.calls).toContain('delete:w1');
    expect(await ctx.registry.get('w1')).toBeUndefined();
  });

  it('updateStatus transitions the registry status', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    await ctx.command.updateStatus('w1', 'error');
    expect((await ctx.registry.get('w1'))?.status).toBe('error');
  });
});

describe('WorkspaceQueryController (read path — mutates nothing)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('getWorkspaceInfo joins registry metadata with the manager file summary', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    const info = await ctx.query.getWorkspaceInfo('w1');
    expect(info).toMatchObject({ workspaceId: 'w1', projectName: 'My App', rootPath: '/ws/w1', files: ['index.html'] });
  });

  it('getWorkspaceInfo throws NotFoundError for an unknown workspace', async () => {
    await expect(ctx.query.getWorkspaceInfo('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getMetadata returns metadata, or undefined when absent', async () => {
    expect(await ctx.query.getMetadata('missing')).toBeUndefined();
    await ctx.command.createWorkspace('w1', 'My App', 'cloned');
    expect((await ctx.query.getMetadata('w1'))?.sourceType).toBe('cloned');
  });

  it('listWorkspaces returns all registered workspaces', async () => {
    await ctx.command.createWorkspace('w1', 'A', 'generated');
    await ctx.command.createWorkspace('w2', 'B', 'cloned');
    const list = await ctx.query.listWorkspaces();
    expect(list.map(w => w.workspaceId).sort()).toEqual(['w1', 'w2']);
  });

  it('the query side performs NO mutating manager calls (only reads)', async () => {
    await ctx.command.createWorkspace('w1', 'My App', 'generated');
    const before = ctx.calls.length;
    await ctx.query.getWorkspaceInfo('w1');
    await ctx.query.getMetadata('w1');
    await ctx.query.listWorkspaces();
    const added = ctx.calls.slice(before);
    // Only the getWorkspaceInfo read hits the manager; nothing that mutates.
    expect(added.every(c => c.startsWith('getInfo'))).toBe(true);
  });
});

describe('WorkspaceController (CQRS facade)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('exposes explicit command and query handles', () => {
    expect(ctx.facade.commands).toBeInstanceOf(WorkspaceCommandController);
    expect(ctx.facade.queries).toBeInstanceOf(WorkspaceQueryController);
  });

  it('delegates the original API to the correct side (create → query read back)', async () => {
    await ctx.facade.createWorkspace('w1', 'My App', 'generated');
    await ctx.facade.saveFiles('w1', FILES);
    const info = await ctx.facade.getWorkspaceInfo('w1');
    expect(info).toMatchObject({ workspaceId: 'w1', files: ['index.html'] });
    expect(ctx.calls).toContain('saveFiles:w1:1');
    await ctx.facade.updateStatus('w1', 'idle');
    expect((await ctx.facade.queries.getMetadata('w1'))?.status).toBe('idle');
    await ctx.facade.deleteWorkspace('w1');
    expect(await ctx.facade.queries.getMetadata('w1')).toBeUndefined();
  });
});
