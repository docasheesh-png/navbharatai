import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { getWorkspaceMemory, _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { orphanComponentFile } from '../src/server/AgentV3/ArchitectureAnalysis';
import { deletionCandidates, deletionReconciledMessage } from '../src/server/AgentV3/fileDeletion';
import { assessReadiness, MIN_READY_SCORE } from '../src/server/AgentV3/Readiness';
import type { ArchitectureReport } from '../src/server/AgentV3/ArchitectureAnalysis';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

/**
 * 🔴 THE REPORT (build 8b3dca5c, 2026-09-17 — a JEE mock-test app, free Weak engine, 15.3 minutes).
 *
 * The prompt was the two words `npm install`. The fast lane is handed that string and nothing else,
 * so it planned a generic Counter / TaskList / ThemeToggle demo, wrote ten files, failed its own
 * typecheck and handed off. The full builder — which had the conversation — then built the real JEE
 * app on top of the debris.
 *
 *   t+788s   $ rm src/components/Counter.tsx                                  → exit 0
 *   t+909s   READINESS_BLOCKER — readiness score 38/100 is below the 50/100 bar
 *            (9 component(s) created but never used: src/components/Counter.tsx (Counter), …)
 *   t+915s   PROD_BUILD_OK · ACCESSIBILITY 100/100 · preview rendered in a real browser
 *   t+917s   RELEASE_GATE: RED → OUTCOME_RELEASE_GATE_RED → "You have NOT been charged"
 *
 * The arithmetic is exact: 100 − 9×6 (orphan components) − 8 (no tests) = 38.
 *
 * TWO defects put those nine there:
 *   1. the first of them had been DELETED by the build itself, 121 seconds earlier, and nothing in
 *      AgentV3 has ever removed a file from the project map;
 *   2. several of the rest belong to an EARLIER build in the same workspace, and the SCORE — unlike
 *      the blocker list PR #2997 scoped — still priced the whole workspace.
 */

// ── The pure half ───────────────────────────────────────────────────────────────────────────────

describe('deletionCandidates — a command must have SUCCEEDED before the map forgets anything', () => {
  it('🔴 the real command: exit 0 yields the target', () => {
    expect(deletionCandidates(['src/components/Counter.tsx'], 0)).toEqual(['src/components/Counter.tsx']);
  });

  it('a non-zero exit proves nothing about the disk, so nothing is dropped', () => {
    expect(deletionCandidates(['src/components/Counter.tsx'], 1)).toEqual([]);
    expect(deletionCandidates(['src/components/Counter.tsx'], 127)).toEqual([]);
  });

  it('an UNKNOWN exit code is not a success', () => {
    expect(deletionCandidates(['a.tsx'], null)).toEqual([]);
    expect(deletionCandidates(['a.tsx'], undefined)).toEqual([]);
  });

  it('paths are spelled the one way the project map spells them', () => {
    expect(deletionCandidates(['./src/a.tsx', '/src/b.tsx', 'src//c.tsx'], 0))
      .toEqual(['src/a.tsx', 'src/b.tsx', 'src/c.tsx']);
  });

  it('the same file named twice is one file', () => {
    expect(deletionCandidates(['src/a.tsx', './src/a.tsx'], 0)).toEqual(['src/a.tsx']);
  });

  it('a directory or a bare dot is never a single source file', () => {
    expect(deletionCandidates(['src/components/', '.', '..', ''], 0)).toEqual([]);
  });

  it('never throws on junk', () => {
    expect(deletionCandidates(null, 0)).toEqual([]);
    expect(deletionCandidates(undefined, 0)).toEqual([]);
    expect(deletionCandidates([undefined as unknown as string, 1 as unknown as string], 0)).toEqual([]);
  });

  it('the report line names the files, and says how many it did not name', () => {
    const msg = deletionReconciledMessage(['a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx', 'f.tsx', 'g.tsx']);
    expect(msg).toContain('7 file(s)');
    expect(msg).toContain('a.tsx');
    expect(msg).toContain('+2 more');
  });
});

describe('orphanComponentFile — parsed beside the only place the format is produced', () => {
  it("🔴 the real entry from the report", () => {
    expect(orphanComponentFile('src/components/Counter.tsx (Counter)')).toBe('src/components/Counter.tsx');
  });

  it('a Next.js route group keeps its own parentheses', () => {
    expect(orphanComponentFile('src/app/(auth)/page.tsx (LoginPage)')).toBe('src/app/(auth)/page.tsx');
  });

  it('an entry in some other shape is returned whole, so it can never be mis-attributed to ""', () => {
    expect(orphanComponentFile('src/components/Counter.tsx')).toBe('src/components/Counter.tsx');
  });

  it('never throws on junk', () => {
    expect(orphanComponentFile(null)).toBe('');
    expect(orphanComponentFile(undefined)).toBe('');
    expect(orphanComponentFile('')).toBe('');
  });
});

// ── The score ───────────────────────────────────────────────────────────────────────────────────

function archWith(orphans: string[]): ArchitectureReport {
  return {
    files: [], unresolvedImports: [], nodeBuiltinsInFrontend: [], cycles: [],
    layeringViolations: [], orphanComponents: orphans, entryPoints: [],
  } as unknown as ArchitectureReport;
}
const NINE = [
  'src/components/Counter.tsx (Counter)', 'src/components/FilterBar.tsx (FilterBar)',
  'src/components/Header.tsx (Header)', 'src/components/TaskList.tsx (TaskList)',
  'src/components/ThemeToggle.tsx (ThemeToggle)', 'src/components/QuestionForm.tsx (QuestionForm)',
  'src/components/QuestionList.tsx (QuestionList)', 'src/components/SectionHeader.tsx (SectionHeader)',
  'src/components/StatusBadge.tsx (StatusBadge)',
];
const NO_TESTS = { severity: 'medium' as const, label: 'No tests at all' };

describe('the readiness score, reproduced from the real report', () => {
  it('🔴 nine orphans plus "No tests at all" is exactly 38/100, and 38 is a blocker', () => {
    const r = assessReadiness(archWith(NINE), [], [NO_TESTS]);
    expect(r.score).toBe(38);
    expect(r.score).toBeLessThan(MIN_READY_SCORE);
    expect(r.blockers.join(' ')).toContain('below the 50/100 bar');
  });

  it('🔒 counting only the four this build wrote clears the bar — and nothing else changed', () => {
    const ours = NINE.slice(0, 4);
    const r = assessReadiness(archWith(ours), [], [NO_TESTS]);
    expect(r.score).toBe(68);
    expect(r.blockers).toEqual([]);
  });

  it('the pre-existing ones are still LISTED, at zero cost — recorded, never priced', () => {
    const ours = NINE.slice(0, 4);
    const observed = {
      severity: 'observation' as const,
      label: '[observation about your existing code — this build did not change these files] 5 component(s) created but never used: …',
    };
    const withObs = assessReadiness(archWith(ours), [], [NO_TESTS, observed]);
    expect(withObs.score).toBe(68); // identical to the run without it
    expect(withObs.warnings.join(' ')).toContain('this build did not change these files');
    // …and the score-floor blocker never cites a finding it did not charge for.
    expect(assessReadiness(archWith(NINE), [], [NO_TESTS, observed]).blockers.join(' '))
      .not.toContain('did not change these files');
  });

  it('honouring the one deleted file is real but NOT sufficient on its own — stated, not implied', () => {
    // 8 orphans instead of 9 is 44/100. Still under the bar. Both halves were needed.
    expect(assessReadiness(archWith(NINE.slice(1)), [], [NO_TESTS]).score).toBe(44);
  });
});

// ── The behaviour, end to end through the dispatcher ────────────────────────────────────────────

class RmActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['src/components/Counter.tsx', 'export function Counter() { return null; }'],
    ['src/components/Exam.tsx', 'export function Exam() { return null; }'],
  ]);
  /** Set true to make `rm` exit 0 while deleting nothing — the `rm x || true` case. */
  pretendOnly = false;
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    const m = /^rm\s+(\S+)/.exec(command.trim());
    if (m && !this.pretendOnly) this.files.delete(m[1]);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function harness(act: ActuatorPort, ws: string) {
  const deleted: string[] = [];
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, ws, new WorkspaceState(stream), stream);
  d.setFileDeletionSink((paths) => deleted.push(...paths));
  return { d, deleted };
}
const bash = (command: string): ToolUse => ({ id: 'b1', name: 'bash', input: { command } });

describe('a file the build deletes leaves the project map', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('🔴 the real command — `rm src/components/Counter.tsx` — drops it from the graph and tells the route', async () => {
    const ws = 'ws-rm-1';
    const act = new RmActuator();
    getWorkspaceMemory(ws).indexFile('src/components/Counter.tsx', act.files.get('src/components/Counter.tsx')!);
    getWorkspaceMemory(ws).indexFile('src/components/Exam.tsx', act.files.get('src/components/Exam.tsx')!);
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/components/Counter.tsx');

    const { d, deleted } = harness(act, ws);
    await d.run(bash('rm src/components/Counter.tsx'), 'architect');

    expect(deleted).toEqual(['src/components/Counter.tsx']);
    expect(getWorkspaceMemory(ws).knownFilePaths()).not.toContain('src/components/Counter.tsx');
    // The file that was NOT deleted is untouched — this narrows the map, it does not empty it.
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/components/Exam.tsx');
  });

  it('🔒 exit 0 is not enough — the sandbox must confirm the file is really gone (`rm x || true`)', async () => {
    const ws = 'ws-rm-2';
    const act = new RmActuator();
    act.pretendOnly = true;
    getWorkspaceMemory(ws).indexFile('src/components/Counter.tsx', 'export function Counter() {}');

    const { d, deleted } = harness(act, ws);
    await d.run(bash('rm src/components/Counter.tsx'), 'architect');

    expect(deleted).toEqual([]);
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/components/Counter.tsx');
  });

  it('🔒 a delete the guard REFUSED never reaches the map — the command did not run at all', async () => {
    const ws = 'ws-rm-3';
    const act = new RmActuator();
    const mem = getWorkspaceMemory(ws);
    mem.indexFile('src/components/Counter.tsx', 'export function Counter() { return null; }');
    // App.tsx still imports it, so the still-imported-file guard refuses the delete.
    mem.indexFile('src/App.tsx', "import Counter from './components/Counter';\nexport default function App() { return <Counter/>; }");

    const { d, deleted } = harness(act, ws);
    const out = await d.run(bash('rm src/components/Counter.tsx'), 'architect');

    expect(String(out)).toContain('GOVERNANCE BLOCKED');
    expect(deleted).toEqual([]);
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/components/Counter.tsx');
    expect(act.files.has('src/components/Counter.tsx')).toBe(true);
  });

  it('an ordinary command touches nothing — this costs a normal build no round trips', async () => {
    const ws = 'ws-rm-4';
    const act = new RmActuator();
    getWorkspaceMemory(ws).indexFile('src/components/Counter.tsx', 'export function Counter() {}');

    const { d, deleted } = harness(act, ws);
    await d.run(bash('npm install'), 'architect');

    expect(deleted).toEqual([]);
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/components/Counter.tsx');
  });
});

/**
 * The score scoping, end to end through the REAL `evaluate` scan — same tree, same analysers, the
 * only difference being whether the gate was told what this build wrote. Asserted as a DIFFERENCE
 * rather than an absolute, because `evaluate` runs ~30 dimensions and pinning a whole-scan number
 * would make this test break on any of them.
 */
class OrphanProjectActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['package.json', '{"name":"jee","dependencies":{}}'],
    ['index.html', '<!doctype html><html><head><title>JEE</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'],
    ['src/main.tsx', "import App from './App';\nexport default App;"],
    ['src/App.tsx', "import Exam from './components/Exam';\nexport default function App() { return <Exam/>; }"],
    ['src/components/Exam.tsx', 'export default function Exam() { return null; }'],
    // Ours, this build — a genuine defect we are answerable for.
    ['src/components/Counter.tsx', 'export default function Counter() { return null; }'],
    // An earlier build's leftovers, in the same workspace.
    ['src/components/FilterBar.tsx', 'export default function FilterBar() { return null; }'],
    ['src/components/Header.tsx', 'export default function Header() { return null; }'],
    ['src/components/StatusBadge.tsx', 'export default function StatusBadge() { return null; }'],
  ]);
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

describe('🔴 end to end: the gate stops pricing orphans in code this build never wrote', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  async function readinessFor(ws: string, authored?: string[]) {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new OrphanProjectActuator(), ws, new WorkspaceState(stream), stream);
    if (authored) d.setAuthoredFiles(() => authored);
    return d.assessBuildReadiness();
  }

  it('the unscoped scan prices every orphan in the workspace', async () => {
    const r = await readinessFor('ws-eval-all');
    const orphanLine = r.warnings.find((w) => w.includes('created but never used'));
    expect(orphanLine, 'the scan must find the orphans at all').toBeTruthy();
    expect(orphanLine).toContain('4 component(s)');
  });

  it('🔒 told what it wrote, it prices ONE and records the other three at zero cost', async () => {
    const r = await readinessFor('ws-eval-ours', ['src/components/Counter.tsx', 'src/App.tsx']);
    const priced = r.warnings.find((w) => w.includes('created but never used') && !w.includes('did not change'));
    const observed = r.warnings.find((w) => w.includes('did not change these files'));
    expect(priced).toContain('1 component(s)');
    expect(observed, 'the pre-existing ones are still LISTED, never hidden').toContain('3 component(s)');
  });

  it('🔒 and that is worth exactly the three orphans it stopped charging for — 18 points', async () => {
    const all = await readinessFor('ws-eval-a', undefined);
    const ours = await readinessFor('ws-eval-b', ['src/components/Counter.tsx', 'src/App.tsx']);
    expect(ours.score - all.score).toBe(18);
  });
});

/**
 * 🔒 REVERSION GUARDS — the wiring is the half that rots silently, and `removeFile()` sitting
 * unused for the whole life of this repo is the proof. The behavioural tests above cannot see the
 * route, and the score scoping lives inside a 4,000-line `evaluate` case.
 */
describe('the wiring — proven by reversion', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('the route forgets a deleted path it had claimed to write', () => {
    const route = src('../src/server/routes/agentv3.ts');
    expect(route).toContain('dispatcher.setFileDeletionSink(');
    expect(route).toContain('writtenFiles.delete(p)');
  });

  it('the readiness SCORE is handed the authorship-scoped report, not the whole workspace', () => {
    const disp = src('../src/server/AgentV3/ToolDispatcher.ts');
    expect(disp).toContain('assessReadiness(scoredArch, findings, extra)');
    expect(disp).toContain('archReport.orphanComponents.map((label) => ({ file: orphanComponentFile(label), label }))');
  });

  it('`removeFile` finally has a caller', () => {
    expect(src('../src/server/AgentV3/ToolDispatcher.ts')).toContain('.removeFile(path)');
  });
});
