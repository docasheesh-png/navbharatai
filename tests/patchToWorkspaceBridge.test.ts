/**
 * Tests for PatchToWorkspaceBridge — delegates patch application to workspace manager.
 * Uses mock WorkspaceMutationEngine and WorkspaceManager.
 */
import { describe, it, expect } from 'vitest';
import { PatchToWorkspaceBridge } from '../src/server/AppMakerLab/generator/bridge/PatchToWorkspaceBridge';
import type { Patch } from '../src/server/AppMakerLab/generator/IGenerationEngine';

function makeEngineMock() {
  return {
    mutate: async () => ({ status: 'COMMITTED', patchBatch: { id: 'x', patches: [] } }),
    getPendingBatches: () => [],
    getCommittedBatches: () => [],
  } as any;
}

function makeManagerMock() {
  const calls: Array<{ workspaceId: string; path: string; content: string }> = [];
  const manager = {
    writeFile: async (id: string, path: string, content: string) => {
      calls.push({ workspaceId: id, path, content });
    },
    createWorkspace: async () => '/fake',
    saveFiles: async () => {},
    getWorkspaceInfo: async () => ({ rootPath: '/fake', files: [] }),
    deleteWorkspace: async () => {},
  } as any;
  return { manager, calls };
}

describe('PatchToWorkspaceBridge', () => {
  it('calls writeFile for each patch', async () => {
    const { manager, calls } = makeManagerMock();
    const bridge = new PatchToWorkspaceBridge(makeEngineMock(), manager);
    const patches: Patch[] = [
      { path: 'src/App.tsx', content: 'export default function App() { return null; }' },
      { path: 'src/main.tsx', content: 'import React from "react";' },
    ];
    await bridge.applyPatches('ws-bridge', patches);
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe('src/App.tsx');
    expect(calls[1].path).toBe('src/main.tsx');
  });

  it('forwards the workspaceId to every writeFile call', async () => {
    const { manager, calls } = makeManagerMock();
    const bridge = new PatchToWorkspaceBridge(makeEngineMock(), manager);
    await bridge.applyPatches('my-ws', [
      { path: 'index.ts', content: 'export {}' },
    ]);
    expect(calls.every(c => c.workspaceId === 'my-ws')).toBe(true);
  });

  it('forwards the patch content to writeFile', async () => {
    const { manager, calls } = makeManagerMock();
    const bridge = new PatchToWorkspaceBridge(makeEngineMock(), manager);
    const content = 'const x = 42; export default x;';
    await bridge.applyPatches('ws', [{ path: 'lib.ts', content }]);
    expect(calls[0].content).toBe(content);
  });

  it('is a no-op for an empty patch list', async () => {
    const { manager, calls } = makeManagerMock();
    const bridge = new PatchToWorkspaceBridge(makeEngineMock(), manager);
    await bridge.applyPatches('ws', []);
    expect(calls).toHaveLength(0);
  });
});
