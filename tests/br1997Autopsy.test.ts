/**
 * BR1997 autopsy: a shell `rm` deleted a stylesheet that the app entry still imported.
 *
 * The builder removed a stylesheet it took for an unused duplicate. The entry module still imported it.
 * tsc does not check a side-effect CSS import, so the typecheck stayed clean. The next real-browser look
 * showed a build-error overlay, and the repair took about 7.5 more minutes.
 *
 * F1: after a confirmed shell delete, the bash result names a module whose CURRENT text still imports
 * the deleted file. It is a note, never a refusal. All fixtures here are synthetic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  importsOfDeletedFiles,
  danglingImportNote,
  deletedImportNoteEnabled,
} from '../src/server/AgentV3/deletedImportNote';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { _clearWorkspaceMemory, getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

const ROOT = join(__dirname, '..');
const ENTRY = "import React from 'react';\nimport App from './App';\nimport './styles/legacy.css';\nimport './index.css';\n";

describe('F1 importsOfDeletedFiles: pure, positive evidence only', () => {
  it('a side-effect CSS import of the deleted file is named', () => {
    const got = importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': ENTRY });
    expect(got).toEqual([{ importer: 'src/main.tsx', specifier: './styles/legacy.css', deleted: 'src/styles/legacy.css' }]);
  });

  it('an extensionless TS module import is named', () => {
    const got = importsOfDeletedFiles(['src/lib/format.ts'], { 'src/App.tsx': "import { fmt } from './lib/format';\n" });
    expect(got.map((d) => d.deleted)).toEqual(['src/lib/format.ts']);
  });

  it('a parent-relative import and a require are named', () => {
    const got = importsOfDeletedFiles(['src/theme.css'], {
      'src/components/Card.tsx': "import '../theme.css';\n",
      'src/legacy.js': "require('./theme.css');\n",
    });
    expect(got.map((d) => d.importer)).toEqual(['src/components/Card.tsx', 'src/legacy.js']);
  });

  it('a Vite query suffix (?inline) still resolves to the deleted file', () => {
    const got = importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': "import css from './styles/legacy.css?inline';\n" });
    expect(got).toEqual([{ importer: 'src/main.tsx', specifier: './styles/legacy.css?inline', deleted: 'src/styles/legacy.css' }]);
  });

  it('neighbour: no importer gives nothing', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/App.tsx': "import './index.css';\n" })).toEqual([]);
  });

  it('neighbour: a similarly named file that still exists is not confused with the deleted one', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': "import './styles/legacy2.css';\nimport './legacy.css';\n" })).toEqual([]);
  });

  it('neighbour: bare package specifiers and aliases are ignored', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': "import 'legacy.css';\nimport '@/styles/legacy.css';\n" })).toEqual([]);
  });

  it('neighbour: a commented-out import is not live', () => {
    const src = "// import './styles/legacy.css';\n/* import './styles/legacy.css'; */\nimport './index.css';\n";
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': src })).toEqual([]);
  });

  it('neighbour: an importer that was itself deleted is not named', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css', 'src/main.tsx'], { 'src/main.tsx': ENTRY })).toEqual([]);
  });

  it('neighbour: non-source importers, empty text and empty deletions give nothing', () => {
    expect(importsOfDeletedFiles(['src/a.css'], { 'src/b.css': "@import './a.css';" })).toEqual([]);
    expect(importsOfDeletedFiles(['src/a.css'], { 'src/main.tsx': '' })).toEqual([]);
    expect(importsOfDeletedFiles([], { 'src/main.tsx': ENTRY })).toEqual([]);
  });
});

describe('F1 danglingImportNote: wording and bounds', () => {
  it('empty list gives an empty string', () => {
    expect(danglingImportNote([])).toBe('');
  });
  it('names importer, specifier and the gone path; asks to repoint or restore', () => {
    const note = danglingImportNote([{ importer: 'src/main.tsx', specifier: './styles/legacy.css', deleted: 'src/styles/legacy.css' }]);
    expect(note).toContain("src/main.tsx imports './styles/legacy.css' (src/styles/legacy.css is gone)");
    expect(note).toMatch(/Remove or repoint the import, or restore the file/);
  });
  it('is bounded to five entries with a count of the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ importer: `src/m${i}.ts`, specifier: './x.css', deleted: 'src/x.css' }));
    const note = danglingImportNote(many);
    expect(note).toContain('+3 more');
    expect(note).not.toContain('src/m5.ts');
  });
  it('kill switch AGENTV3_DELETED_IMPORT_NOTE=off', () => {
    expect(deletedImportNoteEnabled({})).toBe(true);
    expect(deletedImportNoteEnabled({ AGENTV3_DELETED_IMPORT_NOTE: 'OFF' })).toBe(false);
  });
});

class Act implements ActuatorPort {
  constructor(public files: Map<string, string>, public failReadsOf = new Set<string>()) {}
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined || this.failReadsOf.has(path)) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    const rm = /^rm\s+(?:-\w+\s+)*(\S+)$/.exec(command.trim());
    if (rm) this.files.delete(rm[1]);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function harness(ws: string, files: Record<string, string>, failReadsOf: string[] = []) {
  const act = new Act(new Map(Object.entries(files)), new Set(failReadsOf));
  const mem = getWorkspaceMemory(ws);
  for (const [p, c] of Object.entries(files)) mem.indexFile(p, c);
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, ws, new WorkspaceState(stream), stream);
  const captured = new Map(Object.entries(files));
  d.setRecordedPaths(() => [...captured.keys()]);
  d.setFileDeletionSink((paths) => { for (const p of paths) captured.delete(p); });
  return { d, act, captured };
}
const bash = (command: string): ToolUse => ({ id: 'b1', name: 'bash', input: { command } });
const FILES = {
  'src/main.tsx': ENTRY,
  'src/App.tsx': 'export default function App() { return null; }\n',
  'src/index.css': 'body { margin: 0; }\n',
  'src/styles/legacy.css': '.x { color: red; }\n',
  'src/styles/unused.css': '.y { color: blue; }\n',
};

describe('F1 end to end on the real dispatcher', () => {
  beforeEach(() => { _clearWorkspaceMemory(); delete process.env.AGENTV3_DELETED_IMPORT_NOTE; });

  it('🔴 the report shape: rm of a stylesheet the entry imports appends the note', async () => {
    const { d, captured } = harness('ws-br1997-a', FILES);
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(captured.has('src/styles/legacy.css')).toBe(false);
    expect(out).toContain('[deleted-file check]');
    expect(out).toContain("src/main.tsx imports './styles/legacy.css'");
  });

  it('neighbour: rm of a stylesheet nothing imports leaves the output byte-identical to the switch-off run', async () => {
    const on = String(await harness('ws-br1997-b', FILES).d.run(bash('rm src/styles/unused.css'), 'architect'));
    _clearWorkspaceMemory();
    process.env.AGENTV3_DELETED_IMPORT_NOTE = 'off';
    const off = String(await harness('ws-br1997-b', FILES).d.run(bash('rm src/styles/unused.css'), 'architect'));
    expect(on).toBe(off);
    expect(on).not.toContain('[deleted-file check]');
  });

  it('neighbour: with the switch off the importer case has no note', async () => {
    process.env.AGENTV3_DELETED_IMPORT_NOTE = 'off';
    const out = String(await harness('ws-br1997-c', FILES).d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(out).not.toContain('[deleted-file check]');
  });

  it('neighbour: the importer already repointed (current text no longer imports it) gives no note', async () => {
    const { d, act } = harness('ws-br1997-d', FILES);
    act.files.set('src/main.tsx', "import App from './App';\nimport './index.css';\n");
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(out).not.toContain('[deleted-file check]');
  });

  it('neighbour: an unreadable importer stays silent and the command output still returns', async () => {
    const { d } = harness('ws-br1997-e', FILES, ['src/main.tsx']);
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(out).toMatch(/^exit=0/);
    expect(out).not.toContain('[deleted-file check]');
  });

  it('neighbour: an rm that removed nothing gives no note', async () => {
    const { d } = harness('ws-br1997-f', FILES);
    const out = String(await d.run(bash('rm src/styles/missing.css'), 'architect'));
    expect(out).not.toContain('[deleted-file check]');
  });
});

describe('source pins', () => {
  const td = readFileSync(join(ROOT, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  it('only the bash path uses the gone list; other reconcile callers are unchanged', () => {
    expect(td).toContain('try { shellDeleted = await this.reconcileDeletions(candidates); }');
    expect(td).toContain('if (shellDeleted.length > 0 && deletedImportNoteEnabled()) {');
    expect(td).toContain('if (stale.length > 0) await this.reconcileDeletions(stale);');
  });
  it('the note is appended to the bash result before it reaches the terminal', () => {
    const i = td.indexOf('const dangling = await this.deletedImportNoteFor(shellDeleted)');
    const j = td.indexOf('this.state?.appendTerminal(out);', i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});
