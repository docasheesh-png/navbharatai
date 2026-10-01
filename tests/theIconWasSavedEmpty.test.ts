// AUTOPSY 728a402d (2026-09-30) — "Nemi Mart", Weak tier, milestone 1 of a 6-step roadmap.
//
// The app rendered and the build succeeded, and the report still carried five defects of ours:
//   1. Python's `ModuleNotFoundError` matched the dead-sandbox pattern `ENOTFOUND` (case-insensitive,
//      no boundary): the live sandbox was dropped, the command re-run, and the report said "sandbox
//      unavailable".
//   2. `write_file` wrote an EMPTY `nemi-icon-192.png`; the real icons a Python script drew were never
//      saved, so the durable app carried a zero-byte icon and no 512 icon at all.
//   3. Milestone 1 (the storefront) was graded on the whole message — login, sign-up, dashboard and
//      admin panel "not found", twice — and the reviewer was asked to judge it on that message too.
//   4. The suggest-only reviewer was "sampled" five config files at 500 characters each, read the app
//      one file per call, and timed out without a verdict — as it had on every earlier report.
//   5. A healed design finding stayed "unresolved" beside DESIGN_HEALED. (The same report's refused
//      import sweep is fixed by PR #3403, which moved it first — not duplicated here.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeadSandboxSignal, isDeadSandboxError } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/sandboxHealth';
import { binaryTextWriteRefusal } from '../src/server/AgentV3/binaryTextWrite';
import { unsavedBuildAssets, persistBuildAssets, buildAssetsNote, parseChangedListing, CHANGED_SINCE_BASELINE_COMMAND } from '../src/server/AgentV3/buildAssets';
import { leanReviewInline, reviewerInstruction } from '../src/server/AgentV3/ReviewerAgent';
import { foldCostTelemetry, type CostTelemetryEntry } from '../src/server/AgentV3/AgentV3CostTelemetry';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const read = (p: string) => readFileSync(p, 'utf8');
const PIL = "Traceback (most recent call last):\n  File \"<stdin>\", line 1, in <module>\nModuleNotFoundError: No module named 'PIL'\n";

describe('a program that ran and failed is not a dead sandbox', () => {
  it('the report\'s own failure: a missing Python module, exit 1', () => {
    expect(isDeadSandboxError(PIL)).toBe(false);
    expect(isDeadSandboxSignal({ exitCode: 1, durationMs: 1714, stdout: '', stderr: PIL })).toBe(false);
  });

  it('any real exit status means a process ran — an app\'s own network error or a "503" line does not drop the machine', () => {
    expect(isDeadSandboxSignal({ exitCode: 1, durationMs: 900, stderr: 'Error: connect ECONNREFUSED 127.0.0.1:5432' })).toBe(false);
    expect(isDeadSandboxSignal({ exitCode: 2, durationMs: 40, stderr: '  File "app.py", line 503, in main' })).toBe(false);
  });

  it('a real dead sandbox is still recognised', () => {
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 0, stdout: '', stderr: '' })).toBe(true);
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 3000, errorMessage: 'getaddrinfo ENOTFOUND sandbox.e2b.app' })).toBe(true);
    expect(isDeadSandboxError('connect ECONNREFUSED 10.0.0.1:49982')).toBe(true);
    expect(isDeadSandboxError('socket hang up')).toBe(true);
  });
});

describe('a write tool does not write a binary file', () => {
  it('a .png is refused with the two ways that work; text files are untouched', () => {
    const msg = binaryTextWriteRefusal('public/nemi-icon-192.png');
    expect(msg).toContain('NOT WRITTEN');
    expect(msg).toContain('.svg');
    expect(msg).toContain('create it with a command');
    expect(binaryTextWriteRefusal('public/icon.svg')).toBeNull();
    expect(binaryTextWriteRefusal('src/App.tsx')).toBeNull();
  });

  class Act implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  const make = () => { const act = new Act(); const stream = new AgentEventStream(); return { act, d: new ToolDispatcher(act, 'ws-icon', new WorkspaceState(stream), stream) }; };

  it('the report\'s empty write_file to a .png writes nothing and returns an error', async () => {
    const { act, d } = make();
    const res = await d.dispatch({ id: 'w', name: 'write_file', input: { path: 'public/nemi-icon-192.png', content: '' } }, 'architect');
    expect(act.files.has('public/nemi-icon-192.png')).toBe(false);
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toContain('NOT WRITTEN');
  });

  it('a batch carrying a .png is refused whole, never half-applied', async () => {
    const { act, d } = make();
    const res = await d.dispatch({ id: 'b', name: 'write_files_batch', input: { files: [
      { path: 'src/a.ts', content: 'export const a = 1;\n' },
      { path: 'public/logo.png', content: 'x' },
    ] } }, 'architect');
    expect(res.is_error).toBe(true);
    expect(act.files.size).toBe(0);
  });
});

describe('a binary file the build made is saved with the app', () => {
  it('only new binaries outside node_modules/dist are picked', () => {
    const r = unsavedBuildAssets(
      ['public/nemi-icon-192.png', 'public/nemi-icon-512.png', 'public/logo.png', 'node_modules/x/a.png', 'dist/icon.png', 'src/App.tsx', 'public/icon.svg', '.nbai-landing.tar.gz', 'test-results/smoke/failure.png'],
      ['public/logo.png'],
    );
    expect(r.save).toEqual(['public/nemi-icon-192.png', 'public/nemi-icon-512.png']);
    expect(r.overCap).toEqual([]);
  });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');

  it('reads the bytes, saves a data URI with the right type, and never saves an empty file', async () => {
    const saved: Record<string, string>[] = [];
    const out = await persistBuildAssets(
      {
        listFiles: async () => ['public/nemi-icon-512.png', 'public/empty.png'],
        readBinaryFile: async (_w, p) => (p.endsWith('empty.png') ? '' : png),
      },
      'ws',
      { heldPaths: async () => [], save: async (_w, a) => { saved.push(a); } },
    );
    expect(out.saved).toEqual(['public/nemi-icon-512.png']);
    expect(out.skipped).toEqual(['public/empty.png']);
    expect(saved[0]['public/nemi-icon-512.png']).toBe(`data:image/png;base64,${png}`);
    expect(buildAssetsNote(out)).toContain('1 binary file(s) this build created were saved');
  });

  it('an unreadable store saves nothing rather than re-reading everything; no binary read ⇒ stands down', async () => {
    const save = async () => { throw new Error('must not save'); };
    const a = await persistBuildAssets({ listFiles: async () => ['a.png'], readBinaryFile: async () => png }, 'ws', { heldPaths: async () => null, save });
    expect(a.standDown).toBe('store-unreadable');
    const b = await persistBuildAssets({ listFiles: async () => ['a.png'] }, 'ws', { heldPaths: async () => [], save });
    expect(b.standDown).toBe('no-binary-read');
  });

  it('a held icon the build REGENERATED is saved again; an untouched held one is not re-read', async () => {
    expect(unsavedBuildAssets(['public/a.png', 'public/b.png'], ['public/a.png', 'public/b.png'], 40, new Set(['public/a.png'])).save).toEqual(['public/a.png']);
    expect(parseChangedListing('./public/a.png\n./src/App.tsx\n\n')).toEqual(['public/a.png', 'src/App.tsx']);
    const reads: string[] = [];
    const out = await persistBuildAssets(
      {
        listFiles: async () => ['public/a.png', 'public/b.png'],
        readBinaryFile: async (_w, p) => { reads.push(p); return png; },
        runCommand: async (_w, cmd) => ({ exitCode: cmd === CHANGED_SINCE_BASELINE_COMMAND ? 0 : 1, stdout: './public/a.png\n', stderr: '' }),
      },
      'ws',
      { heldPaths: async () => ['public/a.png', 'public/b.png'], save: async () => {} },
    );
    expect(reads).toEqual(['public/a.png']);
    expect(out.saved).toEqual(['public/a.png']);
  });

  it('no marker on the machine ⇒ held assets are left alone (never all re-read)', async () => {
    const reads: string[] = [];
    await persistBuildAssets(
      { listFiles: async () => ['public/a.png'], readBinaryFile: async (_w, p) => { reads.push(p); return png; }, runCommand: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      'ws',
      { heldPaths: async () => ['public/a.png'], save: async () => {} },
    );
    expect(reads).toEqual([]);
    expect(CHANGED_SINCE_BASELINE_COMMAND.startsWith('test -f /tmp/.nbai-asset-baseline && find . -type f -newer ')).toBe(true);
  });

  it('the route marks the baseline after setup, before the build writes', () => {
    const route = read('src/server/routes/agentv3.ts');
    const mark = route.indexOf('actuator.runCommand(workspaceId, MARK_ASSET_BASELINE_COMMAND)');
    expect(mark).toBeGreaterThan(route.indexOf("message: `Project checked in ${"));
    expect(mark).toBeLessThan(route.indexOf('milestoneRequest = step1.buildPrompt;'));
  });

  it('the route saves them after the kept save, never for a restored turn', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('if (persisted === toSave && expectsArtifacts && !isImportTurn) {');
    expect(route).toContain('persistBuildAssets(actuator as BuildAssetSource, workspaceId, { heldPaths: listWorkspaceAssetPaths, save: saveWorkspaceAssets })');
    expect(read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts')).toContain("async readBinaryFile(workspaceId: string, filePath: string): Promise<string> {");
  });
});

describe('a milestone is judged on what it was asked to build', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('the readiness audit, the feature probe and the reviewer all read the milestone brief', () => {
    expect(route).toMatch(/milestoneRequest = step1\.buildPrompt;\s*dispatcher\.setCoverageRequest\(step1\.buildPrompt\);/);
    expect(route).not.toContain('checkFeaturePresence(prompt,');
    // Four since autopsy a106df77 (the probe over the app's other screens was added).
    expect(route.match(/checkFeaturePresence\(milestoneRequest \?\? prompt,/g)?.length).toBe(4);
    expect(route).toContain('userRequest: milestoneRequest ?? prompt,');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('const requestText = this.coverageRequest ?? currentRequestForCoverage(requestEpisodes);');
  });
});

describe('a lean review is handed the code it judges', () => {
  const content: Record<string, string> = {
    '.gitignore': 'node_modules\n',
    'package.json': '{}',
    'vite.config.ts': 'export default {}',
    'src/App.tsx': 'export default function App() { return null; }\n',
    'src/pages/CartPage.tsx': 'export function CartPage() { return null; }\n',
    'src/hooks/useCart.ts': 'export function useCart() {}\n',
    'e2e/smoke.spec.ts': 'test()',
    'src/huge.ts': 'x'.repeat(20_000),
  };

  it('picks the app\'s own source, entry first, in full — never the config files', () => {
    const inline = leanReviewInline(Object.keys(content), (p) => content[p]);
    expect(inline.files.map((f) => f.path)).toEqual(['src/App.tsx', 'src/pages/CartPage.tsx', 'src/hooks/useCart.ts']);
    expect(inline.files[0].content).toBe(content['src/App.tsx']);
    expect(inline.omitted).toEqual(['src/huge.ts']);
  });

  it('the suggest instruction carries them in full and says not to read them again; a full review is unchanged', () => {
    const inline = leanReviewInline(Object.keys(content), (p) => content[p]);
    const base = { userRequest: 'storefront', fileTree: Object.keys(content), fileSample: [] as { path: string; content: string }[] };
    const lean = reviewerInstruction({ ...base, mode: 'suggest', inlineFiles: inline });
    expect(lean).toContain('THE FILES THAT CHANGED, IN FULL (3)');
    expect(lean).toContain('=== src/pages/CartPage.tsx ===\nexport function CartPage() { return null; }');
    expect(lean).toContain('Do NOT read any of these again with a tool.');
    expect(lean).toContain('src/huge.ts');
    expect(reviewerInstruction({ ...base, mode: 'full', inlineFiles: inline })).toBe(reviewerInstruction({ ...base, mode: 'full' }));
  });

  it('the route hands it the changed files only in suggest mode', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("const reviewInline = reviewPlan.mode === 'suggest' ? leanReviewInline(reviewChanged, (p) => writtenFiles.get(p)) : undefined;");
    expect(route).toContain('...(reviewInline ? { inlineFiles: reviewInline } : {}),');
  });
});

describe('finishing work runs where it can land', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('a design finding the same check no longer sees is resolved', () => {
    expect(route).toContain("if (designRepair && after.ok) { try { buildDiag.resolveOnRecheck('DESIGN_PAGE_INCONSISTENT'); } catch { /* best-effort */ } }");
  });
});

describe('the platform keeps how long a SUCCESSFUL build takes, per task type', () => {
  const e = (ok: boolean, durationMs: number): CostTelemetryEntry => ({ taskType: 'complex_app', startTier: 'sonnet', billedUsd: 1, inputTokens: 1, outputTokens: 1, ok, powerMode: false, durationMs });

  it('a watchdog kill does not stretch it, and the all-builds total is unchanged', () => {
    let doc = foldCostTelemetry(null, '2026-09-30', e(true, 690_000), 1);
    doc = foldCostTelemetry(doc, '2026-09-30', e(false, 1_800_000), 2);
    expect(doc.byTaskType.complex_app.okDurationMs).toBe(690_000);
    expect(doc.byTaskType.complex_app.durationMs).toBe(2_490_000);
    expect(doc.byTaskType.complex_app.okBuilds).toBe(1);
  });
});
