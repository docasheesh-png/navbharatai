// AUTOPSY 6a5fb04b (2026-09-30) — Software Project Mode's first real run.
//
// Module 1 of a 12-module plan ("App Configuration") wrote its three files and typechecked, and was
// marked FAILED. The planner orders modules by dependency, so the app shell — the only module that
// writes src/App.tsx — comes LAST, and every earlier module leaves our starter page in place by design.
// But each module turn was judged as a whole app: the readiness gate's "entry is still the starter"
// blocker failed it, two resume nudges pushed the model outside its module, the platform started a
// preview and saw "Hello World", and the user read "Nothing has been built yet". By construction, a plan
// whose first module does not own the entry failed at module 1.
//
// These lock the fix: a module turn knows which module assembles the app, and until that module is
// built it is judged on its own files and the typecheck.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parsePlannedModules, createProjectPlan, markModuleStatus, moduleBuildContext,
  moduleOwnsEntry, shellModuleFor, retireUnbuiltPlan, APP_ENTRY_FILES, projectPlanSystemPrompt,
} from '../src/server/AgentV3/ProjectPlan';
import { shouldAttemptPlatformPreview } from '../src/server/AgentV3/deliveryProof';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { STARTER_ENTRY_CONTENT, isStarterBlocker } from '../src/server/AgentV3/stillTheStarterApp';
import type { ReadinessReport } from '../src/server/AgentV3/Readiness';

const read = (p: string) => readFileSync(p, 'utf8');

/** The shape of the report's plan: config first, the shell (which owns src/App.tsx) last. */
const PLAN_JSON = JSON.stringify([
  { id: 'config', name: 'App Configuration', description: 'constants', dependsOn: [], files: ['src/config/constants.ts', 'src/config/languages.ts', 'src/config/settings-defaults.ts'], contracts: 'export const DEFAULT_SETTINGS: Settings;' },
  { id: 'types', name: 'Core Type Definitions', description: 'types', dependsOn: ['config'], files: ['src/types/index.ts'], contracts: 'export type MessageRole = string;' },
  { id: 'voice', name: 'Voice Interaction Service', description: 'speech', dependsOn: ['types'], files: ['src/services/voice.ts'], contracts: 'export function listen(): void;' },
  { id: 'shell', name: 'App Shell & Router', description: 'mounts every screen', dependsOn: ['voice'], files: ['src/App.tsx', 'src/components/Layout.tsx'], contracts: 'export default function App(): JSX.Element;' },
]);
const plan = () => createProjectPlan('Mohakor Voice AI', 'vite-react', parsePlannedModules(PLAN_JSON), 1);

describe('which module assembles the app', () => {
  it('only a module that lists an app entry file owns the entry', () => {
    const p = plan();
    expect(p.modules.map(moduleOwnsEntry)).toEqual([false, false, false, true]);
    expect(APP_ENTRY_FILES).toContain('src/App.tsx');
    expect(moduleOwnsEntry({ files: ['./src/App.tsx'] })).toBe(true);
  });

  it('the report\'s config module waits for the shell; the shell itself is judged as the app', () => {
    const p = plan();
    expect(shellModuleFor(p, p.modules[0])?.name).toBe('App Shell & Router');
    expect(shellModuleFor(p, p.modules[3])).toBeNull();
  });

  it('when no module owns the entry, nothing changes — every turn is judged as an app, as before', () => {
    const noShell = createProjectPlan('x', 'vite-react', parsePlannedModules(JSON.stringify([
      { id: 'a', name: 'A', description: 'a', dependsOn: [], files: ['src/a.ts'], contracts: '' },
      { id: 'b', name: 'B', description: 'b', dependsOn: ['a'], files: ['src/b.ts'], contracts: '' },
    ])), 1);
    expect(shellModuleFor(noShell, noShell.modules[0])).toBeNull();
  });

  it('once the shell is done, later modules are judged as the app again', () => {
    const p = markModuleStatus(plan(), 'shell', 'done');
    expect(shellModuleFor(p, p.modules[2])).toBeNull();
  });
});

describe('the module turn is told what "finished" means for it', () => {
  it('a module before the shell is told not to touch the entry or publish a preview', () => {
    const p = plan();
    const ctx = moduleBuildContext(p, p.modules[0]);
    expect(ctx).toContain('assembled into screens by the "App Shell & Router" module');
    expect(ctx).toContain('do NOT edit src/App.tsx');
    expect(ctx).toContain('finished when its files exist and the project typechecks');
  });

  it('the shell module is not given that rule', () => {
    const p = plan();
    expect(moduleBuildContext(p, p.modules[3])).not.toContain('assembled into screens by');
  });

  it('the planner is told that exactly one module — the shell, last — owns the entry', () => {
    expect(projectPlanSystemPrompt('vite-react')).toContain('Exactly ONE module — the app shell, last — lists the app entry (src/App.tsx)');
  });
});

describe('the gates that failed module 1 stand down for it', () => {
  class Act implements ActuatorPort {
    files = new Map<string, string>([
      ['src/App.tsx', STARTER_ENTRY_CONTENT],
      ['index.html', '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'],
    ]);
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  const clean: ReadinessReport = { score: 100, ready: true, blockers: [], warnings: [], tier: 'enterprise' } as ReadinessReport;
  const block = (d: ToolDispatcher) => (d as unknown as { _blockIfStillTheStarterApp(r: ReadinessReport): Promise<ReadinessReport> })._blockIfStillTheStarterApp(clean);

  it('the starter blocker still fires on an ordinary build (nothing regressed)', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-mod', new WorkspaceState(stream), stream);
    const r = await block(d);
    expect(r.ready).toBe(false);
    expect(r.blockers.some(isStarterBlocker)).toBe(true);
  });

  it('…and stands down for a module whose shell comes later', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-mod', new WorkspaceState(stream), stream);
    d.setStarterExpected(true);
    const r = await block(d);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('the platform does not start a preview for a module that has no app to show yet', () => {
    const base = { expectsArtifacts: true, hasPreviewUrl: false, aborted: false, isImportTurn: false, appFiles: 12, hasPackageJson: true, remainingMs: null, env: {} as NodeJS.ProcessEnv };
    expect(shouldAttemptPlatformPreview(base).attempt).toBe(true);
    const r = shouldAttemptPlatformPreview({ ...base, awaitingShell: 'App Shell & Router' });
    expect(r.attempt).toBe(false);
    expect(r.reason).toContain('"App Shell & Router"');
  });
});

describe('a paused plan that built nothing is retired once the app exists another way', () => {
  it('0 done (even with a failed module) ⇒ retirable; any done module ⇒ never', () => {
    const p = markModuleStatus(plan(), 'config', 'failed', 'x');
    expect(retireUnbuiltPlan(p)).toBe(true);
    expect(retireUnbuiltPlan(markModuleStatus(p, 'types', 'done'))).toBe(false);
  });
});

describe('the wiring', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('the route marks the turn, arms the dispatcher and records why', () => {
    expect(route).toMatch(/const shell = shellModuleFor\(pPlan, projectModuleRef\);\s*if \(shell\) \{\s*moduleAwaitsShell = shell\.name;\s*dispatcher\.setStarterExpected\(true\);/);
    expect(route).toContain("code: 'PROJECT_MODULE_AWAITS_SHELL'");
  });

  it('a preview published during such a turn is not adopted, and the platform is told to stand down', () => {
    expect(route).toContain("if ((e as { type?: string }).type === 'preview' && !moduleAwaitsShell)");
    expect(route).toContain('awaitingShell: moduleAwaitsShell,');
    expect(route).toContain('!isImportTurn && !abort.signal.aborted && !moduleAwaitsShell) {');
  });

  it('the reviewer waits for the assembled app, and a plan that built nothing is retired after a proven app', () => {
    expect(route).toContain('if (result.ok && reviewHeadroomOk && reviewerAllowed && !moduleAwaitsShell) {');
    expect(route).toMatch(/if \(pausedPlanRef && !projectModuleRef && result\.ok && runProof\(\)\.proven && retireUnbuiltPlan\(pausedPlanRef\)\)/);
  });

  it('the new codes are measurements of our process, never findings or suggestions', () => {
    const diag = read('src/server/AgentV3/BuildDiagnostics.ts');
    const sugg = read('src/server/AgentV3/buildFindingSuggestions.ts');
    for (const code of ['PROJECT_MODULE_AWAITS_SHELL', 'PROJECT_PLAN_RETIRED', 'REVIEW_DEFERRED_TO_SHELL']) {
      expect(diag).toContain(`'${code}'`);
      expect(sugg).toContain(`'${code}'`);
    }
  });
});
