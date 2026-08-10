import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameShell, GAME_SHELL_MODULES } from './GameShellGenerator';
import { generateGameRuntime } from './GameRuntimeGenerator';
import { generateGame3D } from './Game3DGenerator';
import { generateGameController } from './GameControllerGenerator';
import { generateGameVfxAudio } from './GameVfxAudioGenerator';

/**
 * COMPOSITION IS WHERE A FIRST BUILD GOES WRONG.
 *
 * Phases 1–4 are four correct toolkits. Every failure below happens in the wiring between them, is
 * invisible on review, and is obvious the moment somebody plays the game. That is exactly why the
 * wiring is written once here instead of re-derived per build.
 */
const all = generateGameShell();
const game = all.files['src/game/Game.ts'];
const canvas = all.files['src/game/GameCanvas.tsx'];
const hud = all.files['src/game/ui/Hud.tsx'];

describe('the fixed/render split — the bug that makes a game unfair per monitor', () => {
  it('gameplay and the character run in the FIXED update', () => {
    // Physics in render is frame-rate dependent: the character literally jumps higher on 144Hz.
    const fixed = game.slice(game.indexOf('private fixedUpdate'), game.indexOf('private render'));
    expect(fixed).toContain('this.player.update(');
    expect(fixed).toContain('this.options.update?.(this.context, delta)');
    expect(fixed).toContain('this.particles.update(delta)');
  });

  it('the camera runs in RENDER, not the fixed step', () => {
    // In the fixed step the camera stutters on any display that is not exactly 60Hz.
    const render = game.slice(game.indexOf('private render'));
    expect(render).toContain('this.rig.update(p, frameDelta)');
    expect(render).toContain('this.renderer.render(this.scene, this.rig.camera)');

    const fixed = game.slice(game.indexOf('private fixedUpdate'), game.indexOf('private render'));
    expect(fixed).not.toContain('this.rig.update(');
    expect(fixed).not.toContain('this.renderer.render(');
  });

  it('HIT-STOP freezes the simulation but still ticks input', () => {
    // Frozen input swallows the press that happened during the freeze, and the player feels ignored.
    expect(game).toContain('if (!this.feel.frozen)');
    const fixed = game.slice(game.indexOf('private fixedUpdate'), game.indexOf('private render'));
    const frozenAt = fixed.indexOf('if (!this.feel.frozen)');
    const endFrameAt = fixed.indexOf('this.input.endFrame()');
    expect(endFrameAt).toBeGreaterThan(frozenAt);
    // endFrame must sit OUTSIDE the freeze block: between the `if` and endFrame the braces balance,
    // which is only true once that block has closed.
    const between = fixed.slice(frozenAt, endFrameAt).replace(/\/\/.*$/gm, '');
    expect((between.match(/\{/g) || []).length).toBe((between.match(/\}/g) || []).length);
  });

  it('mouse look is consumed BEFORE endFrame clears it', () => {
    // endFrame() zeroes lookX/lookY. Read them in render — which runs after — and the camera never
    // turns at all, which reads as "mouse look is broken".
    const fixed = game.slice(game.indexOf('private fixedUpdate'), game.indexOf('private render'));
    const lookAt = fixed.indexOf('this.rig.look(');
    expect(lookAt).toBeGreaterThan(-1);
    expect(lookAt).toBeLessThan(fixed.indexOf('this.input.endFrame()'));
  });

  it('shake uses the feel defaults — a hand-picked small number is invisible', () => {
    // applyShake already scales into world units (×0.02); passing 0.35 gives a 0.007-unit shake.
    expect(game).toContain('this.rig.applyShake(this.feel.shake())');
  });
});

describe('teardown — the leak that kills the tab', () => {
  it('dispose() releases the WebGL context', () => {
    // Browsers cap live contexts around 16. A game route entered a few times without this takes the
    // whole tab down with "too many contexts".
    expect(game).toContain('this.renderer.dispose()');
  });

  it('dispose() stops the loop, input, audio, particles, geometry and materials', () => {
    const dispose = game.slice(game.indexOf('dispose(): void {'));
    for (const call of [
      'this.loop.stop()',
      'this.input.dispose()',
      'audio.stopAll()',
      'this.particles.dispose()',
      'mesh.geometry.dispose()',
      'disposeMaterials()',
      'events.clear()',
    ]) {
      expect(dispose, `dispose() is missing ${call}`).toContain(call);
    }
  });

  it('dispose() is idempotent and removes its own canvas', () => {
    // React StrictMode and a fast route change both call it twice.
    expect(game).toContain('if (this.disposed) return;');
    expect(game).toContain('this.canvas.parentElement?.removeChild(this.canvas)');
  });

  it('a throwing disposer cannot block the rest of the teardown', () => {
    expect(game).toContain("catch { /* teardown must never throw */ }");
  });
});

describe('the browser realities a hand-written shell forgets', () => {
  it('WEBGL CONTEXT LOSS is prevented and pauses instead of going black forever', () => {
    expect(game).toContain("addEventListener('webglcontextlost'");
    expect(game).toContain('e.preventDefault()');
    expect(game).toContain("addEventListener('webglcontextrestored'");
  });

  it('a backgrounded tab pauses', () => {
    expect(game).toContain("document.addEventListener('visibilitychange'");
    expect(game).toContain('if (document.hidden) this.pause()');
  });

  it('AUDIO IS UNLOCKED once, in the shell', () => {
    // Browsers suspend audio until a gesture. Leaving this to gameplay code is how a game ships silent.
    expect(game).toContain('audio.unlock()');
  });

  it('the canvas takes touch without scrolling the page', () => {
    expect(game).toContain("touchAction = 'none'");
  });

  it('the canvas is focused, or the keyboard is silently ignored', () => {
    // Input binds to the canvas so an embedded game does not swallow the app's keyboard — the cost is
    // that keys only arrive while focused, which reads as "the game does not respond".
    expect(game).toContain('this.canvas.tabIndex = 0');
    expect(game).toContain('this.canvas.focus({ preventScroll: true })');
    expect(game).toContain("this.canvas.addEventListener('pointerdown', refocus)");
  });

  it('the resize is bound to the CONTAINER, not the window', () => {
    expect(game).toContain('handleResize(this.renderer, this.rig.camera, options.container)');
  });

  it('BOTH particle layers are added to the scene', () => {
    expect(game).toContain('this.particles.addTo(this.scene)');
  });

  it('colliders reach BOTH the player and the camera', () => {
    // Given to the player only, the camera clips through every wall.
    expect(game).toContain('this.player.setColliders(colliders)');
    expect(game).toContain('this.rig.setCollidables(colliders)');
  });
});

describe('the React mount', () => {
  it('the effect depends on NOTHING — a parent re-render must not rebuild the world', () => {
    expect(canvas).toContain('}, []);');
    expect(canvas).toContain('const optionsRef = useRef(options)');
  });

  it('cleans up completely, which is what makes StrictMode double-mount safe', () => {
    // React 18 mounts twice in development. Without teardown you get two renderers, two loops and
    // doubled input — the game runs at double speed, in dev only.
    expect(canvas).toContain('instance?.dispose()');
    expect(canvas).toContain('return () => {');
  });

  it('a device with no WebGL gets an honest message, not a blank screen', () => {
    expect(canvas).toContain('catch (err)');
    expect(canvas).toContain('This game needs 3D graphics (WebGL).');
  });

  it('can be embedded instead of fullscreen', () => {
    expect(canvas).toContain('fullscreen = true');
    expect(canvas).toContain("position: 'fixed' as const, inset: 0");
  });
});

describe('the HUD', () => {
  it('updates on EVENTS, never per frame', () => {
    // setState every frame re-renders React 60 times a second and costs more than the game does.
    expect(hud).toContain("'SCORE_CHANGED'");
    expect(hud).toContain('events.on(e, sync)');
    expect(hud).not.toContain('requestAnimationFrame');
  });

  it('syncs once on subscribe — an event fired in between would be missed', () => {
    expect(hud).toContain('sync(); // an event fired between render and subscribe');
  });

  it('unsubscribes, or a remount doubles every update', () => {
    expect(hud).toContain('return () => { for (const off of offs) off(); }');
  });

  it('the health bar is a FRACTION of maxHealth, not a raw percentage', () => {
    // A game with 250 max HP would sit at full for the first 150 damage.
    expect(hud).toContain('(s.health / Math.max(1, s.maxHealth)) * 100');
  });

  it('does not eat clicks meant for the game', () => {
    expect(hud).toContain("pointerEvents: 'none'");
  });

  it('pause and game-over are really wired to the game, not decoration', () => {
    expect(hud).toContain('onClick={() => game.resume()}');
    expect(hud).toContain('onClick={() => game.restart()}');
    expect(hud).toContain("e.key !== 'Escape'");
  });

  it('buttons are thumb-sized', () => {
    expect(hud).toContain('minHeight: 48');
  });
});

/**
 * EVERY API THE SHELL CALLS MUST REALLY EXIST. This is the failure mode the shell is supposed to
 * prevent, so it must not commit it itself — and it nearly did: three of these (rig.yaw, rig
 * setCollidables, player.reset) did not exist until this phase added them.
 */
describe('the shell only calls things the other phases actually export', () => {
  const runtime = Object.values(generateGameRuntime().files).join('\n');
  const three = Object.values(generateGame3D().files).join('\n');
  const controller = Object.values(generateGameController().files).join('\n');
  const fx = Object.values(generateGameVfxAudio().files).join('\n');
  const layers = [runtime, three, controller, fx].join('\n');

  const exportsIt = (needle: string) => layers.includes(needle);

  it('runtime: loop, input, feel, events and state', () => {
    for (const api of [
      'export class GameLoop', 'export class Input', 'export class GameFeel', 'export const events',
      'export function setStatus', 'export function resetRun', 'export interface GameState',
      'get frozen()', 'endFrame(): void', 'axis(): { x: number; y: number }', 'clear(): void',
    ]) expect(exportsIt(api), `runtime is missing ${api}`).toBe(true);
  });

  it('3D: renderer, lighting, camera rig and material disposal', () => {
    for (const api of [
      'export function createRenderer', 'export function handleResize', 'export function applyLighting',
      'export function followShadow', 'export function disposeMaterials', 'export class CameraRig',
      'get yaw(): number', 'setCollidables(list: THREE.Object3D[])', 'applyShake(',
    ]) expect(exportsIt(api), `the 3D layer is missing ${api}`).toBe(true);
  });

  it('controller: the character, its colliders and reset', () => {
    for (const api of [
      'export class CharacterController', 'setColliders(list: THREE.Object3D[])', 'reset(x = 0, y = 0, z = 0)',
    ]) expect(exportsIt(api), `the controller is missing ${api}`).toBe(true);
  });

  it('vfx: particles, audio and the feedback binding', () => {
    for (const api of [
      'export class ParticleSystem', 'addTo(parent: THREE.Object3D)', 'export const audio',
      'setListener(', 'stopAll()', 'export function bindGameFeedback',
    ]) expect(exportsIt(api), `the vfx layer is missing ${api}`).toBe(true);
  });

  it("the camera kind it defaults to is a REAL CameraKind", () => {
    // 'thirdPerson' is not 'third-person'. A silent type mismatch here falls through to the default
    // branch and the camera behaves as a fixed one.
    expect(game).toContain("options.camera ?? 'third-person'");
    expect(three).toContain("'third-person'");
  });

  it('every import path it uses is a file another phase really writes', () => {
    const emitted = new Set([
      ...Object.keys(generateGameRuntime().files),
      ...Object.keys(generateGame3D().files),
      ...Object.keys(generateGameController().files),
      ...Object.keys(generateGameVfxAudio().files),
      ...Object.keys(all.files),
    ]);
    const imports = [...game.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(10);
    for (const rel of imports) {
      const path = `src/game/${rel.replace(/^\.\//, '')}.ts`;
      expect(emitted.has(path), `${rel} is imported but nothing emits ${path}`).toBe(true);
    }
  });
});

describe('the pack itself', () => {
  it('adds no dependency of its own', () => {
    expect(all.dependencies).toEqual([]);
  });

  it('emits every advertised module', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_SHELL_MODULES.length);
  });

  it('a subset that would not compile pulls in what it needs', () => {
    expect(Object.keys(generateGameShell(['hud']).files)).toContain('src/game/Game.ts');
    const fromCanvas = Object.keys(generateGameShell(['gamecanvas']).files);
    expect(fromCanvas).toContain('src/game/Game.ts');
    expect(fromCanvas).toContain('src/game/ui/Hud.tsx');
  });

  it('junk input never throws and falls back to the full pack', () => {
    for (const bad of [undefined, [], ['nope'], [null as unknown as string]]) {
      expect(() => generateGameShell(bad)).not.toThrow();
      expect(Object.keys(generateGameShell(bad).files).length).toBeGreaterThan(0);
    }
    expect(Object.keys(generateGameShell(['nope']).files)).toHaveLength(GAME_SHELL_MODULES.length);
  });

  it('the instructions say what NOT to re-implement', () => {
    const { instructions } = generateGameShell();
    expect(instructions).toContain('FIXED 60Hz');
    expect(instructions).toContain('do not re-implement');
    expect(instructions).toContain('StrictMode');
  });
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_shell'");
    expect(catalog).toContain("  'generate_game_shell',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_shell': {");
    expect(dispatcher).toContain('generateGameShell(gshInclude)');
  });

  it('the description tells the model to call the other four first', () => {
    const at = catalog.indexOf("name: 'generate_game_shell'");
    const def = catalog.slice(at, at + 2500);
    for (const dep of ['generate_game_runtime', 'generate_game_3d', 'generate_game_controller', 'generate_game_vfx']) {
      expect(def).toContain(dep);
    }
  });
});
