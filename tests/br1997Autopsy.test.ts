/**
 * BR1997 autopsy: a shell `rm` deleted a stylesheet that the app entry still imported.
 *
 * The builder removed a stylesheet it took for an unused duplicate. The entry module still imported it.
 * tsc does not check a side-effect CSS import, so the typecheck stayed clean. The next real-browser look
 * showed a build-error overlay, and the repair took about 7.5 more minutes.
 *
 * F1: after a confirmed shell delete, the builder's bash result names a module whose CURRENT text
 * still imports the deleted file by its exact path. It is a note, never a refusal. Reworked after review:
 * bounded reads (12 at a time, 5 s each, 8 s in all) that never drop the sandbox, entry modules first,
 * comment/string-aware parsing, silence on extensionless specifiers (a sibling may serve them), and the
 * note kept out of the user's terminal and tool summary. All fixtures here are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sandbox } from 'e2b';
import {
  importsOfDeletedFiles,
  liveImportSpecifiers,
  exactImportTarget,
  orderImportCandidates,
  readSourcesWithinBudget,
  danglingImportNote,
  withoutDeletedImportNote,
  deletedImportNoteEnabled,
} from '../src/server/AgentV3/deletedImportNote';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { _clearWorkspaceMemory, getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxStore } from '../src/server/AgentV3/SandboxStore';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

const ROOT = join(__dirname, '..');
const ENTRY = "import React from 'react';\nimport App from './App';\nimport './styles/legacy.css';\nimport './index.css';\n";

describe('F1 importsOfDeletedFiles: pure, positive evidence only', () => {
  it('a side-effect CSS import of the deleted file is named', () => {
    const got = importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': ENTRY });
    expect(got).toEqual([{ importer: 'src/main.tsx', specifier: './styles/legacy.css', deleted: 'src/styles/legacy.css' }]);
  });

  it('a parent-relative import, a require, an explicit .ts import and a ?inline suffix are named', () => {
    const got = importsOfDeletedFiles(['src/theme.css', 'src/lib/fmt.ts'], {
      'src/components/Card.tsx': "import '../theme.css';\nimport { f } from '../lib/fmt.ts';\n",
      'src/legacy.js': "require('./theme.css');\n",
      'src/main.tsx': "import css from './theme.css?inline';\n",
    });
    expect(got.map((d) => `${d.importer}:${d.specifier}`)).toEqual([
      'src/components/Card.tsx:../theme.css',
      'src/components/Card.tsx:../lib/fmt.ts',
      'src/legacy.js:./theme.css',
      'src/main.tsx:./theme.css?inline',
    ]);
  });

  it('neighbour (sibling): deleting foo.ts while foo.tsx or foo/index.ts remains gives nothing for ./foo', () => {
    expect(importsOfDeletedFiles(['src/foo.ts'], { 'src/App.tsx': "import { a } from './foo';\n" })).toEqual([]);
    expect(importsOfDeletedFiles(['src/foo/index.ts'], { 'src/App.tsx': "import { a } from './foo';\n" })).toEqual([]);
  });

  it('neighbour: an import that names a different extension (./foo.js for foo.ts) gives nothing', () => {
    expect(importsOfDeletedFiles(['src/foo.ts'], { 'src/App.tsx': "import { a } from './foo.js';\n" })).toEqual([]);
  });

  it('neighbour: no importer gives nothing', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/App.tsx': "import './index.css';\n" })).toEqual([]);
  });

  it('neighbour: a similarly named file is not confused with the deleted one', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': "import './styles/legacy2.css';\nimport './legacy.css';\n" })).toEqual([]);
  });

  it('neighbour: bare package specifiers and aliases are ignored', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': "import 'legacy.css';\nimport '@/styles/legacy.css';\n" })).toEqual([]);
  });

  it('neighbour: commented-out imports, including a TRAILING // comment, are not live', () => {
    const src = "// import './styles/legacy.css';\n/* import './styles/legacy.css'; */\nconst x = 1; // import './styles/legacy.css'\nimport './index.css';\n";
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': src })).toEqual([]);
  });

  it('neighbour: a STRING or template containing an import-like pattern is not an import', () => {
    const src = "const a = \"import './styles/legacy.css'\";\nconst b = 'require(\"./styles/legacy.css\")';\nconst c = `import './styles/legacy.css'`;\nimport './index.css';\n";
    expect(importsOfDeletedFiles(['src/styles/legacy.css'], { 'src/main.tsx': src })).toEqual([]);
  });

  it('neighbour: an importer that was itself deleted, non-source importers, empty text and empty deletions give nothing', () => {
    expect(importsOfDeletedFiles(['src/styles/legacy.css', 'src/main.tsx'], { 'src/main.tsx': ENTRY })).toEqual([]);
    expect(importsOfDeletedFiles(['src/a.css'], { 'src/b.css': "@import './a.css';" })).toEqual([]);
    expect(importsOfDeletedFiles(['src/a.css'], { 'src/main.tsx': '' })).toEqual([]);
    expect(importsOfDeletedFiles([], { 'src/main.tsx': ENTRY })).toEqual([]);
  });
});

describe('F1 liveImportSpecifiers and exactImportTarget', () => {
  it('reads side-effect, from, multi-line, export-from, dynamic import and require', () => {
    const src = "import './a.css';\nimport {\n  x,\n  y,\n} from './b.ts';\nexport * from './c.ts';\nconst m = import('./d.css');\nconst r = require('./e.css');\n";
    expect(liveImportSpecifiers(src)).toEqual(['./a.css', './b.ts', './c.ts', './d.css', './e.css']);
  });
  it('a member call named import/require is not a statement', () => {
    expect(liveImportSpecifiers("loader.import('./a.css');\nobj.require('./b.css');\n")).toEqual([]);
  });
  it('a `from` word outside an import is not a specifier', () => {
    expect(liveImportSpecifiers("const from = 1;\nexport const label = 'from';\n")).toEqual([]);
  });
  it('exactImportTarget joins only relative, extensioned specifiers', () => {
    expect(exactImportTarget('src/main.tsx', './styles/a.css')).toBe('src/styles/a.css');
    expect(exactImportTarget('src/components/Card.tsx', '../a.css')).toBe('src/a.css');
    expect(exactImportTarget('src/main.tsx', './a.css?inline')).toBe('src/a.css');
    expect(exactImportTarget('src/main.tsx', './foo')).toBeNull();
    expect(exactImportTarget('src/main.tsx', './styles/')).toBeNull();
    expect(exactImportTarget('src/main.tsx', 'react')).toBeNull();
    expect(exactImportTarget('src/main.tsx', 'legacy.css')).toBeNull();
    expect(exactImportTarget('src/main.tsx', '@/styles/a.css')).toBeNull();
    expect(exactImportTarget('main.tsx', '../../x.css')).toBeNull();
  });
});

describe('F1 ordering and the read budget', () => {
  it('entry modules first: shallow main/index/App, then deeper ones, then the rest in order', () => {
    const got = orderImportCandidates(['src/a.ts', 'src/pages/index.tsx', 'src/b.ts', 'src/App.tsx', 'src/main.tsx', 'src/c.ts']);
    expect(got).toEqual(['src/App.tsx', 'src/main.tsx', 'src/pages/index.tsx', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('a stalled read hits the per-file timeout and is skipped; the rest are kept', async () => {
    const read = (p: string) => (p === 'stall.ts' ? new Promise<string>(() => {}) : Promise.resolve(`// ${p}`));
    const t0 = Date.now();
    const got = await readSourcesWithinBudget(['a.ts', 'stall.ts', 'b.ts'], read, { perFileMs: 40, budgetMs: 2_000 });
    expect(Object.keys(got).sort()).toEqual(['a.ts', 'b.ts']);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('🔴 stalled reads hit the overall budget: it returns what was read, never waiting past it', async () => {
    const read = (p: string) => (p.startsWith('stall') ? new Promise<string>(() => {}) : Promise.resolve('x'));
    const paths = ['ok.ts', ...Array.from({ length: 30 }, (_, i) => `stall${i}.ts`)];
    const t0 = Date.now();
    const got = await readSourcesWithinBudget(paths, read, { concurrency: 12, perFileMs: 10_000, budgetMs: 80 });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(Object.keys(got)).toEqual(['ok.ts']);
  });

  it('reads with at most 12 in flight; a throwing read is skipped', async () => {
    let inFlight = 0;
    let peak = 0;
    const read = async (p: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (p === 'bad.ts') throw new Error('nope');
      return 'x';
    };
    const paths = ['bad.ts', ...Array.from({ length: 40 }, (_, i) => `f${i}.ts`)];
    const got = await readSourcesWithinBudget(paths, read);
    expect(peak).toBe(12);
    expect(Object.keys(got)).toHaveLength(40);
  });
});

describe('F1 danglingImportNote and the summary strip', () => {
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
  it('withoutDeletedImportNote drops only the note block; content without it is returned unchanged', () => {
    const note = danglingImportNote([{ importer: 'src/main.tsx', specifier: './a.css', deleted: 'src/a.css' }]);
    expect(withoutDeletedImportNote(`exit=0\n\n${note}`)).toBe('exit=0');
    const plain = 'exit=0\n\n[deleted-file check] printed by the app itself';
    expect(withoutDeletedImportNote(plain)).toBe(plain);
  });
  it('kill switch AGENTV3_DELETED_IMPORT_NOTE=off', () => {
    expect(deletedImportNoteEnabled({})).toBe(true);
    expect(deletedImportNoteEnabled({ AGENTV3_DELETED_IMPORT_NOTE: 'OFF' })).toBe(false);
  });
});

class Act implements ActuatorPort {
  constructor(public files: Map<string, string>, public failReadsOf = new Set<string>(), public stallReadsOf = new Set<string>()) {}
  reads: string[] = [];
  async readFile(_ws: string, path: string): Promise<string> {
    this.reads.push(path);
    if (this.stallReadsOf.has(path)) return new Promise<string>(() => {});
    const f = this.files.get(path);
    if (f === undefined || this.failReadsOf.has(path)) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    const rm = /^rm\s+(?:-\w+\s+)*(\S+)$/.exec(command.trim());
    if (rm) { this.files.delete(rm[1]); this.stallReadsOf.delete(rm[1]); }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function harness(ws: string, files: Record<string, string>, opts: { fail?: string[]; stall?: string[]; act?: Act } = {}) {
  const act = opts.act ?? new Act(new Map(Object.entries(files)), new Set(opts.fail ?? []), new Set(opts.stall ?? []));
  const mem = getWorkspaceMemory(ws);
  for (const [p, c] of Object.entries(files)) mem.indexFile(p, c);
  const stream = new AgentEventStream();
  const events: Array<{ type: string; summary?: string }> = [];
  stream.subscribe((e) => events.push(e as { type: string; summary?: string }), false);
  const state = new WorkspaceState(stream);
  const d = new ToolDispatcher(act, ws, state, stream);
  const captured = new Map(Object.entries(files));
  d.setRecordedPaths(() => [...captured.keys()]);
  d.setFileDeletionSink((paths) => { for (const p of paths) captured.delete(p); });
  return { d, act, captured, state, events };
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
  afterEach(() => { vi.useRealTimers(); });

  it('🔴 the report shape: rm of a stylesheet the entry imports appends the note to the builder result', async () => {
    const { d, captured } = harness('ws-br1997-a', FILES);
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(captured.has('src/styles/legacy.css')).toBe(false);
    expect(out).toContain('[deleted-file check]');
    expect(out).toContain("src/main.tsx imports './styles/legacy.css'");
  });

  it('the note reaches the builder but not the user terminal or the tool summary', async () => {
    const { d, state, events } = harness('ws-br1997-a2', FILES);
    const res = await d.dispatch(bash('rm src/styles/legacy.css'));
    expect(res.content).toContain('[deleted-file check]');
    expect(state.snapshot().terminalLines.join('\n')).not.toContain('[deleted-file check]');
    const summary = events.find((e) => e.type === 'tool_result')?.summary ?? '';
    expect(summary).toMatch(/^exit=0/);
    expect(summary).not.toContain('[deleted-file check]');
  });

  it('ordering: with 100 recorded files and the entry recorded last, the 60 cap still reads the entry', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 100; i++) many[`src/gen/m${i}.ts`] = `export const v${i} = ${i};\n`;
    const files = { ...many, 'src/styles/legacy.css': '.x{}', 'src/main.tsx': ENTRY };
    const { d, act } = harness('ws-br1997-g', files);
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(out).toContain("src/main.tsx imports './styles/legacy.css'");
    const noteReads = act.reads.filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
    expect(noteReads[0]).toBe('src/main.tsx');
    expect(noteReads.length).toBeLessThanOrEqual(60);
  });

  it('🔴 stalled reads: the bash result returns within the 8 s budget (fake clock), without the note', async () => {
    vi.useFakeTimers();
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) many[`src/gen/m${i}.ts`] = 'x';
    const files = { ...FILES, ...many };
    const { d } = harness('ws-br1997-h', files, { stall: Object.keys(files).filter((p) => p !== 'src/styles/legacy.css') });
    let settled: string | null = null;
    void d.run(bash('rm src/styles/legacy.css'), 'architect').then((o) => { settled = String(o); });
    let waited = 0;
    while (settled === null && waited < 20_000) { await vi.advanceTimersByTimeAsync(250); waited += 250; }
    expect(settled).not.toBeNull();
    expect(waited).toBeLessThanOrEqual(8_250);
    expect(settled).not.toContain('[deleted-file check]');
  });

  it('uses the actuator advisory read when it has one', async () => {
    const act = new Act(new Map(Object.entries(FILES)));
    const advisory = vi.fn(async (_ws: string, p: string, ms?: number) => { expect(ms).toBe(5_000); return act.files.get(p) ?? ''; });
    (act as unknown as { readFileAdvisory: typeof advisory }).readFileAdvisory = advisory;
    const { d } = harness('ws-br1997-i', FILES, { act });
    const out = String(await d.run(bash('rm src/styles/legacy.css'), 'architect'));
    expect(out).toContain('[deleted-file check]');
    expect(advisory).toHaveBeenCalled();
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
    const { d } = harness('ws-br1997-e', FILES, { fail: ['src/main.tsx'] });
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

describe('E2BActuator: an advisory read timeout never drops the sandbox', () => {
  const WS = 'ws-br1997-e2b';
  function fixture() {
    vi.spyOn(sandboxStore, 'touch').mockResolvedValue(undefined);
    const act = new E2BActuator('unit-test-key');
    const internal = act as unknown as { sandboxes: Map<string, Sandbox> };
    const handle = {
      sandboxId: 'sb-stall',
      setTimeout: vi.fn().mockResolvedValue(undefined),
      files: { read: vi.fn(() => new Promise<string>(() => {})) },
      commands: { run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    } as unknown as Sandbox;
    internal.sandboxes.set(WS, handle);
    return { act, internal, handle };
  }
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('🔴 readFileAdvisory times out at its own bound and the cached sandbox stays', async () => {
    const f = fixture();
    const p = expect(f.act.readFileAdvisory(WS, 'src/main.tsx', 5_000)).rejects.toThrow(/timed out after 5000ms/);
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(f.internal.sandboxes.get(WS)).toBe(f.handle);
  });

  it('neighbour (unchanged): a plain readFile timeout still drops the cached sandbox', async () => {
    const f = fixture();
    const p = expect(f.act.readFile(WS, 'src/main.tsx')).rejects.toThrow(/timed out after 30000ms/);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(f.internal.sandboxes.get(WS)).toBeUndefined();
  });
});

describe('source pins', () => {
  const td = readFileSync(join(ROOT, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  it('only the bash path uses the gone list; other reconcile callers are unchanged', () => {
    expect(td).toContain('try { shellDeleted = await this.reconcileDeletions(candidates); }');
    expect(td).toContain('if (shellDeleted.length > 0 && deletedImportNoteEnabled()) {');
    expect(td).toContain('if (stale.length > 0) await this.reconcileDeletions(stale);');
  });
  it('the note is added after the terminal line, and the summary strips it', () => {
    const t = td.indexOf('this.state?.appendTerminal(out);\n        // BR1997');
    const i = td.indexOf('const dangling = await this.deletedImportNoteFor(shellDeleted)');
    expect(t).toBeGreaterThan(0);
    expect(i).toBeGreaterThan(t);
    expect(td).toContain('summary: redactSecrets(summarize(withoutDeletedImportNote(content))),');
  });
  it('the reads are ordered, capped at 60 and bounded', () => {
    expect(td).toContain('const sources = await readSourcesWithinBudget(candidates, read);');
    expect(td).toMatch(/orderImportCandidates\([\s\S]{0,200}\)\.slice\(0, 60\)/);
  });
});
