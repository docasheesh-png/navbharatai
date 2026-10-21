// Autopsy 1d3ff0d5 (2026-10-21): a sub-agent rewrote 17 screens with a `for f in …; do sed -i … "$f"; done` and a
// `node -e` script writing `fs.writeFileSync(f, s)`. The static parser cannot name a run-time path, so none of the 17
// reached the captured writes: the saved project kept the OLD files while the sandbox (and every browser check)
// ran the new ones — SAVED_SOURCE_DIVERGES. CLASS: the ledger relied on a precision-first parser built for the
// freeze. The ledger now asks the sandbox which files a write-capable command changed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { shellMayWriteOpaquely, parseChangedFiles, changedFilesCommand, SHELL_MARK } from '../src/server/AgentV3/shellWriteReconcile';
import { shellReadBackTargets } from '../src/server/AgentV3/shellWriteTargets';

// The two commands of the real report (shortened file lists, same syntax).
const LOOP = `for f in src/components/Shell.tsx src/components/BottomNav.tsx src/screens/FeesScreen.tsx; do sed -i "s|import type { AppContextType } from '../App';|import type { AppContextType } from '../AppContext';|" "$f"; done`;
const NODE = `node -e "
const fs=require('fs');
const files=['src/components/Header.tsx','src/screens/FeesScreen.tsx'];
for (const f of files) { let s=fs.readFileSync(f,'utf8'); s=s.replace(/ctx: AppContextType/g,''); fs.writeFileSync(f,s); }
console.log('done');
"`;

class Act implements ActuatorPort {
  files = new Map<string, string>();
  changed: string[] = [];
  commands: string[] = [];
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_w: string, cmd: string) {
    this.commands.push(cmd);
    if (cmd.startsWith('find . -type f -newer')) return { exitCode: 0, stdout: this.changed.map((p) => `./${p}`).join('\n'), stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_w: string, port: number) { return `https://x-${port}.dev`; }
}
const run = async (act: Act, command: string) => {
  const recorded = new Map<string, string>();
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, 'ws-reconcile', new WorkspaceState(stream), stream, undefined, undefined, undefined, undefined, undefined, undefined, (p, c) => { recorded.set(p, c); });
  await d.dispatch({ id: 't', name: 'bash', input: { command } }, 'architect');
  return recorded;
};

describe('the static parser alone cannot see these writes (the failure this pins)', () => {
  it('neither real command names a single file the ledger could read back', () => {
    expect(shellReadBackTargets(LOOP)).toEqual([]);
    expect(shellReadBackTargets(NODE)).toEqual([]);
  });
});

describe('a write-capable command is reconciled against what the sandbox says changed', () => {
  it('the loop of `sed -i "$f"`: the changed files are read back and recorded with what the sandbox now holds', async () => {
    const act = new Act();
    for (const p of ['src/components/Shell.tsx', 'src/components/BottomNav.tsx', 'src/screens/FeesScreen.tsx']) act.files.set(p, `NEW ${p}`);
    act.changed = ['src/components/Shell.tsx', 'src/components/BottomNav.tsx', 'src/screens/FeesScreen.tsx'];
    const recorded = await run(act, LOOP);
    expect([...recorded.keys()].sort()).toEqual(act.changed.slice().sort());
    expect(recorded.get('src/screens/FeesScreen.tsx')).toBe('NEW src/screens/FeesScreen.tsx');
  });
  it('the `node -e` script with a run-time path is recorded too', async () => {
    const act = new Act();
    act.files.set('src/components/Header.tsx', 'H2'); act.files.set('src/screens/FeesScreen.tsx', 'F2');
    act.changed = ['src/components/Header.tsx', 'src/screens/FeesScreen.tsx'];
    const recorded = await run(act, NODE);
    expect(recorded.get('src/components/Header.tsx')).toBe('H2');
    expect(recorded.get('src/screens/FeesScreen.tsx')).toBe('F2');
  });
  it('the marker is set BEFORE the command and the listing runs AFTER it', async () => {
    const act = new Act();
    await run(act, NODE);
    const mark = act.commands.findIndex((c) => c === `touch ${SHELL_MARK}`);
    const list = act.commands.findIndex((c) => c.startsWith('find . -type f -newer'));
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThan(mark);
  });
  it('a read-only or plain command costs no extra round trip', async () => {
    const act = new Act();
    await run(act, 'grep -n "x" src/App.tsx');
    await run(act, 'npm run build');
    expect(act.commands.some((c) => c.startsWith('touch ') || c.startsWith('find . -type f -newer'))).toBe(false);
  });
});

describe('helpers', () => {
  it('which commands count as write-capable', () => {
    for (const c of [LOOP, NODE, "python3 -c \"open(p,'w').write(x)\"", 'ls | xargs sed -i s/a/b/', "echo hi | tee $OUT"]) expect(shellMayWriteOpaquely(c), c).toBe(true);
    for (const c of ['npm install', 'npm run build', 'ls -la', 'cat src/App.tsx', 'git status', 'grep -rn foo src']) expect(shellMayWriteOpaquely(c), c).toBe(false);
  });
  it('the listing keeps plain relative source paths only, once each, and never what the parser already named', () => {
    const out = parseChangedFiles(['./src/a.tsx', './src/a.tsx', './logo.png', '../etc/passwd', '/abs.ts', './src/b.css', './src/c.ts'].join('\n'), ['src/c.ts']);
    expect(out).toEqual(['src/a.tsx', 'src/b.css']);
  });
  it('the listing stays out of dependencies, hidden folders, lockfiles and logs', () => {
    const c = changedFilesCommand();
    for (const needle of ["*/node_modules/*", "'*/.*'", 'package-lock.json', '*.log']) expect(c).toContain(needle);
  });
  it('the wiring: the dispatcher marks before and reconciles after', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toMatch(/shellMayWriteOpaquely\(command\)/);
    expect(src).toMatch(/if \(reconcileMarked\) await this\.reconcileShellWrites\(effectiveCommand\)/);
  });
});
