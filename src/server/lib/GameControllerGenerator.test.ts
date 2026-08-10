import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameController, GAME_CONTROLLER_MODULES } from './GameControllerGenerator';

/**
 * THE SMALL DELIBERATE LIES THAT MAKE A GAME FEEL GOOD.
 *
 * A controller can be physically correct and still feel awful. Every one of these looks like a bug on
 * paper, which is exactly why a from-scratch implementation leaves them out — and why the result feels
 * unresponsive in a way the player cannot name.
 *
 * The motor is PURE arithmetic precisely so these are assertions rather than something a human has to
 * sense in a browser.
 */
const all = generateGameController();
const motor = all.files['src/game/play/motor.ts'];
const character = all.files['src/game/play/character.ts'];

describe('coyote time — "I pressed jump and nothing happened"', () => {
  it('the jump window survives leaving the ground', () => {
    // Most players press jump a frame or two after walking off a ledge. Without this they get nothing.
    expect(motor).toContain('coyoteTime: number');
    expect(motor).toContain('s.timeSinceGrounded <= config.coyoteTime');
  });

  it('is ~0.1s — long enough to forgive, short enough to be invisible', () => {
    expect(motor).toContain('coyoteTime: 0.1');
  });

  it('does NOT apply on a too-steep slope, or the player wall-jumps off cliffs', () => {
    expect(motor).toContain('const canCoyote = s.timeSinceGrounded <= config.coyoteTime && slopeOk');
  });
});

describe('jump buffering — pressing early must not be punished', () => {
  it('a jump pressed before landing is remembered', () => {
    expect(motor).toContain('jumpBufferTime: number');
    expect(motor).toContain('s.timeSinceJumpPressed <= config.jumpBufferTime');
  });

  it('BOTH windows are consumed on jump, or one press double-jumps', () => {
    // The single most likely bug in this code: leave either window open and the next frame re-fires.
    const at = motor.indexOf('s.jumping = true;');
    const block = motor.slice(at, at + 400);
    expect(block).toContain('s.timeSinceJumpPressed = 999');
    expect(block).toContain('s.timeSinceGrounded = 999');
  });
});

describe('the rest of the feel', () => {
  it('VARIABLE JUMP HEIGHT — releasing early cuts the arc', () => {
    // One fixed jump arc is the clearest sign of a first attempt.
    expect(motor).toContain('if (s.jumping && !input.jumpHeld && s.vy > 0) s.vy *= config.jumpCutMultiplier');
  });

  it('AIR CONTROL is a separate number from ground acceleration', () => {
    // Full air control feels floaty; none feels like a punishment. It has to be tunable on its own.
    expect(motor).toContain('airAcceleration: number');
    expect(motor).toContain('const accel = standing ? config.groundAcceleration : config.airAcceleration');
  });

  it('friction is EXPONENTIAL, not a fixed subtraction', () => {
    // A fixed subtraction overshoots past zero at low speed and the character jitters in place.
    expect(motor).toContain('const decay = Math.exp(-friction * delta)');
  });

  it('GROUND SNAP keeps the character on slopes instead of launching off bumps', () => {
    expect(motor).toContain('s.vy = -2');
  });

  it('a SLOPE steeper than the limit cannot be stood on', () => {
    expect(motor).toContain('const slopeOk = groundNormalY >= Math.cos((config.maxSlopeDegrees * Math.PI) / 180)');
  });

  it('terminal velocity is capped — a long drop must not tunnel through the floor', () => {
    expect(motor).toContain('if (s.vy < config.terminalVelocity) s.vy = config.terminalVelocity');
  });

  it('gravity is stronger than reality, because real gravity feels sluggish in a game', () => {
    expect(motor).toContain('gravity: -24');
  });

  it('sprint clamps to the SPRINT target, not silently back to walk speed', () => {
    expect(motor).toContain('const target = config.maxSpeed * (input.sprint ? config.sprintMultiplier : 1)');
    expect(motor).toContain('if (speed > target)');
  });
});

describe('the motor is genuinely pure — that is what makes the above testable', () => {
  it('imports nothing', () => {
    expect(motor).not.toContain("import ");
  });

  it('never mutates its input state', () => {
    // A caller must be able to predict or rewind a step.
    expect(motor).toContain('const s: MotorState = { ...prev }');
  });

  it('reports the frames a jump and a landing HAPPENED, not just the key press', () => {
    // Landing dust belongs on the landing, not on the button.
    expect(motor).toContain('jumped: boolean');
    expect(motor).toContain('landed: boolean');
    expect(motor).toContain('const landed = grounded && !prev.grounded');
  });
});

describe('the three.js side — raycasts only', () => {
  it('the ground ray has SKIN WIDTH, or grounded flickers and the jump breaks', () => {
    // A ray starting exactly at the feet intermittently misses through float error; the character then
    // flickers between grounded and airborne, which also destroys coyote time.
    expect(character).toContain('const skin = 0.1');
    expect(character).toContain('add(new THREE.Vector3(0, skin, 0))');
  });

  it('X and Z are resolved SEPARATELY, so the player slides along a wall', () => {
    // Blocking both because one is obstructed is what makes a character stick to walls at an angle.
    expect(character).toContain('tryAxis(this.state.vx * delta, 0)');
    expect(character).toContain('tryAxis(0, this.state.vz * delta)');
  });

  it('the wall ray starts at MID-BODY — a foot-height ray walks through a table top', () => {
    expect(character).toContain('this.height * 0.5');
  });

  it('STEP OFFSET climbs small ledges instead of snagging on every kerb', () => {
    expect(character).toContain('stepTop <= this.stepOffset');
  });

  it('still plays with no colliders yet — a scene under construction is not a crash', () => {
    expect(character).toContain('if (this.colliders.length === 0)');
  });

  it('EMITS rather than calling VFX directly', () => {
    expect(character).toContain("events.emit('PLAYER_JUMPED')");
    expect(character).toContain("events.emit('PLAYER_LANDED'");
  });
});

describe('the pack itself', () => {
  it('adds no dependency of its own', () => {
    expect(all.dependencies).toEqual([]);
  });

  it('emits every advertised module, and a subset still compiles', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_CONTROLLER_MODULES.length);
    expect(Object.keys(generateGameController(['character']).files)).toContain('src/game/play/motor.ts');
  });

  it('junk input never throws and falls back to the full pack', () => {
    for (const bad of [undefined, [], ['nope'], [null as unknown as string]]) {
      expect(() => generateGameController(bad)).not.toThrow();
    }
    expect(Object.keys(generateGameController(['nope']).files)).toHaveLength(GAME_CONTROLLER_MODULES.length);
  });

  it('the instructions explain WHY, so nobody "simplifies" the feel away', () => {
    const { instructions } = generateGameController();
    expect(instructions).toContain('COYOTE TIME');
    expect(instructions).toContain('JUMP BUFFERING');
    expect(instructions).toContain('do not "simplify" these away');
  });
});

/**
 * THE WIRING. Four times this session a capability shipped that nothing could reach, or that the prompt
 * forbade using. A generator the builder cannot invoke is dead code.
 */
describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_controller'");
    expect(catalog).toContain("  'generate_game_controller',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_controller': {");
    expect(dispatcher).toContain('generateGameController(gcInclude)');
  });

  it('the description names the feel rules, so the model does not strip them', () => {
    const at = catalog.indexOf("name: 'generate_game_controller'");
    const def = catalog.slice(at, at + 2000);
    expect(def).toContain('coyote time');
    expect(def).toContain('jump buffering');
  });
});
