import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameRuntime, GAME_RUNTIME_MODULES } from './GameRuntimeGenerator';

/**
 * THE RUNTIME IS WHERE AI-GENERATED GAMES ARE WON OR LOST.
 *
 * Not assets — assets are the visible half. A model asked to hand-roll a loop, input handling and
 * pooling every time reproduces the same four bugs every time, and each one has a name. These tests
 * assert the emitted runtime has already solved them, because every later generator (world, enemies,
 * VFX) is built on top of this and inherits whatever it gets wrong.
 */
const all = generateGameRuntime();
const file = (name: string) => all.files[`src/game/core/${name}.ts`];

describe('the four bugs every hand-rolled game loop has', () => {
  const loop = file('loop');

  it('FIXED TIMESTEP — logic does not run on the display\'s clock', () => {
    // Raw delta makes the same jump reach a different height on 144Hz and on a cheap Android, and one
    // long frame tunnels the player through a wall.
    expect(loop).toContain('while (this.accumulator >= this.step)');
    expect(loop).toContain('this.update(this.step)');
  });

  it('DELTA CLAMP — an alt-tab cannot teleport the player across the level', () => {
    // Without it, returning to a backgrounded tab hands the loop one 60-second frame and it tries to
    // catch up in a single pass, each step making the next delta worse: the spiral of death.
    expect(loop).toContain('if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime');
    expect(loop).toContain('options.maxFrameTime ?? 0.25');
  });

  it('INTERPOLATED RENDER — a fixed logic rate still looks smooth on any monitor', () => {
    expect(loop).toContain('this.accumulator / this.step');
  });

  it('pausing freezes LOGIC but keeps rendering — a paused game is not a black screen', () => {
    expect(loop).toContain('if (!this.paused) {');
    expect(loop).toContain('setPaused');
  });

  it('stop() cancels the frame — a loop left running after teardown burns battery forever', () => {
    expect(loop).toContain('cancelAnimationFrame');
  });
});

describe('input — polled state, not events', () => {
  const input = file('input');

  it('ignores OS auto-repeat, so holding a key is DOWN, not a stream of presses', () => {
    expect(input).toContain('if (e.repeat) return;');
  });

  it('edge-triggered wasPressed is cleared once per frame', () => {
    // Without endFrame, "jump on the frame the key went down" fires for several frames and the player
    // rockets into the sky.
    expect(input).toContain('endFrame()');
    expect(input).toContain('this.pressed.clear()');
  });

  it('NORMALISES diagonals — the classic 1.41x-faster bug', () => {
    expect(input).toContain('const len = Math.hypot(x, y)');
    expect(input).toContain('len > 1 ?');
  });

  it('a tab-switch releases everything, or the player keeps running after they come back', () => {
    expect(input).toContain("addEventListener('blur'");
    expect(input).toContain('this.down.clear()');
  });

  it('touch and gamepad feed the SAME action names as the keyboard', () => {
    // Mobile is not an afterthought: a virtual button is just another code bound to the same action.
    expect(input).toContain('setAnalogueMove');
    expect(input).toContain('setVirtualButton');
  });

  it('detaches its listeners — an undisposed Input keeps the whole scene alive', () => {
    expect(input).toContain('dispose()');
    expect(input).toContain('this.detach.forEach');
  });
});

describe('the event bus — the thing that keeps gameplay from importing VFX', () => {
  const events = file('events');

  it('dispatch iterates a COPY, so a handler may unsubscribe itself mid-emit', () => {
    // Mutating the set during iteration is a real crash in event-driven gameplay.
    expect(events).toContain('for (const h of [...set])');
  });

  it('one throwing listener cannot stop the others', () => {
    // Otherwise a cosmetic particle bug silently kills the gameplay reaction queued behind it.
    expect(events).toContain('try { h(payload); } catch');
  });

  it('on() returns an unsubscribe — a bus you cannot leave is a memory leak', () => {
    expect(events).toContain('return () => { set!.delete(handler); }');
  });
});

describe('pooling — because a GC pause is what makes a browser game feel cheap', () => {
  const pool = file('pool');

  it('reset is separate from create, so a recycled object cannot arrive dirty', () => {
    expect(pool).toContain('this.reset(item)');
  });

  it('a DOUBLE RELEASE is refused — otherwise two callers get the same "new" object', () => {
    expect(pool).toContain('if (!this.live.delete(item)) return;');
  });

  it('iterating actives is snapshot-safe, so an object may despawn during its own update', () => {
    expect(pool).toContain('for (const item of [...this.live])');
  });
});

describe('game feel — the code that makes a hit land', () => {
  const feel = file('feel');

  it('screen shake uses TRAUMA SQUARED, not a raw random offset', () => {
    // A per-frame random offset reads as noise. trauma² makes a big hit punchy and a small one subtle.
    expect(feel).toContain('const amount = this.trauma * this.trauma');
  });

  it('trauma is ADDED and capped, so overlapping hits stack instead of overwriting', () => {
    expect(feel).toContain('Math.min(1, this.trauma + Math.max(0, amount))');
  });

  it('shake is DETERMINISTIC — a replay or a test reproduces it exactly', () => {
    // Also means it does not depend on Math.random, which a host page may have stubbed.
    expect(feel).toContain('xorshift32');
    // Comments MENTION Math.random to explain the choice; strip them so only real code is asserted.
    const code = feel.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('Math.random');
  });

  it('hit-stop exists and takes the LONGER of two overlapping freezes', () => {
    expect(feel).toContain('addHitStop');
    expect(feel).toContain('Math.max(this.hitStopRemaining');
  });

  it('damp() is frame-rate independent — the lerp everyone writes is not', () => {
    // `a + (b-a)*0.1` per frame moves twice as fast at 120fps as at 60. Camera follow needs exp decay.
    expect(feel).toContain('Math.exp(-lambda * delta)');
  });

  it('ships easing curves — linear motion reads as robotic', () => {
    for (const fn of ['outQuad', 'outCubic', 'inOutCubic', 'outBack', 'outElastic']) {
      expect(feel).toContain(fn);
    }
  });
});

describe('state and save', () => {
  const state = file('state');

  it('the save excludes TRANSIENT state — status and health are not progress', () => {
    // Writing mid-run rendering state produces a save that breaks the moment the renderer changes.
    expect(state).toContain('const { status, health, ...durable } = state');
  });

  it('a save from an older version still loads instead of leaving fields undefined', () => {
    expect(state).toContain('Object.assign(state, initialState(), parsed');
  });

  it('a blocked or full localStorage never crashes the game', () => {
    expect(state).toContain('} catch { return false; }');
  });

  it('resetRun keeps what should SURVIVE a death — high score, unlocks, settings', () => {
    expect(state).toContain('const { highScore, unlocked, settings } = state');
  });

  it('state changes EMIT, so the HUD never has to poll every frame', () => {
    expect(state).toContain("events.emit('PLAYER_DAMAGED'");
    expect(state).toContain("events.emit('SCORE_CHANGED'");
  });
});

describe('the pack itself', () => {
  it('adds NO dependency — no engine, no physics lib, no bundle cost', () => {
    expect(all.dependencies).toEqual([]);
    const source = Object.values(all.files).join('\n');
    for (const lib of ['three', 'babylon', 'phaser', 'cannon', 'rapier', 'matter-js']) {
      expect(source).not.toContain(`from '${lib}`);
    }
  });

  it('is engine-AGNOSTIC, so the same runtime serves a 2D canvas and a 3D scene', () => {
    // The 3D layer can then be swapped without touching gameplay code.
    const source = Object.values(all.files).join('\n');
    expect(source).not.toContain('THREE.');
    expect(source).not.toContain('WebGLRenderer');
  });

  it('emits every advertised module', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_RUNTIME_MODULES.length);
    for (const m of GAME_RUNTIME_MODULES) expect(all.files[`src/game/core/${m}.ts`]).toBeTruthy();
  });

  it('a subset that would not compile pulls in what it imports', () => {
    const files = Object.keys(generateGameRuntime(['state']).files);
    expect(files).toContain('src/game/core/events.ts'); // state imports it
  });

  it('an unmatched or empty filter falls back to the full pack', () => {
    expect(Object.keys(generateGameRuntime(['nonsense']).files)).toHaveLength(GAME_RUNTIME_MODULES.length);
    expect(Object.keys(generateGameRuntime([]).files)).toHaveLength(GAME_RUNTIME_MODULES.length);
  });

  it('junk input never throws', () => {
    for (const bad of [undefined, [], ['', '  '], [null as unknown as string]]) {
      expect(() => generateGameRuntime(bad)).not.toThrow();
    }
  });

  it('the instructions name the rules that keep it feeling good', () => {
    const { instructions } = generateGameRuntime();
    expect(instructions).toContain('never in render');
    expect(instructions).toContain('input.endFrame()');
    expect(instructions).toContain('Never allocate in the loop');
    expect(instructions).toContain('addTrauma');
  });
});

/**
 * THE WIRING. Twice this session a real capability shipped with no way to reach it — a Render deploy
 * engine with no caller, a palette AI nothing could call — and once a tool was registered while the
 * system prompt forbade using it. A generator the builder cannot invoke is dead code.
 */
describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_runtime'");
    expect(catalog).toContain("  'generate_game_runtime',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_runtime': {");
    expect(dispatcher).toContain('generateGameRuntime(grInclude)');
    expect(dispatcher).toContain('grWritten.push');
  });

  it('the description tells the model NOT to hand-roll the loop', () => {
    // That instruction is the whole point: left to itself the model writes the raw-delta version.
    const at = catalog.indexOf("name: 'generate_game_runtime'");
    const def = catalog.slice(at, at + 2000);
    expect(def).toContain('DO NOT hand-roll');
    expect(def).toContain('never in render');
  });

  it('and promises no dependency, matching what the generator actually does', () => {
    const at = catalog.indexOf("name: 'generate_game_runtime'");
    expect(catalog.slice(at, at + 2000)).toContain('NO dependency is added');
    expect(generateGameRuntime().dependencies).toEqual([]);
  });
});
