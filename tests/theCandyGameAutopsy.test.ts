/**
 * AUTOPSY 7da1cdca (2026-10-04) — "Ek puzzle game bnao candy wala". Weak tier, the build succeeded,
 * the game rendered and played. Four things in the report were our own defects:
 *
 *  1. SAVED_SOURCE_DIVERGES — `sed -i` snapped spacing in two files; every browser check saw the new
 *     files, the saved project got the old ones. A shell write never reached the captured writes.
 *  2. STYLE_RULES_RESUMED on eight `.nbg-tc-*` classes our own touch controls DEFINE — in a script
 *     string the class check could not read. A wasted turn and a second copy of every rule.
 *  3. `three` was imported by recipe code and only NAMED as "add the dependency"; seven errors were
 *     quoted for two minutes before the model installed it. Twenty-two recipes did the same.
 *  4. `TUNES` was imported from the wrong module; our note said the fix was in `melody.ts` (a recipe
 *     library file), so the model edited it four times instead of changing one import.
 *  (+) The 3D shell was the "LAST" step of every game, so a 2D match-3 got 24 unused 3D files.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { shellWriteTargets, shellReadBackTargets } from '../src/server/AgentV3/shellWriteTargets';
import { classesDefinedInScriptStrings, findUndefinedClasses } from '../src/server/AgentV3/CssConsistency';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { recipeDependenciesNeeded } from '../src/server/lib/gameRecipeLayers';
import { namedDependencies, manifestDirFor, unlistedDependencies } from '../src/server/AgentV3/recipeDependencyLine';
import { remedyFileFor, exportedElsewhere, exportSearchCommand, missingExportNames } from '../src/server/AgentV3/tscErrorCause';
import { writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { recipeInstallCommand, RECIPE_DEPS_BUSY_MARKER } from '../src/server/AgentV3/tscCommand';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  onCommand: (cmd: string) => void = () => {};
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) { this.commands.push(cmd); this.onCommand(cmd); return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

function dispatcher(act: FakeActuator, recorded: Map<string, string>): ToolDispatcher {
  const stream = new AgentEventStream();
  return new ToolDispatcher(
    act, 'ws-candy', new WorkspaceState(stream), stream,
    undefined, undefined, undefined, undefined, undefined, undefined,
    (path, content) => { recorded.set(path, content); },
  );
}

describe('1 · a shell write reaches the saved project', () => {
  let act: FakeActuator;
  let recorded: Map<string, string>;
  beforeEach(() => { act = new FakeActuator(); recorded = new Map(); });

  it('the report\'s own `sed -i` is read back and recorded with what the sandbox now holds', async () => {
    act.files.set('src/game/candy.css', '.btn { padding: 8px 14px; }');
    act.onCommand = (cmd) => {
      if (cmd.includes("sed -i 's/14px/12px/g' src/game/candy.css")) act.files.set('src/game/candy.css', '.btn { padding: 8px 12px; }');
    };
    await dispatcher(act, recorded).dispatch(call('bash', { command: "sed -i 's/14px/12px/g' src/game/candy.css" }), 'architect');
    expect(recorded.get('src/game/candy.css')).toBe('.btn { padding: 8px 12px; }');
  });

  it('an inline node script that writes by a literal path is read back too', async () => {
    act.files.set('src/index.css', 'a{}');
    act.onCommand = (cmd) => { if (cmd.includes('writeFileSync')) act.files.set('src/index.css', 'b{}'); };
    await dispatcher(act, recorded).dispatch(call('bash', { command: `node -e "require('fs').writeFileSync('src/index.css','b{}')"` }), 'architect');
    expect(recorded.get('src/index.css')).toBe('b{}');
  });

  it('a read-only command records nothing', async () => {
    act.files.set('src/game/candy.css', 'x');
    await dispatcher(act, recorded).dispatch(call('bash', { command: 'grep -n "14px" src/game/candy.css' }), 'architect');
    expect(recorded.has('src/game/candy.css')).toBe(false);
  });

  it('what is read back: written files, never a removed one or a generated folder', () => {
    expect(shellReadBackTargets("sed -i 's/a/b/' src/a.css && echo x > src/b.txt")).toEqual(['src/a.css', 'src/b.txt']);
    expect(shellReadBackTargets('rm src/old.ts')).toEqual([]);
    expect(shellReadBackTargets('cp src/a.ts dist/a.ts && cp x node_modules/y')).toEqual([]);
    expect(shellWriteTargets(`python3 -c "open('src/a.py','w').write('x')"`)).toEqual(['src/a.py']);
    expect(shellWriteTargets(`node -e "fs.writeFileSync(path, s)"`)).toEqual([]); // not knowable from the text
    expect(shellWriteTargets(`node -e "fs.readFileSync('src/a.css')"`)).toEqual([]);
  });
});

describe('2 · a class a script defines in its own stylesheet string is defined', () => {
  it('our own game shell\'s touch controls are not "unstyled"', () => {
    const shell = generateGameShell();
    const files = { ...shell.files, 'src/index.css': '.app { color: red; }' };
    expect(findUndefinedClasses(files).filter((c) => c.startsWith('nbg-tc'))).toEqual([]);
  });

  it('reads CSS inside string literals and never mistakes JavaScript for a rule', () => {
    expect(classesDefinedInScriptStrings("const CSS = ['.knob{left:50%}', '.a .b:hover{color:red}'].join('')")).toEqual(['knob', 'a', 'b']);
    expect(classesDefinedInScriptStrings('api.get({ a: 1 }); if (x.y) { a: 1 }; o.k = { a: 1 }; obj.method() { return 1 }')).toEqual([]);
  });

  it('a script string never makes a project with no stylesheet start reporting', () => {
    expect(findUndefinedClasses({ 'src/A.tsx': "el.className = 'card-title'; const S = '.card-body{margin:0}';" })).toEqual([]);
  });
});

describe('3 · a recipe\'s dependency is installed, not named', () => {
  let act: FakeActuator;
  let recorded: Map<string, string>;
  beforeEach(() => {
    act = new FakeActuator();
    recorded = new Map();
    act.files.set('package.json', JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }));
  });

  it('the game shell (which pulls in the 3D layer) installs three and its types, under the install lock', async () => {
    act.onCommand = (cmd) => {
      if (cmd.includes('npm install')) act.files.set('package.json', JSON.stringify({ dependencies: { react: '^19.0.0', three: '^0.180.0' }, devDependencies: { '@types/three': '^0.180.0' } }));
    };
    const res = await dispatcher(act, recorded).dispatch(call('run_recipe', { name: 'generate_game_shell', input: {} }), 'architect');
    const install = act.commands.find((c) => c.includes('npm install'));
    expect(install).toContain('npm install --no-audit --no-fund three@^0.180.0');
    expect(install).toContain('npm install --no-audit --no-fund -D @types/three@^0.180.0');
    expect(install).toContain('/tmp/nbai-npm-install.lock');
    expect(res.content).toMatch(/📦 Installed @types\/three@\^0\.180\.0, three@\^0\.180\.0 into package\.json/);
    expect(recorded.get('package.json')).toContain('"three"');
  });

  it('any other recipe\'s "Add the dependency" line is replaced by what really happened', async () => {
    const res = await dispatcher(act, recorded).dispatch(call('run_recipe', { name: 'generate_qr', input: {} }), 'architect');
    expect(res.content).not.toMatch(/^Add the dependency:/m);
    expect(res.content).toMatch(/📦 Installed qrcode@/);
    expect(act.commands.some((c) => /npm install --no-audit --no-fund qrcode@/.test(c))).toBe(true);
  });

  it('a busy install is said, never claimed done; an already-listed package is not installed again', async () => {
    act.runCommand = async (_ws: string, cmd: string) => { act.commands.push(cmd); return { exitCode: 0, stdout: RECIPE_DEPS_BUSY_MARKER, stderr: '' }; };
    const busy = await dispatcher(act, recorded).dispatch(call('run_recipe', { name: 'generate_qr', input: {} }), 'architect');
    expect(busy.content).toMatch(/still being installed/);
    expect(busy.content).not.toMatch(/📦 Installed/);
    expect(recipeDependenciesNeeded({ 'a.ts': "import * as T from 'three';" }, JSON.stringify({ dependencies: { three: '1' }, devDependencies: { '@types/three': '1' } }))).toEqual([]);
  });

  it('the line parser, the manifest folder and the install command are exact', () => {
    expect(namedDependencies('x\nAdd the dependency: three@^0.180.0 (and @types/three)\ny')?.deps).toEqual([
      { name: 'three', version: '^0.180.0', dev: false }, { name: '@types/three', version: '^0.180.0', dev: true },
    ]);
    expect(namedDependencies('Add the dependency: @supabase/supabase-js@^2.45.0, zod@^3.23.0')?.deps.map((d) => d.name)).toEqual(['@supabase/supabase-js', 'zod']);
    expect(namedDependencies('No dependency needed.')).toBeNull();
    expect(manifestDirFor(['server/lib/db.ts'], (d) => d === 'server')).toBe('server');
    expect(manifestDirFor(['src/lib/qr.ts'], () => false)).toBe('');
    expect(unlistedDependencies([{ name: 'zod', version: '^3', dev: false }], 'not json')).toBeNull();
    expect(recipeInstallCommand([{ name: 'bad name; rm -rf /', version: '^1.0.0', dev: false }])).toBe('');
  });
});

describe('4 · a name exported by ANOTHER module is an import to fix, not an export to add', () => {
  const e = { file: 'src/game/CandyGame.tsx', line: 4, col: 10, code: 'TS2305', message: `Module '"../audio/melody"' has no exported member 'TUNES'.` } as never;
  const sources = {
    'src/audio/melody.ts': "import { buildTimeline } from './notation';\nexport const melody = 1;",
    'src/audio/tunes.ts': 'export const TUNES: Record<string, number> = {};',
  };

  it('the report\'s own error: the fix is in CandyGame.tsx, and the note names tunes.ts', () => {
    expect(remedyFileFor(e, sources)).toBeNull();
    expect(exportedElsewhere(e, sources)?.exportedBy).toEqual(['src/audio/tunes.ts']);
    const note = writeTypecheckNote([e], ['src/game/CandyGame.tsx'], sources);
    expect(note).toMatch(/`TUNES` is exported by `src\/audio\/tunes\.ts`, not by `src\/audio\/melody\.ts`/);
    expect(note).toMatch(/Do NOT add `TUNES` to `src\/audio\/melody\.ts`/);
    expect(note).not.toMatch(/fixed in ANOTHER file/);
  });

  it('when no other module exports it, the old routing stands (the target must add it)', () => {
    expect(remedyFileFor(e, { 'src/audio/melody.ts': sources['src/audio/melody.ts'] })).toBe('src/audio/melody.ts');
  });

  it('the search is bounded and only ever names identifiers', () => {
    expect(missingExportNames([e])).toEqual(['TUNES']);
    expect(exportSearchCommand(['TUNES'])).toContain('(TUNES)');
    expect(exportSearchCommand(['a; rm -rf /'])).toBe('');
  });
});

describe('(+) the 3D shell is not every game\'s last step', () => {
  it('the prompt and the tool say a 2D board game takes neither the 3D layer nor the shell', () => {
    const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(prompt).toContain('generate_game_shell    — LAST, and ONLY for a game drawn in 3D');
    expect(prompt).toContain('takes NEITHER generate_game_3d NOR generate_game_shell');
    const catalog = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
    expect(catalog).toContain('COMPOSE a runnable 3D game from the other game layers');
  });
});
