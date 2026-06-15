import { describe, it, expect, vi } from 'vitest';
import { runBuild } from '../src/server/project/BuildPipeline';
import type { FileEdit } from '../src/server/project/EditEngine';

describe('runBuild', () => {
  it('generates files from a prompt and returns a clean project', async () => {
    const generate = vi.fn(async () => [
      { op: 'write', path: 'index.html', content: '<h1>Todo App</h1><script src="app.js"></script>' },
      { op: 'write', path: 'app.js', content: 'console.log("todo")' },
    ] as FileEdit[]);
    const fix = vi.fn(async () => [] as FileEdit[]);

    const r = await runBuild({ prompt: 'make a todo app', generate, fix });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.fileCount).toBe(2);
    expect(r.files['index.html']).toContain('Todo App');
    expect(fix).not.toHaveBeenCalled(); // already clean → no repair needed
    expect(r.baselineSnapshotId).toBeTruthy();
  });

  it('auto-repairs a broken generation before returning', async () => {
    // generation writes invalid JSON; the fixer corrects it
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'write', path: 'index.html', content: '<h1>x</h1>' },
      { op: 'write', path: 'config.json', content: '{ broken json' },
    ];
    const fix = vi.fn(async () => [{ op: 'write', path: 'config.json', content: '{"ok":true}' }] as FileEdit[]);

    const r = await runBuild({ prompt: 'app with config', generate, fix });
    expect(r.ok).toBe(true);
    expect(r.repairAttempts).toBe(1);
    expect(fix).toHaveBeenCalledOnce();
    expect(r.files['config.json']).toBe('{"ok":true}');
  });

  it('edits existing files without losing unrelated ones', async () => {
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'patch', path: 'app.js', find: 'v1', replace: 'v2' },
    ];
    const r = await runBuild({
      prompt: 'bump version',
      files: { 'index.html': '<h1>app</h1>', 'app.js': 'const v="v1"', 'keep.js': 'KEEP' },
      generate, fix: async () => [],
    });
    expect(r.files['app.js']).toBe('const v="v2"');
    expect(r.files['keep.js']).toBe('KEEP'); // untouched
    expect(r.files['index.html']).toContain('app');
  });

  it('reports not-ok when repair cannot fix the project', async () => {
    const generate = async (): Promise<FileEdit[]> => [{ op: 'write', path: 'bad.json', content: '{ nope' }];
    const r = await runBuild({ prompt: 'x', generate, fix: async () => [] });
    expect(r.ok).toBe(false);
    expect(r.verify.errors).toBeGreaterThan(0);
  });
});
