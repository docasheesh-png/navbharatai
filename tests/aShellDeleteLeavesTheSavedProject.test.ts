/**
 * QUEUE Q-246 (candy report 7da1cdca, 2026-10-04): A FILE A SHELL REMOVED WAS PUT BACK BY THE SAVE.
 *
 * The final save starts from the sandbox scan and then lets the build's CAPTURED writes win. A file the
 * build wrote and later removed with the shell stayed captured, so the save put it back into the project
 * and the next sandbox restored it. `fileDeletion.ts` already forgot a removed file, but only what the
 * delete guard parses: one SOURCE file named by `rm`. A stylesheet, a folder, a glob and the source of a
 * `mv` all came back, and a sub-agent's `rm` reached nothing at all (its dispatcher had no sink).
 *
 * The class: "the save keeps what the build recorded, whatever the shell did to it since". Locked here
 * on the real dispatcher, with the sandbox confirming each removal before anything is forgotten.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { removedRecordedPaths, shellRemovedOperands, MAX_REMOVAL_PROBES } from '../src/server/AgentV3/shellWriteTargets';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

const ROOT = join(__dirname, '..');

describe('shellRemovedOperands — what a command may have taken out', () => {
  it('reads rm / unlink / git rm paths and globs, of any file kind', () => {
    expect(shellRemovedOperands('rm src/candy.css').paths).toEqual(['src/candy.css']);
    expect(shellRemovedOperands('rm -rf src/legacy').paths).toEqual(['src/legacy']);
    expect(shellRemovedOperands('git rm public/old.svg').paths).toEqual(['public/old.svg']);
    expect(shellRemovedOperands('rm src/*.bak.ts').globs).toEqual(['src/*.bak.ts']);
  });

  it('reads the SOURCES of mv and git mv, never the destination', () => {
    expect(shellRemovedOperands('mv src/a.ts src/b.ts').paths).toEqual(['src/a.ts']);
    expect(shellRemovedOperands('git mv src/x.css src/y.css src/styles/').paths).toEqual(['src/x.css', 'src/y.css']);
    expect(shellRemovedOperands('cd /home/user/workspace && mv ./src/old.tsx /home/user/workspace/src/new.tsx').paths).toEqual(['src/old.tsx']);
  });

  it('precision first: `mv -t DIR`, paths outside the workspace and ordinary commands name nothing', () => {
    expect(shellRemovedOperands('mv -t src/lib src/a.ts').paths).toEqual([]);
    expect(shellRemovedOperands('rm /tmp/scratch.txt').paths).toEqual([]);
    expect(shellRemovedOperands('npm install && npm run build').paths).toEqual([]);
    expect(shellRemovedOperands('cp src/a.ts src/b.ts').paths).toEqual([]);
  });
});

describe('removedRecordedPaths — only recorded paths are ever named', () => {
  const recorded = ['src/App.tsx', 'src/candy.css', 'src/legacy/A.tsx', 'src/legacy/deep/B.ts', 'src/legacyNote.md', 'src/a.bak.ts', 'src/lib/a.ts'];

  it('a path, everything under a folder, and every glob match', () => {
    expect(removedRecordedPaths({ paths: ['src/candy.css'], globs: [] }, recorded)).toEqual(['src/candy.css']);
    expect(removedRecordedPaths({ paths: ['src/legacy'], globs: [] }, recorded)).toEqual(['src/legacy/A.tsx', 'src/legacy/deep/B.ts']);
    expect(removedRecordedPaths({ paths: [], globs: ['src/*.bak.ts'] }, recorded)).toEqual(['src/a.bak.ts']);
  });

  it('a folder name is not a prefix of a sibling file, and a glob star never crosses a slash', () => {
    expect(removedRecordedPaths({ paths: ['src/legacy'], globs: [] }, recorded)).not.toContain('src/legacyNote.md');
    expect(removedRecordedPaths({ paths: [], globs: ['src/*.ts'] }, recorded)).not.toContain('src/lib/a.ts');
  });

  it('is bounded', () => {
    const many = Array.from({ length: 500 }, (_, i) => `src/gen/f${i}.ts`);
    expect(removedRecordedPaths({ paths: ['src/gen'], globs: [] }, many)).toHaveLength(MAX_REMOVAL_PROBES);
  });
});

class ShellActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['src/App.tsx', 'export default function App() { return null; }'],
    ['src/candy.css', '.board { display: grid; }'],
    ['src/legacy/A.tsx', 'export const A = 1;'],
    ['src/legacy/deep/B.ts', 'export const B = 2;'],
    ['src/a.ts', 'export const a = 1;'],
    ['public/sprites/candy.svg', '<svg/>'],
    ['public/sprites/deep/star.svg', '<svg/>'],
  ]);
  /** `rm x || true`: exit 0 having removed nothing. */
  pretendOnly = false;
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    if (!this.pretendOnly) {
      const rm = /^rm\s+(?:-\w+\s+)*(\S+)$/.exec(command.trim());
      if (rm) for (const k of [...this.files.keys()]) if (k === rm[1] || k.startsWith(`${rm[1]}/`)) this.files.delete(k);
      const mv = /^mv\s+(\S+)\s+(\S+)$/.exec(command.trim());
      if (mv && this.files.has(mv[1])) { this.files.set(mv[2], this.files.get(mv[1])!); this.files.delete(mv[1]); }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

/** The route's own shape: a captured-writes map, the sink deletes from it. */
function harness(act: ShellActuator, ws: string) {
  const captured = new Map<string, string>(act.files);
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, ws, new WorkspaceState(stream), stream);
  d.setRecordedPaths(() => [...captured.keys()]);
  d.setFileDeletionSink((paths) => { for (const p of paths) captured.delete(p); });
  return { d, captured };
}
const bash = (command: string): ToolUse => ({ id: 'b1', name: 'bash', input: { command } });

describe('🔴 end to end: what the shell removed is not saved again', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('a stylesheet removed with rm leaves the captured set (the guard never parsed a .css)', async () => {
    const act = new ShellActuator();
    const { d, captured } = harness(act, 'ws-q246-css');
    await d.run(bash('rm src/candy.css'), 'architect');
    expect(captured.has('src/candy.css')).toBe(false);
    expect(captured.has('src/App.tsx')).toBe(true);
  });

  it('a folder removed with rm -rf takes every captured file under it, and nothing beside it', async () => {
    const act = new ShellActuator();
    const { d, captured } = harness(act, 'ws-q246-dir');
    await d.run(bash('rm -rf public/sprites'), 'architect');
    expect([...captured.keys()].filter((p) => p.startsWith('public/sprites/'))).toEqual([]);
    expect(captured.has('src/a.ts')).toBe(true);
  });

  it('🔒 a SOURCE folder is still refused by the delete guard, so nothing is forgotten', async () => {
    const act = new ShellActuator();
    const { d, captured } = harness(act, 'ws-q246-srcdir');
    const out = await d.run(bash('rm -rf src/legacy'), 'architect');
    expect(String(out)).toContain('GOVERNANCE BLOCKED');
    expect(captured.has('src/legacy/A.tsx')).toBe(true);
  });

  it('the source of a mv leaves the captured set', async () => {
    const act = new ShellActuator();
    const { d, captured } = harness(act, 'ws-q246-mv');
    await d.run(bash('mv src/a.ts src/b.ts'), 'architect');
    expect(captured.has('src/a.ts')).toBe(false);
  });

  it('🔒 nothing is forgotten unless the sandbox confirms it is gone (`rm x || true`)', async () => {
    const act = new ShellActuator();
    act.pretendOnly = true;
    const { d, captured } = harness(act, 'ws-q246-pretend');
    await d.run(bash('rm src/candy.css'), 'architect');
    await d.run(bash('rm -rf public/sprites'), 'architect');
    expect(captured.size).toBe(7);
  });
});

describe('the wiring — proven by reversion', () => {
  it('the route hands the dispatcher its captured paths, and sub-agents share the deletion wiring', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/dispatcher\.setRecordedPaths\(\(\) => \[\.\.\.writtenFiles\.keys\(\)\]\)/);
    expect(route).toMatch(/deletionWiring: \(\) => dispatcherForSubAgents\?\.deletionWiring\(\)/);
    const sub = readFileSync(join(ROOT, 'src/server/AgentV3/SubAgent.ts'), 'utf8');
    expect(sub).toMatch(/childDispatcher\.shareDeletionWiring\(deps\.deletionWiring\?\.\(\)\)/);
  });

  it('a child dispatcher given the parent wiring forgets what its own rm removed', async () => {
    _clearWorkspaceMemory();
    const act = new ShellActuator();
    const { d: parent, captured } = harness(act, 'ws-q246-child');
    const stream = new AgentEventStream();
    const child = new ToolDispatcher(act, 'ws-q246-child', new WorkspaceState(stream), stream);
    child.shareDeletionWiring(parent.deletionWiring());
    await child.run(bash('rm src/candy.css'), 'frontend');
    expect(captured.has('src/candy.css')).toBe(false);
  });
});
