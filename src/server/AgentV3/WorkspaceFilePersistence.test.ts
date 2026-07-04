import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { fileDocId, loadWorkspaceFiles, capPathsToDocLimit } from './WorkspaceFileStore';
import type { ToolUse } from './ClaudeClient';

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

/** In-memory sandbox so write_file/edit_file run end-to-end. */
class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function dispatcherWithCapture(act: ActuatorPort, captured: Array<[string, string]>) {
  const onFileWrite = (path: string, content: string) => captured.push([path, content]);
  return new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, onFileWrite);
}

describe('durable file capture (onFileWrite)', () => {
  it('captures the exact content of a write_file', async () => {
    const captured: Array<[string, string]> = [];
    const d = dispatcherWithCapture(new MemActuator(), captured);
    await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'export const App = () => null;' }));
    expect(captured).toEqual([['src/App.tsx', 'export const App = () => null;']]);
  });

  it('captures the POST-EDIT content of an edit_file', async () => {
    const captured: Array<[string, string]> = [];
    const act = new MemActuator();
    act.files.set('src/App.tsx', 'const title = "old";');
    const d = dispatcherWithCapture(act, captured);
    await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: '"old"', new_string: '"new"' }));
    expect(captured).toEqual([['src/App.tsx', 'const title = "new";']]);
  });

  it('does not capture on a failed/no-op tool (read_file)', async () => {
    const captured: Array<[string, string]> = [];
    const act = new MemActuator();
    act.files.set('a.ts', 'x');
    const d = dispatcherWithCapture(act, captured);
    await d.dispatch(call('read_file', { path: 'a.ts' }));
    expect(captured).toEqual([]);
  });
});

describe('WorkspaceFileStore helpers', () => {
  it('fileDocId is deterministic, slash-free, and bounded', () => {
    const id = fileDocId('src/components/Button.tsx');
    expect(id).toBe(fileDocId('src/components/Button.tsx'));
    expect(id).not.toContain('/');
    expect(id.length).toBeLessThanOrEqual(1500);
    expect(fileDocId('a/b')).not.toBe(fileDocId('a/c'));
  });

  it('loadWorkspaceFiles is a safe no-op without Firestore (returns {})', async () => {
    await expect(loadWorkspaceFiles('ws-x')).resolves.toEqual({});
  });
});

describe('capPathsToDocLimit (huge-repo durable-index safety)', () => {
  it('keeps every path when the list fits under the 1MB metadata-doc limit', () => {
    const paths = Array.from({ length: 16_000 }, (_, i) => `client/src/pages/module${i}/file${i}.tsx`);
    const r = capPathsToDocLimit(paths);
    // ~16k realistic paths (~45 bytes each ≈ 720KB) fit comfortably — nothing dropped.
    expect(r.capped).toBe(0);
    expect(r.paths.length).toBe(paths.length);
  });

  it('caps gracefully (never exceeds the budget) for a pathological oversized list', () => {
    const paths = Array.from({ length: 60_000 }, (_, i) => `very/deeply/nested/directory/structure/path/segment/file-${i}.tsx`);
    const r = capPathsToDocLimit(paths, 100_000);
    expect(r.capped).toBeGreaterThan(0);
    expect(r.paths.length + r.capped).toBe(paths.length);
    // The kept set stays under the byte budget (this is the whole point — no failed Firestore write).
    const bytes = r.paths.reduce((n, p) => n + Buffer.byteLength(p, 'utf8') + 8, 40);
    expect(bytes).toBeLessThanOrEqual(100_000);
  });

  it('handles an empty list', () => {
    expect(capPathsToDocLimit([])).toEqual({ paths: [], capped: 0 });
  });
});
