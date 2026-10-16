/**
 * A WRITE THAT JOINS A SHARED COMPILE SEES THAT COMPILE'S WHOLE VERDICT — and a designed wait is not a
 * builder error (autopsy 9c612cdb, 2026-10-12: Q-983 and Q-989).
 *
 * Q-983 — THE CLASS: a coalesced operation shared its RESULT but not the facts about how the result was
 * obtained. `WriteTypecheckQueue` hands every writer that arrives during a compile the NEXT compile's
 * result, produced by ONE writer's closure. "tsc printed nothing", "the compiler never ran" and "the
 * compiler was not ready" were locals of each writer, set only inside the closure that ran, so every
 * writer that JOINED judged the shared errors with defaults:
 *   - a compiler that never ran was counted CLEAN (autopsy 12c642ed, back through the coalesced door);
 *   - a not-ready write was not counted as skipped;
 *   - a clean compile gave the joined writer no "✓ compiles" note (autopsy dfd81a3a);
 *   - every joiner healed the same TS1361 itself, so one run landed the same heal write more than once.
 * The probe that found it, three writes against a never-ran compiler: "w1: never-ran / w2: never-ran /
 * w3: clean", stats {runs: 2, cleanRuns: 1, notRunRuns: 2}.
 *
 * Q-989 — the full builder wrote `src/App.tsx` before the three components it imports (the admin's
 * entry-first order for an early preview, `earlyPreview.ts`). The note said "⏳ fixed in ANOTHER file …
 * Do NOT rewrite src/App.tsx" and App.tsx was never rewritten for them — but the counter added the three
 * errors to "error(s) quoted back in the file just written" and remembered them as compile errors, so the
 * report showed a planned step as a struggle. The ORDER is the admin's design and is not changed here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';
import {
  WRITE_TYPECHECK_NOT_READY_MARKER, splitByRemedy, writeTypecheckNote, writeTypecheckSummary,
  emptyWriteTypecheckStats,
} from '../src/server/AgentV3/writeTimeTypecheck';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isWriteCheck = (cmd: string) => cmd.includes(WRITE_TYPECHECK_NOT_READY_MARKER) && cmd.includes('--noEmit --incremental');

/** A sandbox whose write-time compile takes a moment, so writes that arrive meanwhile JOIN the next one. */
class SlowCompileSandbox implements ActuatorPort {
  files = new Map<string, string>([['tsconfig.json', '{}'], ['package.json', '{"name":"t"}']]);
  writes: Array<{ path: string; content: string }> = [];
  executions = 0;
  /** Paths whose reads take a moment (the value is the one present when the read STARTED). */
  slowReads = new Set<string>();
  constructor(private readonly output: (execution: number) => string) {}
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (this.slowReads.has(p)) await delay(15);
    if (f === undefined) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); this.writes.push({ path: p, content: c }); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_w: string, cmd: string) {
    if (!isWriteCheck(cmd)) return { exitCode: 0, stdout: '', stderr: '' };
    this.executions += 1;
    const out = this.output(this.executions);
    await delay(60);
    return { exitCode: out ? 2 : 0, stdout: out, stderr: '' };
  }
}

let wsSeq = 0;
function dispatcherOn(sandbox: SlowCompileSandbox): { d: ToolDispatcher; ws: string } {
  const stream = new AgentEventStream();
  const ws = `ws-joined-${Date.now()}-${wsSeq += 1}`;
  return { d: new ToolDispatcher(sandbox, ws, new WorkspaceState(stream), stream), ws };
}

const write = (d: ToolDispatcher, path: string, content: string) =>
  d.dispatch({ id: `w-${path}`, name: 'write_file', input: { path, content } }, 'architect').then((r) => String(r.content));

/** Three writes started at once: the first runs a compile alone, the other two JOIN the next one. */
async function threeAtOnce(d: ToolDispatcher): Promise<string[]> {
  return Promise.all([
    write(d, 'src/a.ts', 'export const a = 1;\n'),
    write(d, 'src/b.ts', 'export const b = 2;\n'),
    write(d, 'src/d.ts', 'export const d = 4;\n'),
  ]);
}

describe('Q-983 · every writer that joins a compile gets that compile\'s verdict', () => {
  it('🔴 a compiler that never ran is never counted clean — not for the writer that joined it either', async () => {
    const box = new SlowCompileSandbox(() => 'sh: 1: node_modules/.bin/tsc: No such file or directory\n');
    const { d } = dispatcherOn(box);
    const results = await threeAtOnce(d);
    const s = d.writeTypecheckStats();
    // The premise: three writes, two compiles — one alone, one shared by the two that arrived during it.
    expect(box.executions).toBe(2);
    expect(s.runs).toBe(2);
    expect(s.notRunRuns).toBe(2);
    expect(s.cleanRuns).toBe(0);
    for (const r of results) expect(r).not.toContain('✓ TYPECHECK');
    expect(writeTypecheckSummary(s, true)).toContain('2 run(s), 0 clean, 2 where the compiler never ran');
  });

  it('🔴 a clean compile is SAID to every writer that shared it, and counted once per compile', async () => {
    const box = new SlowCompileSandbox(() => '');
    const { d } = dispatcherOn(box);
    const results = await threeAtOnce(d);
    const s = d.writeTypecheckStats();
    expect(box.executions).toBe(2);
    // The model-facing half first: a writer that is not told "✓ compiles" runs tsc itself to find out.
    for (const r of results) expect(r).toContain('✓ TYPECHECK after this write');
    expect(s.runs).toBe(2);
    expect(s.cleanRuns).toBe(2); // never more clean runs than runs
    expect(s.notRunRuns).toBe(0);
  });

  it('🔴 a compile that was not ready counts EVERY write it skipped, joined ones included', async () => {
    const box = new SlowCompileSandbox(() => `${WRITE_TYPECHECK_NOT_READY_MARKER}:install-running\n`);
    const { d } = dispatcherOn(box);
    await threeAtOnce(d);
    const s = d.writeTypecheckStats();
    expect(box.executions).toBe(2);
    expect(s.runs).toBe(0);
    expect(s.skippedNotReady).toBe(3);
    expect(s.notReadyReasons?.['install-running']).toBe(3);
    expect(s.cleanRuns).toBe(0);
  });

  it('🔴 the type-only import heal lands ONCE for a compile, however many writers joined it', async () => {
    const TYPES = "export enum Color { Red = 'red', Blue = 'blue' }\n";
    const USES = "import type { Color } from './types';\nexport const first = Color.Red;\n";
    const TS1361 = "src/c.ts(2,22): error TS1361: 'Color' cannot be used as a value because it was imported using 'import type'.\n";
    // Compile 1 (src/c.ts alone) and 2 (src/a.ts alone) are clean; compile 3 — the one src/b.ts and
    // src/d.ts both joined — reports the TS1361 in src/c.ts, a file this build wrote earlier.
    const box = new SlowCompileSandbox((n) => (n === 3 ? TS1361 : ''));
    box.files.set('src/types.ts', TYPES);
    const { d } = dispatcherOn(box);
    await write(d, 'src/c.ts', USES);
    box.slowReads.add('src/c.ts'); // both joiners would read the pre-heal text before either wrote
    const results = await threeAtOnce(d);
    expect(box.executions).toBe(3);
    const healWrites = box.writes.filter((w) => w.path === 'src/c.ts' && w.content.includes("import { Color } from './types';"));
    expect(healWrites).toHaveLength(1);
    // Both writers that shared the compile (whichever two arrived second and third) are told what landed,
    // the one that compiled alone was told it compiles, and no writer is handed the healed error.
    expect(results.filter((r) => r.includes('🔧 Fixed automatically: src/c.ts (Color)'))).toHaveLength(2);
    expect(results.filter((r) => r.includes('✓ TYPECHECK after this write'))).toHaveLength(1);
    for (const r of results) expect(r).not.toContain('TS1361');
  });

  it('SOURCE: the queue carries the outcome, never bare errors, and per-run counters sit inside the run', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain('new WriteTypecheckQueue<WriteTypecheckRunOutcome>()');
    const start = src.indexOf('private async writeTypecheckNote(');
    const body = src.slice(start, src.indexOf('private typeOnlyHealForRun(', start));
    // No verdict flag may live in the writer's own scope again — that is the bug's exact shape.
    expect(body).not.toMatch(/\blet (silentRun|neverRan|notReady|notReadyWhy)\b/);
    const runStart = body.indexOf('this._writeTypecheckQueue.run(');
    const runEnd = body.indexOf('let errors = run.errors;');
    expect(runStart).toBeGreaterThan(-1);
    expect(runEnd).toBeGreaterThan(runStart);
    const inside = body.slice(runStart, runEnd);
    const outside = body.slice(0, runStart) + body.slice(runEnd);
    for (const perRun of ['s.runs += 1', 's.cleanRuns += 1', 's.notRunRuns += 1', 's.compiledUnprobed += 1']) {
      expect(inside).toContain(perRun);
      expect(outside).not.toContain(perRun);
    }
  });

  it('CENSUS: no heal is called straight from writeTypecheckNote — every heal over the shared errors is keyed on the run', () => {
    // The heal half of the class. Every writer that joined a compile holds the SAME errors, so a heal called
    // per writer runs once per joiner: duplicate heal writes when the reads race, or — when the first heal
    // has already landed — a joiner whose heal finds nothing and quotes the healed error back to the model.
    // The type-only heal was the instance; a NEW heal added to this function is the next sibling, and this
    // census is what stops it from coming back through the same door.
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const start = src.indexOf('private async writeTypecheckNote(');
    const end = src.indexOf('\n  }\n', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const perWriter = body.match(/this\.(?:heal\w*|\w+AtWrite|landHealWrite)\(|this\.actuator\.writeFile\(/g) ?? [];
    expect(
      perWriter,
      'a heal called straight from writeTypecheckNote runs once per JOINED writer. Route it through a helper keyed on '
      + 'the shared run outcome, as typeOnlyHealForRun does, and share only what the heal ADDS (the healed files, '
      + 'the note, the remaining errors) — never the first writer\'s own `sources`.',
    ).toEqual([]);
    expect(body).toContain('await this.typeOnlyHealForRun(run, tsPaths, sources)');
  });
});

// The report's real compiler output at 147.4 s, right after `src/App.tsx` was written (verbatim positions;
// the message text is tsc's standard TS2307 wording, which the report cut short).
const REPORT_147_4 = [
  "src/App.tsx(4,29): error TS2307: Cannot find module './components/VideoPlayer' or its corresponding type declarations.",
  "src/App.tsx(5,27): error TS2307: Cannot find module './components/VideoList' or its corresponding type declarations.",
  "src/App.tsx(6,31): error TS2307: Cannot find module './components/AddVideoModal' or its corresponding type declarations.",
].join('\n');
const APP = [
  "import { useState } from 'react';",
  "import type { Video } from './types';",
  "import { useVideoList } from './hooks/useVideoList';",
  "import { VideoPlayer } from './components/VideoPlayer';",
  "import { VideoList } from './components/VideoList';",
  "import { AddVideoModal } from './components/AddVideoModal';",
  'export default function App() { const [v] = useState<Video | null>(null); useVideoList(); return <main>{String(v)}<VideoPlayer /><VideoList /><AddVideoModal /></main>; }',
  '',
].join('\n');

describe('Q-989 · an error that waits on a file not written yet is reported apart from the builder\'s own', () => {
  it('the split: the report\'s three TS2307 are all waiting, none is the file\'s own to fix', () => {
    const { fixHere, waiting, others } = splitByRemedy(parseTscErrors(REPORT_147_4), ['src/App.tsx'], { 'src/App.tsx': APP });
    expect(waiting).toHaveLength(3);
    expect(fixHere).toHaveLength(0);
    expect(others).toHaveLength(0);
  });

  it('🔴 the report case through the dispatcher: ⏳ note unchanged, counted as waiting, not remembered as an error', async () => {
    const box = new SlowCompileSandbox(() => `${REPORT_147_4}\n`);
    const { d, ws } = dispatcherOn(box);
    const out = await write(d, 'src/App.tsx', APP);
    // The model's note is exactly the designed one (autopsy 2a7fa4b0) — nothing about it changes here.
    expect(out).toContain('⏳ TYPECHECK after this write: 3 error(s) in src/App.tsx are fixed in ANOTHER file');
    expect(out).toContain('Do NOT rewrite src/App.tsx');
    expect(out).not.toContain('⛔ TYPECHECK');
    const s = d.writeTypecheckStats();
    expect(s.ownErrorsSurfaced).toBe(0);
    expect(s.waitingErrorsSurfaced).toBe(3);
    const line = writeTypecheckSummary(s, true);
    expect(line).toContain('0 error(s) quoted back in the file just written, 3 waiting on files not written yet');
    // 🔁 REPOINTED, NOT DELETED (Q-1029). This pinned the word "expected", and that word was a claim the
    // count could not support: a designed wait and a MISTYPED import produce the same `Cannot find module`,
    // so calling every one of them expected reassured the reader about errors that would never resolve
    // themselves. The wait is what the next writes MAY add; a path proven wrong is counted on its own line
    // (tests/aMistypedImportIsNotADesignedWait.test.ts). What this test is really about — that a wait is
    // reported apart and never remembered as a compile error — is unchanged and still asserted here.
    expect(line).toContain('entry-first');
    expect(line).toContain('may add');
    expect(line, 'and no mistyped path in this fixture, so nothing is counted apart').not.toContain('mistyped import');
    // Workspace memory feeds the reviewer; a designed wait is not a compile error to remember.
    expect(getWorkspaceMemory(ws).openErrors().filter((e) => /^write-typecheck:/.test(String(e.text ?? '')))).toHaveLength(0);
  });

  it('an error that IS the file\'s own is still counted and remembered as before', async () => {
    const OWN = "src/App.tsx(7,60): error TS2322: Type 'string' is not assignable to type 'number'.";
    const box = new SlowCompileSandbox(() => `${REPORT_147_4}\n${OWN}\n`);
    const { d, ws } = dispatcherOn(box);
    const out = await write(d, 'src/App.tsx', APP);
    expect(out).toContain('⛔ TYPECHECK after this write: 1 error(s)');
    const s = d.writeTypecheckStats();
    expect(s.ownErrorsSurfaced).toBe(1);
    expect(s.waitingErrorsSurfaced).toBe(3);
    expect(getWorkspaceMemory(ws).openErrors().map((e) => String(e.text ?? '')))
      .toContain('write-typecheck: 1 error(s) in src/App.tsx');
  });

  it('the note and the counters use ONE split (a second test drifting from the note is the bug\'s shape)', () => {
    const wt = readFileSync(join(__dirname, '../src/server/AgentV3/writeTimeTypecheck.ts'), 'utf8');
    const note = wt.slice(wt.indexOf('export function writeTypecheckNote('), wt.indexOf('export class WriteTypecheckQueue'));
    expect(note).toContain('splitByRemedy(errors, written, sources)');
    expect(note).not.toContain('remedyFileFor(e, sources) !== null');
    expect(note).not.toContain('remedyFileFor(e, sources) === null');
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain('const { fixHere, waiting } = splitByRemedy(errors, tsPaths, sources);');
  });

  it('a build with no waits reads exactly as before', () => {
    const line = writeTypecheckSummary({ ...emptyWriteTypecheckStats(), runs: 3, cleanRuns: 2, ownErrorsSurfaced: 1, elapsedMs: 4500 }, true);
    expect(line).toContain('3 run(s), 2 clean, 1 error(s) quoted back in the file just written, 5s total');
    expect(line).not.toContain('waiting');
    // the pure note for the report case is the ⏳ one, as before
    expect(writeTypecheckNote(parseTscErrors(REPORT_147_4), ['src/App.tsx'], { 'src/App.tsx': APP })).toContain('fixed in ANOTHER file');
  });
});
