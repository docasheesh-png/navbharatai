import { readFileSync } from 'node:fs';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { findSyntaxErrors } from '../src/server/AgentV3/SyntaxCheck';
import { refuteReviewByEvidence } from '../src/server/AgentV3/reviewEvidence';
import { typecheckEvidenceFromCommands, buildScriptTypecheckVerdict, currentTypecheckProof, mergeCurrentTypecheckProof, type RevisionedTypecheck } from '../src/server/AgentV3/TscGate';
import { fillGateFromLedger } from '../src/server/AgentV3/evidenceLedger';
import { releaseGate, releaseGateSummary, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { getWorkspaceMemory, WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

class Project implements ActuatorPort {
  files = new Map([
    ['package.json', '{"scripts":{"build":"tsc && vite build"},"dependencies":{"react":"19.0.0","vite":"8.0.0"}}'],
    ['tsconfig.json', '{"compilerOptions":{"strict":true,"jsx":"react-jsx"}}'],
    ['vite.config.ts', 'export default {};'],
    ['index.html', '<html><head><title>Business Game</title></head><body><div id="root"></div></body></html>'],
    ['src/App.tsx', 'export default function App() { return <button>Roll</button>; }'],
  ]);
  hold: (() => Promise<void>) | undefined;
  tscOutput = '';
  buildOutput = '> tsc -p tsconfig.build.json && vite build\nvite v8.3.8 building for production...\n✓ built in 199ms';
  async readFile(_workspace: string, path: string) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async writeFile(_workspace: string, path: string, value: string) { this.files.set(path, value); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string) {
    if (/\btsc\b|npm run build/.test(command)) await this.hold?.();
    return { exitCode: 0, stdout: command === 'npm run build' ? this.buildOutput : /\btsc\b/.test(command) ? this.tscOutput : '', stderr: '' };
  }
}
let seq = 0;
const call = (d: ToolDispatcher, name: string, input: Record<string, unknown> = {}) =>
  d.dispatch({ id: `fresh-${++seq}`, name, input }, 'architect');
function fixture() {
  const workspace = `br99771bc7-freshness-${++seq}`;
  const act = new Project();
  const mem = getWorkspaceMemory(workspace);
  const diag = new BuildDiagnostics({ currentSourceRevision: () => mem.verificationRevision() });
  const d = new ToolDispatcher(act, workspace, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, c => diag.recordCommand(c));
  for (const [path, content] of act.files) mem.indexFile(path, content);
  return { act, d, mem, diag };
}
afterEach(() => vi.restoreAllMocks());

describe('99771bc7: read-only evaluation must not invent writes after a clean check', () => {
  it('defaults → clean typecheck → evaluate keeps the live QA hint clean', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { act, d, mem } = fixture();
    await call(d, 'generate_app_defaults', { app_name: 'Business Game' });
    const written = [...act.files.keys()].filter(p => p.startsWith('public/'));
    expect(written).toContain('public/sw.js');
    expect(written).toContain('public/nbai-native.css');
    // These were formerly first indexed by evaluate, several seconds AFTER the compiler.
    clock.mockReturnValue(200);
    expect((await call(d, 'typecheck')).content).toContain('type-checks clean');
    expect(mem.verificationStatus()).toContain('checked CLEAN');
    clock.mockReturnValue(300);
    const before = new Map(act.files);
    const evaluation = await call(d, 'evaluate');
    expect(evaluation.is_error).toBe(false);
    expect(act.files).toEqual(before);
    expect(mem.verificationStatus()).toContain('checked CLEAN');
    expect(mem.verificationStatus()).not.toContain('files have changed since');
    for (const path of written) expect(mem.knownFilePaths()).toContain(path);
  });

  it('an acknowledged write still retires proof when its bytes match a stale index', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const mem = new WorkspaceMemory();
    const original = 'export const answer = 1;';
    mem.indexFile('src/a.ts', original);
    // A shell changed the real source to B without refreshing this partial graph, then compiled B.
    clock.mockReturnValue(200);
    mem.markTscClean(); mem.markProdBuildClean();
    const revision = mem.verificationRevision();
    // Acknowledged write restores A. Equality to a stale graph is not equality to the compiled B.
    clock.mockReturnValue(300); mem.indexFile('src/a.ts', original);
    expect(mem.verificationRevision()).toBeGreaterThan(revision);
    expect(mem.verificationStatus()).toContain('files have changed since');
    expect(mem.prodBuildCleanSinceLastWrite()).toBe(false);
  });

  it('confirmed deletion retires proof even for an unindexed file; recreation is also a change', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const mem = new WorkspaceMemory();
    mem.indexFile('src/a.ts', 'export const answer = 1;');
    clock.mockReturnValue(200); mem.markTscClean();
    const revision = mem.verificationRevision();
    // The graph is partial: not indexed does not mean absent on disk. The caller confirmed deletion.
    clock.mockReturnValue(300); mem.removeFile('src/unindexed.ts');
    expect(mem.verificationRevision()).toBeGreaterThan(revision);
    expect(mem.verificationStatus()).toContain('files have changed since');
    mem.removeFile('./src/a.ts');
    expect(mem.verificationStatus()).toContain('files have changed since');
    clock.mockReturnValue(400); mem.markTscClean();
    clock.mockReturnValue(500); mem.indexFile('src/a.ts', 'export const answer = 1;');
    expect(mem.verificationStatus()).toContain('files have changed since');
  });

  it('a newly discovered file remains conservative, even if its facts are empty', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const mem = new WorkspaceMemory();
    mem.markTscClean();
    clock.mockReturnValue(200);
    mem.ensureGraphNode('src/new.ts');
    mem.indexFile('src/new.ts', '');
    expect(mem.verificationStatus()).toContain('files have changed since');
  });

  it('a stale compile cannot resolve an error observed from a later write', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const mem = new WorkspaceMemory();
    const revision = mem.verificationRevision();
    clock.mockReturnValue(200);
    mem.indexFile('src/a.ts', 'broken');
    mem.recordError('typecheck: 1 TypeScript error(s).');
    clock.mockReturnValue(300); mem.markTscClean(Date.now(), revision);
    expect(mem.openErrors()).toHaveLength(1);
    expect(mem.verificationStatus()).not.toContain('checked CLEAN');
    mem.markTscClean(Date.now(), mem.verificationRevision());
    expect(mem.openErrors()).toHaveLength(0);
  });

  it.each(['typecheck', 'shell typecheck', 'write-time typecheck', 'production build'])('a %s result cannot certify a concurrent writer', async kind => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { act, d, mem, diag } = fixture();
    let release!: () => void, started!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    act.hold = () => { started(); return held; };
    clock.mockReturnValue(200);
    const pending = kind === 'typecheck' ? call(d, 'typecheck')
      : kind === 'write-time typecheck' ? call(d, 'write_file', { path: 'src/first.ts', content: 'export const first = 1;' })
        : call(d, 'bash', { command: kind === 'production build' ? 'npm run build' : 'tsc --noEmit' });
    await inFlight;
    clock.mockReturnValue(300);
    act.files.set('src/later.ts', 'export const later = 1;');
    mem.indexFile('src/later.ts', 'export const later = 1;');
    clock.mockReturnValue(400); release(); await pending;
    expect(mem.verificationStatus()).not.toContain('checked CLEAN');
    expect(mem.prodBuildCleanSinceLastWrite()).toBe(false);
    // Keep the historical successful receipt, but neither fallback may promote it for newer files.
    expect(typecheckEvidenceFromCommands(diag.report().commands ?? [])).toBe('passed');
    expect(diag.typecheckEvidenceFromAgentCommands()).toBeUndefined();
    expect(diag.agentRunEvidence().typecheck).toBeUndefined();
    const gate = freshGate();
    fillGateFromLedger(gate, diag.evidenceLedger());
    expect(gate.typecheck).toBe('not-run');
    expect(releaseGateSummary(releaseGate(gate, { blockers: 0, highSeverity: 0, warnings: 0 })))
      .toContain('a typecheck of the current files is not established');
    act.hold = undefined;
    clock.mockReturnValue(500);
    if (kind === 'production build') {
      await call(d, 'bash', { command: 'npm run build' });
      expect(mem.prodBuildCleanSinceLastWrite()).toBe(true);
    } else {
      await call(d, 'typecheck');
      expect(mem.verificationStatus()).toContain('checked CLEAN');
    }
    expect(diag.typecheckEvidenceFromAgentCommands()).toBe('passed');
    expect(diag.evidenceLedger().facts.typecheck?.outcome).toBe('passed');
  });
});

function freshGate(): RuntimeEvidence {
  return { buildOk: false, preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run' };
}

describe('current compiler evidence is read at the consumer, without rewriting history', () => {
  it('a later write invalidates all command evidence readers, and a later full recheck restores them', async () => {
    const { d, mem, diag } = fixture();
    await call(d, 'typecheck');
    expect(diag.typecheckEvidenceFromAgentCommands()).toBe('passed');
    mem.indexFile('src/later.ts', 'broken');
    expect(diag.typecheckEvidenceFromAgentCommands()).toBeUndefined();
    expect(diag.agentRunEvidence().typecheck).toBeUndefined();
    expect(diag.evidenceLedger().facts.typecheck).toBeUndefined();
    expect(typecheckEvidenceFromCommands(diag.report().commands ?? [])).toBe('passed');
    await call(d, 'typecheck');
    expect(diag.evidenceLedger().facts.typecheck?.outcome).toBe('passed');
    const failedGate = { ...freshGate(), typecheck: 'failed' as const };
    fillGateFromLedger(failedGate, diag.evidenceLedger());
    expect(failedGate.typecheck).toBe('failed');
  });

  it.each(['tsc --noEmit src/one.ts', 'tsc --noEmit -p other/tsconfig.json', 'tsc --noEmit | head -0'])('a narrow or clipped command cannot supply current project evidence: %s', async command => {
    const { d, diag } = fixture();
    await call(d, 'bash', { command });
    expect(diag.typecheckEvidenceFromAgentCommands()).toBeUndefined();
    expect(diag.evidenceLedger().facts.typecheck).toBeUndefined();
  });

  it('keeps current echoed production compiler evidence, but a bundler-only build proves no types', async () => {
    const { act, d, mem, diag } = fixture();
    await call(d, 'bash', { command: 'npm run build' });
    expect(diag.evidenceLedger().facts.typecheck?.outcome).toBe('passed');
    mem.indexFile('src/new.ts', 'export const newer = 1;');
    act.buildOutput = '> vite build\n✓ built in 199ms';
    await call(d, 'bash', { command: 'npm run build' });
    expect(diag.evidenceLedger().facts.typecheck).toBeUndefined();
  });

  it('a failed current whole-project compiler remains a failure and cannot borrow an older pass', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { act, d, mem, diag } = fixture();
    clock.mockReturnValue(200);
    await call(d, 'typecheck');
    expect(mem.verificationStatus()).toContain('checked CLEAN');
    act.tscOutput = "src/App.tsx(1,1): error TS2304: Cannot find name 'broken'.";
    await call(d, 'typecheck');
    expect(diag.typecheckEvidenceFromAgentCommands()).toBe('failed');
    expect(diag.evidenceLedger().facts.typecheck?.outcome).toBe('failed');
    expect(mem.verificationStatus()).not.toContain('checked CLEAN');
  });

  it('a production compiler failure retires prior production proof; a generic bundler fault does not claim a type failure', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { act, d, mem, diag } = fixture();
    clock.mockReturnValue(200);
    await call(d, 'typecheck');
    await call(d, 'bash', { command: 'npm run build' });
    expect(mem.prodBuildCleanSinceLastWrite()).toBe(true);
    act.buildOutput = '> vite build\nerror during build: missing asset';
    await call(d, 'bash', { command: 'npm run build' });
    expect(mem.verificationStatus()).toContain('checked CLEAN');
    act.buildOutput = "> tsc -p tsconfig.build.json && vite build\nsrc/App.tsx(1,1): error TS2304: Cannot find name 'broken'.";
    await call(d, 'bash', { command: 'npm run build' });
    expect(mem.verificationStatus()).not.toContain('checked CLEAN');
    expect(mem.prodBuildCleanSinceLastWrite()).toBe(false);
    expect(diag.typecheckEvidenceFromAgentCommands()).toBe('failed');
  });

  it('a stale or narrow failed compile cannot retire a current whole-project proof', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const mem = new WorkspaceMemory();
    const older = mem.verificationRevision();
    mem.indexFile('src/a.ts', 'changed');
    clock.mockReturnValue(200); mem.markTscClean();
    mem.markTscFailed(older, true);
    expect(mem.verificationStatus()).toContain('checked CLEAN');
  });

  it.each(['npx vitest run', 'npx vitest run && tsc --noEmit'])(
    'withholding stale compiler proof preserves the completed suite in %s', (command) => {
      const diag = new BuildDiagnostics({ currentSourceRevision: () => 2 });
      diag.recordCommand({ command, exitCode: 0,
        stdout: 'Test Files  1 passed (1)\nTests  3 passed (3)',
        typecheckProof: { revision: 1, project: true } });
      expect(diag.agentRunEvidence().typecheck).toBeUndefined();
      expect(diag.agentRunEvidence().tests).toBe('passed');
      expect(diag.evidenceLedger().facts.tests?.outcome).toBe('passed');
    },
  );

  it('keeps offline receipt readers compatible and never serializes a live callback', () => {
    const diag = new BuildDiagnostics();
    diag.recordCommand({ command: 'tsc --noEmit', exitCode: 0, stdout: '' });
    expect(diag.typecheckEvidenceFromAgentCommands()).toBe('passed');
    const live = new BuildDiagnostics({ currentSourceRevision: () => 1 });
    live.recordCommand({ command: 'tsc --noEmit', exitCode: 0, stdout: '' });
    expect(live.typecheckEvidenceFromAgentCommands()).toBeUndefined();
    expect(JSON.stringify(live.report())).not.toContain('currentSourceRevision');
  });

  it('the route defers command fallback until the final ledger read and refreshes it before refuting review', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('currentSourceRevision: () => getWorkspaceMemory(workspaceId).verificationRevision()');
    expect(route).not.toContain('const fromAgent = buildDiag.typecheckEvidenceFromAgentCommands();');
    expect(route).toContain('gateEvidence.typecheck = combineTypecheckEvidence(');
    expect(route).toContain('const currentTypecheck = combineTypecheckEvidence(');
    expect(route).toContain('currentTypecheckProof(platformTypecheckProof, getWorkspaceMemory(workspaceId).verificationRevision()),');
    expect(route).toContain('const gateLedger = buildDiag.evidenceLedger();');
    expect(route).toContain('gateLedger.facts.typecheck?.outcome);');
    expect(route).toContain('buildDiag.evidenceLedger().facts.typecheck?.outcome);');
    expect(route).toContain('refuteReviewByEvidence(review, { typecheck: currentTypecheck, stylesheets })');
  });
});


describe('platform compiler proof is bound to the same source revision at final consumption', () => {
  it('G3 clean → syntax-valid type-invalid design write → production compiler failure stays failed in gate and review', async () => {
    const { act, mem, diag } = fixture();
    let proof: RevisionedTypecheck | undefined = { outcome: 'passed', revision: mem.verificationRevision() };
    const bad = 'export const cash: string = 500;';
    expect(await findSyntaxErrors({ 'src/cash.ts': bad })).toEqual([]);
    await act.writeFile('unused', 'src/cash.ts', bad);
    mem.indexFile('src/cash.ts', bad); // the design-consistency platform pass indexes its acknowledged writes
    expect(currentTypecheckProof(proof, mem.verificationRevision())).toBe('not-run');
    const startedRevision = mem.verificationRevision();
    const failed = buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 2,
      stdout: '> tsc -p tsconfig.build.json && vite build\nsrc/cash.ts(1,14): error TS2322: Type number is not assignable to type string.' });
    expect(failed).toBe('failed');
    proof = mergeCurrentTypecheckProof(proof, { outcome: failed!, revision: startedRevision }, mem.verificationRevision());
    const gate = { ...freshGate(), typecheck: currentTypecheckProof(proof, mem.verificationRevision()) };
    fillGateFromLedger(gate, diag.evidenceLedger());
    expect(gate.typecheck).toBe('failed');
    const review = { passed: false, score: 20, summary: 'TypeScript errors are present', issues: [{ severity: 'critical' as const, message: 'TypeScript errors are present in cash.ts' }] };
    expect(refuteReviewByEvidence(review, { typecheck: gate.typecheck }).refuted).toEqual([]);
  });

  it('retains unchanged G3 proof, rejects in-flight stale platform results, and accepts a current recheck after edits', () => {
    const { mem } = fixture();
    let proof: RevisionedTypecheck | undefined = { outcome: 'passed', revision: mem.verificationRevision() };
    expect(currentTypecheckProof(proof, mem.verificationRevision())).toBe('passed');
    const old = mem.verificationRevision();
    mem.indexFile('src/new.ts', 'export const n = 1;');
    proof = mergeCurrentTypecheckProof(proof, { outcome: 'passed', revision: old }, mem.verificationRevision());
    expect(currentTypecheckProof(proof, mem.verificationRevision())).toBe('not-run');
    proof = mergeCurrentTypecheckProof(proof, { outcome: 'failed', revision: old }, mem.verificationRevision());
    expect(currentTypecheckProof(proof, mem.verificationRevision())).toBe('not-run');
    proof = mergeCurrentTypecheckProof(proof, { outcome: 'passed', revision: mem.verificationRevision() }, mem.verificationRevision());
    expect(currentTypecheckProof(proof, mem.verificationRevision())).toBe('passed');
  });

  it('a production success cannot hide a current wider-project failure', () => {
    const proof: RevisionedTypecheck = { outcome: 'failed', revision: 2 };
    expect(mergeCurrentTypecheckProof(proof, { outcome: 'passed', revision: 2 }, 2)).toEqual(proof);
  });

  it('the route binds every platform compiler and refreshes direct proof before final gate and reviewer', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("platformTypecheckProof = { outcome: check.ok ? 'passed' : 'failed', revision: check.revision }");
    expect(route).toContain('const prodBuildCheckedRevision = getWorkspaceMemory(workspaceId).verificationRevision()');
    expect(route).toContain('{ outcome: fromBuild, revision: prodBuildCheckedRevision }, getWorkspaceMemory(workspaceId).verificationRevision())');
    const refresh = 'gateEvidence.typecheck = combineTypecheckEvidence(';
    expect(route.lastIndexOf(refresh)).toBeLessThan(route.indexOf('fillGateFromLedger(gateEvidence, gateLedger)'));
    expect(route).toContain('const currentTypecheck = combineTypecheckEvidence(');
  });
});
