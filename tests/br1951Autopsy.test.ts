/** BR1951 (9abd4380): retained evidence, not a production replay. */
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { domGameKind, domGameNotPlayedVerdict } from '../src/server/AgentV3/gamePlaytest';
import { classifyDevServerFailure, undeclaredDevDependency } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { redTeamRunNote } from '../src/server/AgentV3/FuzzProbe';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { gameKitPlan, gameKitHandoffBlock, compactRecipeResult } from '../src/server/AgentV3/gameKitSeed';
import { dataEntryEvidence } from '../src/server/AgentV3/journeyDerivation';
import { analyzeRunnability } from '../src/server/AgentV3/RunnabilityAnalysis';
import { analyzeArchitecture } from '../src/server/AgentV3/ArchitectureAnalysis';
import { assessReadiness } from '../src/server/AgentV3/Readiness';
import { appIsDone } from '../src/server/AgentV3/doneSignal';
import { getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

class MemorySandbox implements ActuatorPort {
  files = new Map<string, string>();
  unreadable = false;
  commands: string[] = [];
  async readFile(_ws: string, p: string) {
    if (this.unreadable) throw new Error('transient sandbox error');
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`ENOENT: ${p}`);
    return c;
  }
  async writeFile(_ws: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) {
    this.commands.push(cmd);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl() { return 'https://example.invalid'; }
}
let seq = 0;
const dispatcher = (a: MemorySandbox) => new ToolDispatcher(a, `br1951-${++seq}`);
const call = (d: ToolDispatcher, name: string, input: Record<string, unknown>) =>
  d.dispatch({ id: `${++seq}`, name, input }, 'architect');

describe('BR1951: acknowledgements describe actual state', () => {
  it.each(gameKitPlan('Make a runner game'))('%s cannot say wired when every read failed', async (recipe) => {
    const a = new MemorySandbox(); a.unreadable = true;
    const r = await call(dispatcher(a), 'run_recipe', { name: recipe, ...(recipe === 'generate_game_vfx' ? { input: { include: ['audio'] } } : {}) });
    expect(r.is_error).toBe(true);
    expect(a.files.size).toBe(0);
    expect(gameKitHandoffBlock([{ recipe, ok: !r.is_error, content: String(r.content) }])).toBe('');
  });

  it('a negative tsconfig observation expires when a successful config write lands', async () => {
    const a = new MemorySandbox();
    const d = dispatcher(a);
    await call(d, 'write_file', { path: 'src/first.ts', content: 'export const a = 1;' });
    await call(d, 'write_file', { path: 'tsconfig.json', content: '{"compilerOptions":{"strict":true}}' });
    a.commands = [];
    await call(d, 'write_file', { path: 'src/second.ts', content: 'export const b = 2;' });
    expect(a.commands.some(c => c.includes('--noEmit'))).toBe(true);
  });

  it('the real partial project at step 10 cannot be called done at 92/100', () => {
    const id = `br1951-config-${++seq}`;
    const m = getWorkspaceMemory(id);
    m.indexFile('vite.config.ts', 'export default {};');
    const pkg = JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^4.2.0' } });
    const run = analyzeRunnability(m.graph(), pkg);
    const ready = assessReadiness(analyzeArchitecture(m.graph()), [], run.findings.map(f => ({ severity: f.level === 'high' ? 'high' as const : 'medium' as const, label: f.message })));
    expect(appIsDone(ready)).toBe(false);
  });

  it.each(['Input | null', 'Input', 'Form', 'Select', 'Textarea'])('a TypeScript generic %s is not a form', (type) => {
    expect(dataEntryEvidence({ 'src/game/runner/Game.tsx': `const inputRef = useRef<${type}>(null);` })).toBeNull();
  });
  it('real elements and library components, even beside generics, remain data entry', () => {
    for (const tag of ['<input name="name" />', '<Input label="Name" />', '<textarea />', '<Form />']) {
      expect(dataEntryEvidence({ 'src/App.tsx': `const ref = useRef<Input | null>(null);\nexport default () => ${tag};` })).not.toBeNull();
    }
  });
  it('a comment describing a form is not a form', () => {
    expect(dataEntryEvidence({ 'src/App.tsx': '// render <input> later\nexport default () => <button>Jump</button>;' })).toBeNull();
  });
  it('managed dev-server failure cannot return a successful command receipt', () => {
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    const block = src.slice(src.indexOf('// Honest health line:'), src.indexOf('// REGULAR command with DEAD-SANDBOX'));
    expect(block).toContain('exitCode: portUp ? 0 : 1');
  });
});


describe('BR1951: recovery and proof do not overclaim', () => {
  const log = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@vitejs/plugin-react' imported from /home/user/workspace/vite.config.ts.timestamp-1794108803230.mjs";
  it('an undeclared config import asks for a compatible version, not two ineffective reinstalls', () => {
    expect(undeclaredDevDependency(classifyDevServerFailure(log), log, '{"devDependencies":{"vite":"^4.2.0"}}').recovery).toBe('code_fix');
  });
  it.each([null, 'invalid', '{"devDependencies":{"@vitejs/plugin-react":"^4"}}'])('unknown or declared dependencies retain their recovery (%s)', manifest => {
    const d = classifyDevServerFailure(log);
    expect(undeclaredDevDependency(d, log, manifest)).toBe(d);
  });
  it('a dependency importing its own transitive module still gets install recovery', () => {
    const d = classifyDevServerFailure(log);
    expect(undeclaredDevDependency(d, log.replace('workspace/vite.config', 'workspace/node_modules/other/vite.config'), '{}')).toBe(d);
  });
  it('HTML template data entry stays visible', () => {
    expect(dataEntryEvidence({ 'index.html': '<form><input name="name"></form>' })).not.toBeNull();
  });
  it('a non-canvas runner is explicitly unplayed, not silently omitted', () => {
    const kind = domGameKind({ 'src/Game.tsx': 'export default () => <div>Jump</div>' }, buildGameContract('Make a runner game'));
    expect(kind).toBe('action');
    expect(domGameNotPlayedVerdict(kind!).code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(domGameNotPlayedVerdict(kind!).score).toBeNull();
  });
});


describe('BR1951: sibling and serialization invariants', () => {
  it('a preserved user file is not compacted into a write acknowledgement', () => {
    expect(compactRecipeResult('skipped existing src/game/core/loop.ts')).not.toContain('Wrote:');
    expect(compactRecipeResult('skipped existing src/game/core/loop.ts')).toContain('skipped existing');
  });
  it("a config written by a sibling invalidates another writer's cached absence", async () => {
    const a = new MemorySandbox(), parent = dispatcher(a), child = dispatcher(a);
    child.shareWriteTypecheckStats(parent.sharedWriteTypecheckStats());
    await call(parent, 'write_file', { path: 'src/first.ts', content: 'export const a = 1;' });
    await call(child, 'write_files_batch', { files: [{ path: 'tsconfig.json', content: '{"compilerOptions":{"strict":true}}' }] });
    a.commands = [];
    await call(parent, 'write_file', { path: 'src/second.ts', content: 'export const b = 2;' });
    expect(a.commands.some(c => c.includes('--noEmit'))).toBe(true);
  });
  it.each([undefined, { turns: 0, latencyMs: 0 }, { turns: 2, latencyMs: 21500, firstInRun: 1 }])('counts the exact serialized issue snapshot (%j)', tally => {
    const d = new BuildDiagnostics({ workspaceId: 'br1951-counts' });
    if (tally) d.setTodoOnlyTally(tally);
    const r = d.report();
    expect(r.counts.total).toBe(r.issues.length);
    expect(r.counts.errors).toBe(0);
    expect(r.counts.warnings).toBe(0);
  });
  it('corrects the exact final localhost preview claim but not local-development instructions', () => {
    const f = { consoleCaptured: true, screenshotTaken: false, previewVerified: true };
    expect(auditSummaryClaims('✅ Live preview available at: http://localhost:5173', f).some(c => c.kind === 'sandbox-preview-link')).toBe(true);
    expect(auditSummaryClaims('Run npm run dev, then open http://localhost:5173 locally.', f).some(c => c.kind === 'sandbox-preview-link')).toBe(false);
    expect(auditSummaryClaims('Live preview: https://preview.example.invalid', f).some(c => c.kind === 'sandbox-preview-link')).toBe(false);
  });
});


it('BR1951: zero hostile-input cases is not a passing hostile-input verdict', () => {
  const note = redTeamRunNote({ casesRun: 0, crashes: 0, ms: 0, budgetMs: 30000 });
  expect(note.message).toContain('no hostile-input cases ran');
  expect(note.message).not.toContain('no crash');
});


it('BR1951: a partial Project Mode module does not need the later shell entry yet', () => {
  const m = getWorkspaceMemory('br1951-partial');
  m.indexFile('vite.config.ts', 'export default {};');
  const pkg = '{"scripts":{"dev":"vite","build":"vite build"},"devDependencies":{"vite":"^4.2.0"}}';
  expect(analyzeRunnability(m.graph(), pkg, true).findings.every(f => f.level !== 'high')).toBe(true);
});
