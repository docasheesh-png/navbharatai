import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { getWorkspaceMemory, _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { filesOutsideTheApp, outsideAppMatcher, outsideTheAppNote, projectHasBundler } from '../src/server/AgentV3/outsideTheApp';
import { shellRemovalTargets } from '../src/server/AgentV3/shellWriteTargets';
import { unaskedUserFileRemovals, requestAsksToRemove, userFileRemovalMessage, userFileGuardEnabled } from '../src/server/AgentV3/userFileGuard';
import { recordManualEdits, consumeManualEdits, userOwnedFiles, manualEditContext } from '../src/server/AgentV3/ManualEditTracker';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';

/**
 * 🔴 THE REPORT (build 4d538ca3, 2026-10-01 — a Bengali personal-AI-assistant app, Weak tier).
 *
 * The user had put `Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html` into the workspace from Code Studio. The build
 * opened with "I noticed you manually edited 1 file in the IDE", then:
 *
 *   t+277s  evaluate → 0/100 — 34 unsafe-html-sink findings, every one inside that page
 *   t+283s  "the score is 0/100 because of that unrelated file … I'll remove it"
 *   t+295s  $ rm "Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html"  → exit 0
 *   t+302s  evaluate → STILL reports the deleted file ("using a cached/indexed result")
 *   t+322s  FILE_DELETED — the user's file, gone. The summary never mentioned it.
 *
 * The prompt said: "do not remove any existing working features". Three defects, one chain:
 *   1. the score judged a page the bundle never ships;
 *   2. nothing protects a file the user put in the workspace — every delete guard protects SOURCE;
 *   3. an `evaluate` the MODEL called never re-read the disk, so the deleted file kept its findings.
 */

const REPORT_PROMPT = 'Continue the existing project from its current working state. Do not rebuild or redesign anything unnecessarily, and do not remove any existing working features.\n\nFirst inspect the current project and verify the existing build. Then implement only the requested missing feature from the project requirements.';
const USER_PAGE = 'Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html';
const VITE_PKG = JSON.stringify({ dependencies: { react: '^18.3.1' }, devDependencies: { vite: '^5.4.0' } });

// ── 1 · A page the bundle never ships is not the app ────────────────────────────────────────────

describe('filesOutsideTheApp — what a bundled app does not ship is not scored as it', () => {
  it('🔴 the report: a root-level page in a Vite app, imported by nothing, is outside the app', () => {
    const out = filesOutsideTheApp(['index.html', 'src/App.tsx', USER_PAGE, 'package.json'], VITE_PKG, []);
    expect([...out]).toEqual([USER_PAGE]);
  });

  it('the entry is the app', () => {
    expect(filesOutsideTheApp(['index.html'], VITE_PKG).size).toBe(0);
  });

  it('a page under public/ is copied into the build as-is, so it IS shipped and judged', () => {
    expect(filesOutsideTheApp(['public/privacy.html', 'public/docs/a.html'], VITE_PKG).size).toBe(0);
  });

  it('a multi-page input named in vite.config is part of the app', () => {
    const cfg = [{ path: 'vite.config.ts', content: "build: { rollupOptions: { input: { main: 'index.html', about: 'about.html' } } }" }];
    expect(filesOutsideTheApp(['about.html', USER_PAGE], VITE_PKG, cfg)).toEqual(new Set([USER_PAGE]));
  });

  it('🔒 a STATIC site serves every page it holds — with no bundler, nothing is set aside', () => {
    expect(filesOutsideTheApp(['index.html', 'about.html', USER_PAGE], null).size).toBe(0);
    expect(filesOutsideTheApp([USER_PAGE], JSON.stringify({ dependencies: { express: '4' } })).size).toBe(0);
  });

  it('🔒 an unreadable package.json is "unknown", and unknown means judge everything', () => {
    expect(filesOutsideTheApp([USER_PAGE], '{not json').size).toBe(0);
    expect(projectHasBundler('{not json')).toBe(false);
  });

  it('only HTML documents can be set aside — code, styles and data never are', () => {
    expect(filesOutsideTheApp(['notes.ts', 'extra.css', 'data.json', 'old.js'], VITE_PKG).size).toBe(0);
  });

  it('build output and dependencies are not the user\'s files either way', () => {
    expect(filesOutsideTheApp(['dist/index.html', 'node_modules/x/a.html'], VITE_PKG).size).toBe(0);
  });

  it('the matcher reads both spellings a path arrives in', () => {
    const is = outsideAppMatcher(new Set([USER_PAGE]));
    expect(is(`./${USER_PAGE}`)).toBe(true);
    expect(is(USER_PAGE)).toBe(true);
    expect(is('index.html')).toBe(false);
    expect(outsideAppMatcher(new Set())('anything')).toBe(false);
  });

  it('the note tells the model why, and that the file is the user\'s to keep', () => {
    const note = outsideTheAppNote([USER_PAGE], 34);
    expect(note).toContain(USER_PAGE);
    expect(note).toContain('34 finding(s)');
    expect(note).toMatch(/do not delete/i);
    expect(outsideTheAppNote([], 0)).toBe('');
  });
});

// ── 2 · A file the user put here is not the build's to delete ───────────────────────────────────

describe('shellRemovalTargets — what a command deletes', () => {
  it('🔴 the exact command from the report', () => {
    expect(shellRemovalTargets(`rm "${USER_PAGE}"`).paths).toEqual([USER_PAGE]);
  });

  it('flags, absolute workspace paths, unlink and git rm', () => {
    expect(shellRemovalTargets(`rm -f /home/user/workspace/${USER_PAGE}`).paths).toEqual([USER_PAGE]);
    expect(shellRemovalTargets(`unlink ./${USER_PAGE}`).paths).toEqual([USER_PAGE]);
    expect(shellRemovalTargets(`git rm --cached ${USER_PAGE}`).paths).toEqual([USER_PAGE]);
  });

  it('a delete wrapped in sh -c deletes just as thoroughly', () => {
    expect(shellRemovalTargets(`sh -c "rm ${USER_PAGE}"`).paths).toContain(USER_PAGE);
  });

  it('globs are kept apart as patterns', () => {
    const t = shellRemovalTargets('rm -f *.html');
    expect(t.paths).toEqual([]);
    expect(t.globs).toEqual(['*.html']);
  });

  it('paths outside the workspace are not ours to judge', () => {
    expect(shellRemovalTargets('rm -rf /tmp/x.log ~/a').paths).toEqual([]);
  });

  it('a command that deletes nothing has no targets', () => {
    expect(shellRemovalTargets('npm run build && echo rm').paths).toEqual([]);
  });
});

describe('unaskedUserFileRemovals — refused unless the request asks for that file', () => {
  it('🔴 the report: "do not remove any existing working features" is not a request to delete the page', () => {
    expect(unaskedUserFileRemovals(shellRemovalTargets(`rm "${USER_PAGE}"`), [USER_PAGE], REPORT_PROMPT)).toEqual([USER_PAGE]);
  });

  it('a request that names the file and says delete is honoured', () => {
    expect(requestAsksToRemove(`please delete ${USER_PAGE}`, USER_PAGE)).toBe(true);
    expect(requestAsksToRemove('Rabni_Roy_AI_Studio_ALL_IN_ONE-7 wali file hata do', USER_PAGE)).toBe(true);
    expect(unaskedUserFileRemovals({ paths: [USER_PAGE], globs: [] }, [USER_PAGE], `remove ${USER_PAGE}`)).toEqual([]);
  });

  it('naming the file without asking to delete it is not consent', () => {
    expect(requestAsksToRemove(`look at ${USER_PAGE} for the design`, USER_PAGE)).toBe(false);
  });

  it('a glob that matches the user\'s file counts as naming it', () => {
    expect(unaskedUserFileRemovals({ paths: [], globs: ['*.html'] }, [USER_PAGE, 'src/x.ts'], REPORT_PROMPT)).toEqual([USER_PAGE]);
  });

  it('a file the user did not put here is not this guard\'s business', () => {
    expect(unaskedUserFileRemovals({ paths: ['src/old.tsx'], globs: [] }, [USER_PAGE], REPORT_PROMPT)).toEqual([]);
  });

  it('no user files ⇒ nothing is ever refused (the behaviour before this existed)', () => {
    expect(unaskedUserFileRemovals({ paths: [USER_PAGE], globs: ['*'] }, [], REPORT_PROMPT)).toEqual([]);
  });

  it('the refusal is a governance block that tells the model to leave it', () => {
    const msg = userFileRemovalMessage([USER_PAGE]);
    expect(msg).toContain('GOVERNANCE BLOCKED');
    expect(msg).toContain(USER_PAGE);
    expect(msg).toMatch(/leave it/i);
  });

  it('kill switch', () => {
    expect(userFileGuardEnabled({ AGENTV3_USER_FILE_GUARD: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(userFileGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('the user\'s files are remembered across builds, not only until the next one', () => {
  it('🔒 a build consumes the pending set; the owned set survives it', async () => {
    const ws = 'ws-owned-1';
    await recordManualEdits(ws, [USER_PAGE], Date.now());
    const pending = await consumeManualEdits(ws);
    expect(pending.paths).toEqual([USER_PAGE]);
    expect((await consumeManualEdits(ws)).count).toBe(0);
    expect(await userOwnedFiles(ws)).toContain(USER_PAGE);
  });

  it('the model is told, in the note it already reads, not to delete them', () => {
    expect(manualEditContext([USER_PAGE])).toMatch(/do NOT overwrite, revert or delete/);
  });
});

// ── 3 · Through the real dispatcher ─────────────────────────────────────────────────────────────

const RISKY_PAGE = `<!doctype html><html><body><div id="o"></div><script>
${Array.from({ length: 12 }, (_, i) => `document.getElementById('o').innerHTML = location.hash + ${i};`).join('\n')}
</script></body></html>`;

class WorkspaceActuator implements ActuatorPort {
  files = new Map<string, string>([
    ['package.json', VITE_PKG],
    ['index.html', '<!doctype html><html lang="en"><head><title>Assistant</title><meta name="description" content="x"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'],
    ['src/main.tsx', "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n"],
    ['src/App.tsx', 'export default function App() { return <main><h1>Assistant</h1></main>; }\n'],
    [USER_PAGE, RISKY_PAGE],
  ]);
  ran: string[] = [];
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path.replace(/^\.\//, ''));
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) {
    this.ran.push(command);
    const m = /^rm\s+(?:-f\s+)?"?([^"\s]+)"?/.exec(command.trim());
    if (m) this.files.delete(m[1]);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function harness(act: ActuatorPort, ws: string) {
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, ws, new WorkspaceState(stream), stream);
  const refused: string[] = [];
  d.setUserFileRefusalSink((paths) => refused.push(...paths));
  return { d, refused };
}
const bash = (command: string): ToolUse => ({ id: 'b1', name: 'bash', input: { command } });
const evaluate: ToolUse = { id: 'e1', name: 'evaluate', input: {} };

describe('end to end — the page stays, and the score never asked for it to go', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('🔴 the exact command is refused, the file stays, and the report hears about it', async () => {
    const ws = 'ws-user-file-1';
    const act = new WorkspaceActuator();
    const { d, refused } = harness(act, ws);
    d.setUserOwnedFiles([USER_PAGE], REPORT_PROMPT);
    const out = await d.run(bash(`rm "${USER_PAGE}"`), 'architect');
    expect(String(out)).toContain('GOVERNANCE BLOCKED');
    expect(act.files.has(USER_PAGE)).toBe(true);
    expect(act.ran).toEqual([]);
    expect(refused).toEqual([USER_PAGE]);
  });

  it('when the user DID ask, the delete runs', async () => {
    const ws = 'ws-user-file-2';
    const act = new WorkspaceActuator();
    const { d } = harness(act, ws);
    d.setUserOwnedFiles([USER_PAGE], `delete ${USER_PAGE}, I don't need it`);
    await d.run(bash(`rm "${USER_PAGE}"`), 'architect');
    expect(act.files.has(USER_PAGE)).toBe(false);
  });

  it('🔴 evaluate does not score the user\'s page as the app — and says so', async () => {
    const ws = 'ws-user-file-3';
    const act = new WorkspaceActuator();
    const { d } = harness(act, ws);
    const out = String(await d.run(evaluate, 'architect'));
    expect(out).toContain('Not judged as the app');
    expect(out).toContain(USER_PAGE);
    // The page's sinks (12 × medium = 96 points — the report's 34 took it to 0/100) must not reach the
    // security list or the score.
    expect(out).not.toContain(`] ${USER_PAGE}:`);
    expect(out).not.toMatch(/medium-severity security issue/i);
    expect(getWorkspaceMemory(ws).appSecurityFindings().some((f) => f.file === USER_PAGE)).toBe(false);
    // …while the raw record still holds them — set aside, not erased.
    expect(getWorkspaceMemory(ws).securityFindings().some((f) => f.file === USER_PAGE)).toBe(true);
  });

  it('🔴 a model-called evaluate re-reads the disk: a file deleted since is no longer judged', async () => {
    const ws = 'ws-user-file-4';
    const act = new WorkspaceActuator();
    act.files.set('src/Old.tsx', "export const x = (s: string) => { document.body.innerHTML = s; };\n");
    const { d } = harness(act, ws);
    await d.run(evaluate, 'architect');
    expect(getWorkspaceMemory(ws).knownFilePaths()).toContain('src/Old.tsx');
    act.files.delete('src/Old.tsx'); // gone by a road no parser sees
    await d.run(evaluate, 'architect');
    expect(getWorkspaceMemory(ws).knownFilePaths()).not.toContain('src/Old.tsx');
  });
});

// ── Source guards: the wiring a behavioural test cannot see ─────────────────────────────────────

describe('wiring', () => {
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('evaluate seeds the graph from disk BEFORE it reads any finding', () => {
    const body = dispatcher.slice(dispatcher.indexOf("case 'evaluate': {"));
    const seed = body.indexOf('await this.seedGraphFromWorkspace();');
    const read = body.indexOf('mem.securityFindings()');
    expect(seed).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(seed);
  });

  it('the user-file guard runs before the command does', () => {
    const guard = dispatcher.indexOf('unaskedUserFileRemovals(shellRemovalTargets(command)');
    const runs = dispatcher.indexOf('const cmdStartedAt = Date.now();');
    expect(guard).toBeGreaterThan(-1);
    expect(runs).toBeGreaterThan(guard);
  });

  it('the build route arms the guard with the user\'s files and the request', () => {
    expect(route).toMatch(/dispatcher\.setUserOwnedFiles\(\[\.\.\.new Set\(\[\.\.\.manual\.paths, \.\.\.owned\]\)\], prompt\)/);
  });

  it('the tech-debt register records the APP\'s findings, not the user\'s page', () => {
    expect(route).toContain('findingsToDebt({ security: getWorkspaceMemory(workspaceId).appSecurityFindings() })');
    expect(route).not.toContain('findingsToDebt({ security: getWorkspaceMemory(workspaceId).securityFindings() })');
  });
});
