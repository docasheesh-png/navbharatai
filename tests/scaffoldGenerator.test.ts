/**
 * Tests for ScaffoldGenerator — maps framework templates to workspace files.
 * Uses a mock IWorkspaceManager to avoid real filesystem writes.
 */
import { describe, it, expect } from 'vitest';
import { ScaffoldGenerator } from '../src/server/AppMakerLab/generator/ScaffoldGenerator';
import type { IWorkspaceManager } from '../src/server/AppMakerLab/interfaces/IWorkspaceManager';
import type { GeneratedFile } from '../src/server/AppMakerLab/types/files';

function makeManager() {
  const written: Array<{ workspaceId: string; path: string; content: string }> = [];
  const manager: IWorkspaceManager = {
    createWorkspace: async () => '/fake',
    saveFiles: async () => {},
    writeFile: async (id, p, c) => { written.push({ workspaceId: id, path: p, content: c }); },
    getWorkspaceInfo: async () => ({ rootPath: '/fake', files: [] }),
    deleteWorkspace: async () => {},
  };
  return { manager, written };
}

describe('ScaffoldGenerator', () => {
  it('calls writeFile for each template file', async () => {
    const { manager, written } = makeManager();
    const gen = new ScaffoldGenerator(manager);
    await gen.generate({
      framework: 'vite-react',
      language: 'typescript',
      features: [],
      workspaceId: 'ws-scaffold',
    });
    expect(written.length).toBeGreaterThan(0);
    expect(written.every(w => w.workspaceId === 'ws-scaffold')).toBe(true);
  });

  it('passes workspaceId to every writeFile call', async () => {
    const { manager, written } = makeManager();
    const gen = new ScaffoldGenerator(manager);
    await gen.generate({
      framework: 'vite-react',
      language: 'typescript',
      features: ['auth'],
      workspaceId: 'my-workspace',
    });
    expect(written.every(w => w.workspaceId === 'my-workspace')).toBe(true);
  });

  it('all written paths are non-empty strings', async () => {
    const { manager, written } = makeManager();
    const gen = new ScaffoldGenerator(manager);
    await gen.generate({
      framework: 'vite-react',
      language: 'typescript',
      features: [],
      workspaceId: 'ws-paths',
    });
    expect(written.every(w => typeof w.path === 'string' && w.path.length > 0)).toBe(true);
  });

  it('all written contents are strings', async () => {
    const { manager, written } = makeManager();
    const gen = new ScaffoldGenerator(manager);
    await gen.generate({
      framework: 'vite-react',
      language: 'typescript',
      features: [],
      workspaceId: 'ws-content',
    });
    expect(written.every(w => typeof w.content === 'string')).toBe(true);
  });
});
