import { describe, it, expect } from 'vitest';
import { VfsActuator } from '../src/server/EngineerAI/actuators/VfsActuator';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

function makeActuator(initialFiles: Record<string, string> = {}): VfsActuator {
  const vfs = VirtualFileSystem.fromRecord(initialFiles);
  return new VfsActuator(vfs);
}

describe('VfsActuator', () => {
  it('writeFile then readFile returns the written content', async () => {
    const act = makeActuator();
    await act.writeFile('ws', 'src/App.tsx', 'export default function App() {}');
    const content = await act.readFile('ws', 'src/App.tsx');
    expect(content).toContain('App');
  });

  it('readFile throws when file does not exist', async () => {
    const act = makeActuator();
    await expect(act.readFile('ws', 'missing.ts')).rejects.toThrow('File not found');
  });

  it('listFiles returns paths of all written files', async () => {
    const act = makeActuator({ 'a.ts': 'a', 'b.ts': 'b' });
    const paths = await act.listFiles();
    expect(paths).toContain('a.ts');
    expect(paths).toContain('b.ts');
  });

  it('searchFiles returns paths where any term matches', async () => {
    const act = makeActuator({ 'App.tsx': 'import React from "react"', 'utils.ts': 'export const add = (a, b) => a + b' });
    const results = await act.searchFiles('ws', ['react']);
    expect(results).toContain('App.tsx');
    expect(results).not.toContain('utils.ts');
  });

  it('getSandboxId returns null', async () => {
    const act = makeActuator();
    expect(await act.getSandboxId()).toBeNull();
  });

  it('screenshot returns empty base64', async () => {
    const act = makeActuator();
    const s = await act.screenshot();
    expect(s.base64).toBe('');
    expect(s.mimeType).toBe('image/png');
  });

  it('checkpoint then restore recovers a deleted file', async () => {
    const act = makeActuator({ 'index.ts': 'hello' });
    const ckptId = await act.checkpoint();
    await act.writeFile('ws', 'index.ts', 'overwritten');
    await act.restore('ws', ckptId);
    const content = await act.readFile('ws', 'index.ts');
    expect(content).toBe('hello');
  });

  it('restore throws for unknown checkpoint id', async () => {
    const act = makeActuator();
    await expect(act.restore('ws', 'nonexistent-ckpt')).rejects.toThrow('Checkpoint not found');
  });

  it('runCommand for npm install returns success with CDN note', async () => {
    const act = makeActuator();
    const result = await act.runCommand('ws', 'npm install');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('CDN');
  });

  it('runCommand for git returns success with skip message', async () => {
    const act = makeActuator();
    const result = await act.runCommand('ws', 'git status');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('skipped');
  });
});
