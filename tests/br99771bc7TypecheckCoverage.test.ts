import { describe, expect, it } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { emptyWriteTypecheckStats, writeTypecheckSummary } from '../src/server/AgentV3/writeTimeTypecheck';
import { getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { checksWholeDefaultTsProject } from '../src/server/AgentV3/tscCommandMode';

// Business Game, 99771bc7: two skipped writes, then explicit clean typechecks at +176s and +237s.
// The report nevertheless claimed no later compile and invented an end-of-build first compile.
class Project implements ActuatorPort {
  files = new Map([
    ['tsconfig.json', '{"compilerOptions":{"strict":true,"jsx":"react-jsx"}}'],
    ['src/App.tsx', 'export default function App() { return null; }'],
  ]);
  output = { exitCode: 0, stdout: '', stderr: '' };
  hold: (() => Promise<void>) | undefined;
  async readFile(_workspace: string, path: string) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async writeFile(_workspace: string, path: string, value: string) { this.files.set(path, value); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string) {
    if (/\btsc\b/.test(command)) { await this.hold?.(); return this.output; }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}
let seq = 0;
function fixture() {
  const act = new Project();
  const workspace = `br99771bc7-coverage-${++seq}`;
  const d = new ToolDispatcher(act, workspace);
  const mem = getWorkspaceMemory(workspace);
  const stats = Object.assign(emptyWriteTypecheckStats(), {
    runs: 2, cleanRuns: 1, waitingErrorsSurfaced: 1, elapsedMs: 3532,
    skipped: 2, skippedNotReady: 2, notReadyReasons: { 'install-running': 2 },
    cleanRunCoveredSkips: false,
  });
  d.shareWriteTypecheckStats(stats);
  return { act, d, stats, mem };
}
const call = (d: ToolDispatcher, name: string, input: Record<string, unknown> = {}) =>
  d.dispatch({ id: `coverage-${++seq}`, name, input }, 'architect');

describe('99771bc7: every observed whole-project compile can cover earlier skipped writes', () => {
  it('credits the real explicit typecheck tool without adding a write-time run', async () => {
    const { d, stats } = fixture();
    expect((await call(d, 'typecheck')).content).toContain('type-checks clean');
    expect(stats.cleanRunCoveredSkips).toBe(true);
    expect(stats.runs).toBe(2);
    expect(writeTypecheckSummary(stats, true)).toContain('those files were covered');
  });

  it('also reports explicit coverage when every write-time check stood down', async () => {
    const { d, stats } = fixture();
    stats.runs = 0; stats.cleanRuns = 0;
    await call(d, 'typecheck');
    expect(writeTypecheckSummary(stats, true)).toContain('never ran');
    expect(writeTypecheckSummary(stats, true)).toContain('those files were covered');
  });

  it('credits a sibling dispatcher into the parent shared stats', async () => {
    const { d, stats } = fixture();
    const child = new ToolDispatcher(new Project(), `br99771bc7-child-${++seq}`);
    child.shareWriteTypecheckStats(d.sharedWriteTypecheckStats());
    await call(child, 'typecheck');
    expect(d.writeTypecheckStats().cleanRunCoveredSkips).toBe(true);
    expect(stats.runs).toBe(2);
  });

  it.each([
    'src/App.tsx(1,1): error TS2304: Cannot find name x.',
    'NBAI_TSC_UNAVAILABLE: compiler not installed',
    'Version 5.8.3\nSyntax: tsc [options]',
    '[output truncated]',
  ])('never claims coverage from failed, unrun or incomplete output: %s', async (stdout) => {
    const { act, d, stats } = fixture();
    act.output.stdout = stdout;
    await call(d, 'typecheck');
    expect(stats.cleanRunCoveredSkips).toBe(false);
    expect(writeTypecheckSummary(stats, true)).not.toContain('their first compile');
  });

  it('a clean shell check of the default project covers skips', async () => {
    const { d, stats } = fixture();
    await call(d, 'bash', { command: 'tsc --noEmit' });
    expect(stats.cleanRunCoveredSkips).toBe(true);
  });

  it.each(['tsc --noEmit src/one.ts', 'tsc --noEmit -p other/tsconfig.json', 'tsc --noEmit --noCheck', 'tsc --noEmit | head -0'])('a narrower or opaque shell check does not cover the project: %s', async (command) => {
    const { d, stats, mem } = fixture();
    mem.recordError('typecheck: 1 TypeScript error(s).');
    await call(d, 'bash', { command });
    expect(stats.cleanRunCoveredSkips).toBe(false);
    expect(mem.verificationStatus()).not.toContain('checked CLEAN');
    expect(mem.openErrors()).toHaveLength(1);
  });

  it('a failed shell exit cannot turn silence into coverage', async () => {
    const { act, d, stats } = fixture();
    act.output.exitCode = 2;
    await call(d, 'bash', { command: 'tsc --noEmit' });
    expect(stats.cleanRunCoveredSkips).toBe(false);
  });

  it('a later skipped write invalidates earlier coverage', async () => {
    const { act, d, stats } = fixture();
    await call(d, 'typecheck');
    act.output.stdout = 'NBAI_WRITE_TSC_NOT_READY:install-running';
    await call(d, 'write_file', { path: 'src/later.ts', content: 'export const later = 1;' });
    expect(stats.skippedNotReady).toBe(3);
    expect(stats.cleanRunCoveredSkips).toBe(false);
  });

  it('a compile already in flight cannot cover a new sibling skip', async () => {
    const { act, d, stats } = fixture();
    let release!: () => void, started!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    act.hold = () => { started(); return held; };
    const check = call(d, 'typecheck');
    await inFlight;
    const siblingAct = new Project();
    siblingAct.output.stdout = 'NBAI_WRITE_TSC_NOT_READY:install-running';
    const sibling = new ToolDispatcher(siblingAct, `br99771bc7-concurrent-${++seq}`);
    sibling.shareWriteTypecheckStats(stats);
    await call(sibling, 'write_file', { path: 'src/newer.ts', content: 'export const newer = 1;' });
    release();
    await check;
    expect(stats.skippedNotReady).toBe(3);
    expect(stats.cleanRunCoveredSkips).toBe(false);
    act.hold = undefined;
    await call(d, 'typecheck');
    expect(stats.cleanRunCoveredSkips).toBe(true);
  });
});

describe('whole-project shell scope is a positive, bounded proof', () => {
  it.each(['tsc --noEmit', 'npx --no-install tsc --noEmit', 'node_modules/.bin/tsc --noEmit --incremental', 'tsc --noEmit 2>&1'])('accepts %s', command => {
    expect(checksWholeDefaultTsProject(command)).toBe(true);
  });
  it.each(['tsc --noEmit src/one.ts', 'tsc -p other.json', 'tsc -b', 'tsc --showConfig', 'tsc --watch', 'tsc @args', 'cd child && tsc --noEmit', 'echo tsc --noEmit', 'tsc --noEmit | head -0', 'tsc --noEmit || true', 'tsc "$FLAGS"'])('abstains from %s', command => {
    expect(checksWholeDefaultTsProject(command)).toBe(false);
  });
});
