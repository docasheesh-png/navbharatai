/**
 * BUILD 46e2d74b (admin 2026-10-11) — L-07 and the residual vehicle note, at the dispatcher.
 *
 * The racing game hand-wrote `import * as THREE from 'three'`. `three` is a package the game recipes
 * declare, and since candy report 7da1cdca a recipe's packages are installed by the platform — but only
 * when a RECIPE wrote the import. A hand-written import of the same package got nothing, and the model
 * ran `npm install three @types/three` itself, after fourteen writes. These tests drive the real
 * ToolDispatcher with a fake sandbox.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, MAX_DEFERRED_IMPORT_INSTALLS, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { RECIPE_DEPS_BUSY_MARKER } from '../src/server/AgentV3/tscCommand';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) {
    this.commands.push(cmd);
    if (cmd.includes('npm install --no-audit --no-fund three@')) {
      const pkg = JSON.parse(this.files.get('package.json') ?? '{}');
      this.files.set('package.json', JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, three: '^0.180.0' }, devDependencies: { ...pkg.devDependencies, '@types/three': '^0.180.0' } }));
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: `t${++n}`, name, input });

function dispatcher(act: FakeActuator, recorded: Map<string, string>): ToolDispatcher {
  const stream = new AgentEventStream();
  return new ToolDispatcher(
    act, 'ws-racer', new WorkspaceState(stream), stream,
    undefined, undefined, undefined, undefined, undefined, undefined,
    (path, content) => { recorded.set(path, content); },
  );
}

const SCENE = "import * as THREE from 'three';\nexport const scene = new THREE.Scene();\n";

describe('L-07 · a hand-written import of a package a recipe declares is installed at the write', () => {
  let act: FakeActuator;
  let recorded: Map<string, string>;
  beforeEach(() => {
    act = new FakeActuator();
    recorded = new Map();
    act.files.set('package.json', JSON.stringify({ name: 'racer', dependencies: { react: '^18.3.1' } }));
  });

  it('three and its types are installed under the install lock, recorded, and said in the write\'s result', async () => {
    const res = await dispatcher(act, recorded).dispatch(call('write_file', { path: 'src/lib/game/scene.ts', content: SCENE }), 'architect');
    const install = act.commands.find((c) => c.includes('npm install'));
    expect(install).toContain('npm install --no-audit --no-fund three@^0.180.0');
    expect(install).toContain('npm install --no-audit --no-fund -D @types/three@^0.180.0');
    expect(install).toContain('/tmp/nbai-npm-install.lock');
    expect(res.content).toMatch(/📦 Installed @types\/three@\^0\.180\.0, three@\^0\.180\.0 into package\.json/);
    expect(recorded.get('package.json')).toContain('"three"');
  });

  it('🔒 Q-862: a busy install is said ONCE, retried silently on the next writes, and installed when the lock is free', async () => {
    // The background install holds the lock: our install stands down and the package stays unlisted.
    let busy = true;
    const real = act.runCommand.bind(act);
    act.runCommand = async (ws: string, cmd: string) => {
      if (busy) { act.commands.push(cmd); return { exitCode: 0, stdout: RECIPE_DEPS_BUSY_MARKER, stderr: '' }; }
      return real(ws, cmd);
    };
    const d = dispatcher(act, recorded);
    const first = await d.dispatch(call('write_file', { path: 'src/lib/game/scene.ts', content: SCENE }), 'architect');
    expect(first.content).toMatch(/still being installed/);
    expect(first.content).not.toMatch(/📦 Installed/);
    // Still busy: retried, but not said again.
    const second = await d.dispatch(call('write_file', { path: 'src/lib/game/objects.ts', content: SCENE }), 'architect');
    expect(second.content).not.toMatch(/still being installed|📦/);
    expect(act.commands.filter((c) => c.includes('npm install')).length).toBe(2);
    // The background install finished: the next write installs it, says so, and records the manifest.
    busy = false;
    const third = await d.dispatch(call('write_file', { path: 'src/lib/game/hud.ts', content: SCENE }), 'architect');
    expect(third.content).toMatch(/📦 Installed @types\/three@\^0\.180\.0, three@\^0\.180\.0 into package\.json/);
    expect(recorded.get('package.json')).toContain('"three"');
    // Done: nothing is tried again.
    const before = act.commands.length;
    await d.dispatch(call('write_file', { path: 'src/lib/game/more.ts', content: SCENE }), 'architect');
    expect(act.commands.slice(before).some((c) => c.includes('npm install'))).toBe(false);
  });

  it('a lock that never frees is retried at most MAX_DEFERRED_IMPORT_INSTALLS times, then left to the note', async () => {
    act.runCommand = async (_ws: string, cmd: string) => { act.commands.push(cmd); return { exitCode: 0, stdout: RECIPE_DEPS_BUSY_MARKER, stderr: '' }; };
    const d = dispatcher(act, recorded);
    for (let i = 0; i < MAX_DEFERRED_IMPORT_INSTALLS + 3; i++) {
      await d.dispatch(call('write_file', { path: `src/lib/game/f${i}.ts`, content: SCENE }), 'architect');
    }
    expect(act.commands.filter((c) => c.includes('npm install')).length).toBe(MAX_DEFERRED_IMPORT_INSTALLS);
  });

  it('a FAILED install is still one attempt per package per build', async () => {
    act.runCommand = async (_ws: string, cmd: string) => { act.commands.push(cmd); return { exitCode: 1, stdout: '', stderr: 'E404' }; };
    const d = dispatcher(act, recorded);
    const first = await d.dispatch(call('write_file', { path: 'src/lib/game/scene.ts', content: SCENE }), 'architect');
    expect(first.content).toMatch(/failed \(npm exit 1\)/);
    await d.dispatch(call('write_file', { path: 'src/lib/game/objects.ts', content: SCENE }), 'architect');
    expect(act.commands.filter((c) => c.includes('npm install')).length).toBe(1);
  });

  it('NEGATIVE: an import nobody declares is never guessed at, and a listed package is not installed again', async () => {
    await dispatcher(act, recorded).dispatch(call('write_file', { path: 'src/util.ts', content: "import _ from 'lodash';\nexport const x = _.noop;\n" }), 'architect');
    expect(act.commands.some((c) => c.includes('npm install'))).toBe(false);
    act.files.set('package.json', JSON.stringify({ dependencies: { three: '^0.170.0' }, devDependencies: { '@types/three': '^0.170.0' } }));
    await dispatcher(act, recorded).dispatch(call('write_file', { path: 'src/lib/game/scene.ts', content: SCENE }), 'architect');
    expect(act.commands.some((c) => c.includes('npm install'))).toBe(false);
  });
});

describe('the residual vehicle note reaches the builder at write time, once per build', () => {
  it('the camera in one write and the motion in the next meet; the note names the kit', async () => {
    const act = new FakeActuator();
    act.files.set('package.json', JSON.stringify({ dependencies: { three: '^0.180.0' }, devDependencies: { '@types/three': '^0.180.0' } }));
    const d = dispatcher(act, new Map());
    const first = await d.dispatch(call('write_file', { path: 'src/lib/game/scene.ts', content: 'export function follow(camera, car) {\n  camera.position.z = car.position.z + 6;\n  camera.lookAt(car.position);\n}\n' }), 'architect');
    expect(first.content).not.toContain('HAND-WRITTEN VEHICLE');
    const second = await d.dispatch(call('write_file', { path: 'src/lib/game/controls.ts', content: 'export function updateGameState(car, state, dt) {\n  car.position.z += Math.cos(car.rotation.y) * state.speed * dt;\n}\n' }), 'architect');
    expect(second.content).toContain('🏎️ HAND-WRITTEN VEHICLE');
    expect(second.content).toContain('src/lib/game/scene.ts: `camera.position.z = car.position.z + 6;`');
    expect(second.content).toContain('run_recipe({ name: "generate_game_3d" })');
    const third = await d.dispatch(call('write_file', { path: 'src/lib/game/hud.ts', content: 'camera.position.z = car.position.z + 9;\n' }), 'architect');
    expect(third.content).not.toContain('HAND-WRITTEN VEHICLE');
  });
});
