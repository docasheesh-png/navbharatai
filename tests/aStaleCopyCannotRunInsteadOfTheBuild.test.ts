// AUTOPSY e725e002 (2026-09-29): the reviewer's listing held `src/context/AuthContext.tsx` AND
// `src/context/AuthContext.js`, and the same for every module the build wrote. The `.js` copies came from
// an earlier, never-saved attempt left in a resumed sandbox (durable store: 0 files; sandbox: warm). Every
// import is extensionless and Vite tries `.js` before `.tsx`, so the OLD copy ran and the new file was dead.
// These lock the write-door removal (shadowTwin.ts) and the edit_file door for the design kit.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { shadowingTwins, shadowTwinEnabled, removablePath, shadowTwinToolNote, RESOLUTION_ORDER } from '../src/server/AgentV3/shadowTwin';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('shadowingTwins — only an earlier-resolving, un-authored copy of the same module', () => {
  const none = new Set<string>();

  it('the e725e002 case: a stale .js beside the .tsx the build wrote', () => {
    const tree = ['src/context/AuthContext.tsx', 'src/context/AuthContext.js', 'src/context/CartContext.js'];
    expect(shadowingTwins('src/context/AuthContext.tsx', tree, new Set(['src/context/AuthContext.tsx']))).toEqual(['src/context/AuthContext.js']);
  });

  it('follows Vite\'s own order: .ts beside .tsx shadows it; .tsx beside .ts does not', () => {
    expect(RESOLUTION_ORDER.indexOf('.js')).toBeLessThan(RESOLUTION_ORDER.indexOf('.tsx'));
    expect(shadowingTwins('src/a.tsx', ['src/a.ts'], none)).toEqual(['src/a.ts']);
    expect(shadowingTwins('src/a.ts', ['src/a.tsx'], none)).toEqual([]);
    expect(shadowingTwins('src/a.jsx', ['src/a.js', 'src/a.mjs'], none)).toEqual(['src/a.js', 'src/a.mjs']);
  });

  it('never touches a twin this build wrote itself', () => {
    expect(shadowingTwins('src/a.tsx', ['src/a.js'], new Set(['src/a.js']))).toEqual([]);
  });

  it('unknown authorship means KEEP', () => {
    expect(shadowingTwins('src/a.tsx', ['src/a.js'], undefined)).toEqual([]);
  });

  it('a declaration file is never a twin, in either direction', () => {
    expect(shadowingTwins('src/lib.ts', ['src/lib.d.ts'], none)).toEqual([]);
    expect(shadowingTwins('src/lib.d.ts', ['src/lib.js'], none)).toEqual([]);
  });

  it('a different stem, a different directory, a non-module, or a pruned path is left alone', () => {
    expect(shadowingTwins('src/a.tsx', ['src/ab.js', 'lib/a.js', 'src/a.css', 'src/a.json'], none)).toEqual([]);
    expect(shadowingTwins('node_modules/x/a.tsx', ['node_modules/x/a.js'], none)).toEqual([]);
    expect(shadowingTwins('src/a.css', ['src/a.js'], none)).toEqual([]);
  });

  it('config files follow the same rule — a stale vite.config.js is loaded before vite.config.ts', () => {
    expect(shadowingTwins('vite.config.ts', ['vite.config.js'], none)).toEqual(['vite.config.js']);
  });

  it('only a quotable relative path is ever handed to rm', () => {
    expect(removablePath('src/context/AuthContext.js')).toBe(true);
    expect(removablePath("src/a'.js")).toBe(false);
    expect(removablePath('../outside.js')).toBe(false);
    expect(removablePath('/etc/passwd.js')).toBe(false);
  });

  it('kill switch AGENTV3_SHADOW_TWIN=off', () => {
    expect(shadowTwinEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(shadowTwinEnabled({ AGENTV3_SHADOW_TWIN: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('the model is told what went and why, so it does not recreate it', () => {
    const note = shadowTwinToolNote('src/a.tsx', ['src/a.js']);
    expect(note).toMatch(/REMOVED STALE COPY: src\/a\.js/);
    expect(note).toMatch(/Do not recreate it/);
    expect(shadowTwinToolNote('src/a.tsx', [])).toBe('');
  });
});

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  listed = 0;
  async readFile(_ws: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_ws: string, p: string, content: string): Promise<void> { this.files.set(p, content); }
  async listFiles(): Promise<string[]> { this.listed++; return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) {
    if (cmd.startsWith('rm -f ')) for (const m of cmd.matchAll(/'([^']+)'/g)) this.files.delete(m[1]);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });
const MODULE = 'export const x = 1;\n';

describe('the write door — the stale copy goes, the build\'s file stays', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  let authored: Set<string>;
  beforeEach(() => {
    act = new FakeActuator();
    act.files.set('src/context/AuthContext.js', 'export const OLD = true;\n');
    act.files.set('src/utils/format.js', 'export const OLD = true;\n');
    const stream = new AgentEventStream();
    authored = new Set();
    d = new ToolDispatcher(act, 'ws-twin', new WorkspaceState(stream), stream,
      undefined, undefined, undefined, undefined, undefined, undefined, (p) => { authored.add(p); });
    d.armShadowTwins(() => authored);
  });

  it('write_file removes the twin and tells the model', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/context/AuthContext.tsx', content: MODULE }), 'architect');
    expect(act.files.has('src/context/AuthContext.js')).toBe(false);
    expect(act.files.get('src/context/AuthContext.tsx')).toBe(MODULE);
    expect(res.content).toMatch(/REMOVED STALE COPY/);
    expect(d.shadowTwinTally().removed).toEqual(['src/context/AuthContext.js']);
  });

  it('write_files_batch: every twin, one sandbox listing', async () => {
    await d.dispatch(call('write_files_batch', { files: [
      { path: 'src/context/AuthContext.tsx', content: MODULE },
      { path: 'src/utils/format.ts', content: MODULE },
    ] }), 'frontend');
    expect(act.files.has('src/context/AuthContext.js')).toBe(false);
    expect(act.files.has('src/utils/format.js')).toBe(false);
    expect(act.listed).toBe(1);
  });

  it('a twin this build wrote is its own decision and stays', async () => {
    await d.dispatch(call('write_file', { path: 'src/new.js', content: MODULE }), 'architect');
    await d.dispatch(call('write_file', { path: 'src/new.tsx', content: MODULE }), 'architect');
    expect(act.files.has('src/new.js')).toBe(true);
  });

  it('unarmed (no authorship known) removes nothing', async () => {
    const stream = new AgentEventStream();
    const bare = new ToolDispatcher(act, 'ws-twin', new WorkspaceState(stream), stream);
    await bare.dispatch(call('write_file', { path: 'src/context/AuthContext.tsx', content: MODULE }), 'architect');
    expect(act.files.has('src/context/AuthContext.js')).toBe(true);
  });

  it('a sub-agent shares the parent\'s armed guard and tally', () => {
    const stream = new AgentEventStream();
    const child = new ToolDispatcher(act, 'ws-twin', new WorkspaceState(stream), stream);
    child.shareShadowTwins(d.sharedShadowTwins());
    expect(child.shadowTwinTally()).toBe(d.shadowTwinTally());
  });
});

describe('edit_file — the door the write-door kit guard left open', () => {
  it('an edit that cuts kit rules out of the stylesheet keeps them', async () => {
    const act = new FakeActuator();
    act.files.set('src/index.css', DESIGN_KIT_CSS);
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-edit-kit', new WorkspaceState(stream), stream);
    const emptyRule = DESIGN_KIT_CSS.match(/\.nb-empty \{[^}]*\}/)![0];
    const res = await d.dispatch(call('edit_file', { path: 'src/index.css', old_string: emptyRule, new_string: '/* removed */' }), 'architect');
    expect(act.files.get('src/index.css')!).toMatch(/\.nb-empty \{/);
    expect(res.content).toMatch(/DESIGN KIT KEPT/);
    expect(d.kitKeptTally().writes).toBe(1);
  });
});

describe('the wiring', () => {
  const ROUTE = read('src/server/routes/agentv3.ts');
  it('the route arms the guard with what this build wrote, and shares it with sub-agents', () => {
    expect(ROUTE).toMatch(/dispatcher\.armShadowTwins\(\(\) => modelAuthoredPaths\(writtenFiles\)\)/);
    expect(ROUTE).toMatch(/shadowTwins: \(\) => dispatcherForSubAgents\?\.sharedShadowTwins\(\)/);
    expect(read('src/server/AgentV3/SubAgent.ts')).toMatch(/childDispatcher\.shareShadowTwins\(sharedTwins\)/);
  });
  it('the durable store forgets the removed copies, and the report says so', () => {
    expect(ROUTE).toMatch(/await removeWorkspaceFiles\(workspaceId, twins\)/);
    expect(ROUTE).toMatch(/code: 'SHADOW_TWIN_REMOVED'/);
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toMatch(/'SHADOW_TWIN_REMOVED'/);
    expect(read('src/server/AgentV3/buildFindingSuggestions.ts')).toMatch(/'SHADOW_TWIN_REMOVED'/);
  });
});
