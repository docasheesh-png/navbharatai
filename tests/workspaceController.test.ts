/**
 * Tests for WorkspaceController — orchestrates IWorkspaceManager + WorkspaceRegistry.
 * Uses an in-memory mock for the manager and the real MemoryWorkspaceRepository.
 */
import { describe, it, expect } from 'vitest';
import { WorkspaceController } from '../src/server/AppMakerLab/WorkspaceController';
import { WorkspaceRegistry } from '../src/server/AppMakerLab/WorkspaceRegistry';
import { MemoryWorkspaceRepository } from '../src/server/AppMakerLab/repositories/MemoryWorkspaceRepository';
import type { IWorkspaceManager } from '../src/server/AppMakerLab/interfaces/IWorkspaceManager';
import type { GeneratedFile } from '../src/server/AppMakerLab/types/files';
import { NotFoundError } from '../src/server/AppMakerLab/errors/AppMakerErrors';

function makeManager(overrides: Partial<IWorkspaceManager> = {}): IWorkspaceManager {
  return {
    createWorkspace: async (id) => id,
    saveFiles: async () => {},
    writeFile: async () => {},
    getWorkspaceInfo: async (id) => ({ rootPath: `/workspaces/${id}`, files: ['index.ts'] }),
    deleteWorkspace: async () => {},
    ...overrides,
  };
}

function makeController(managerOverrides: Partial<IWorkspaceManager> = {}) {
  const registry = new WorkspaceRegistry(new MemoryWorkspaceRepository());
  const manager = makeManager(managerOverrides);
  const controller = new WorkspaceController(manager, registry);
  return { controller, registry, manager };
}

describe('WorkspaceController.createWorkspace', () => {
  it('creates workspace and registers it in the registry', async () => {
    const { controller, registry } = makeController();
    await controller.createWorkspace('ws-1', 'My App', 'generated');
    const ws = await registry.get('ws-1');
    expect(ws?.workspaceId).toBe('ws-1');
    expect(ws?.projectName).toBe('My App');
    expect(ws?.sourceType).toBe('generated');
  });

  it('registered workspace has status ready', async () => {
    const { controller, registry } = makeController();
    await controller.createWorkspace('ws-ready', 'App', 'cloned');
    const ws = await registry.get('ws-ready');
    expect(ws?.status).toBe('ready');
  });
});

describe('WorkspaceController.saveFiles', () => {
  it('throws NotFoundError when workspace does not exist', async () => {
    const { controller } = makeController();
    const files: GeneratedFile[] = [{ path: 'index.ts', content: 'const x = 1;' }];
    await expect(controller.saveFiles('nonexistent', files)).rejects.toThrow(NotFoundError);
  });

  it('calls manager.saveFiles when workspace exists', async () => {
    let calledWith: GeneratedFile[] = [];
    const { controller } = makeController({
      saveFiles: async (id, files) => { calledWith = files; },
    });
    await controller.createWorkspace('ws-save', 'App', 'generated');
    const files: GeneratedFile[] = [{ path: 'app.ts', content: 'export {}' }];
    await controller.saveFiles('ws-save', files);
    expect(calledWith).toEqual(files);
  });
});

describe('WorkspaceController.getWorkspaceInfo', () => {
  it('throws NotFoundError when workspace does not exist', async () => {
    const { controller } = makeController();
    await expect(controller.getWorkspaceInfo('missing')).rejects.toThrow(NotFoundError);
  });

  it('returns merged metadata + manager info', async () => {
    const { controller } = makeController();
    await controller.createWorkspace('ws-info', 'Info App', 'generated');
    const info = await controller.getWorkspaceInfo('ws-info');
    expect(info.workspaceId).toBe('ws-info');
    expect(info.projectName).toBe('Info App');
    expect(info.rootPath).toBe('/workspaces/ws-info');
    expect(info.files).toContain('index.ts');
  });
});

describe('WorkspaceController.deleteWorkspace', () => {
  it('removes workspace from registry', async () => {
    const { controller, registry } = makeController();
    await controller.createWorkspace('ws-del', 'Delete Me', 'generated');
    await controller.deleteWorkspace('ws-del');
    const ws = await registry.get('ws-del');
    expect(ws).toBeUndefined();
  });
});

describe('WorkspaceController.updateStatus', () => {
  it('updates workspace status in registry', async () => {
    const { controller, registry } = makeController();
    await controller.createWorkspace('ws-status', 'Status App', 'generated');
    await controller.updateStatus('ws-status', 'error');
    const ws = await registry.get('ws-status');
    expect(ws?.status).toBe('error');
  });
});
