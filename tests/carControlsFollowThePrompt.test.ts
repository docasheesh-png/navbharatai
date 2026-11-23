// 🚗 THE CAR CONTROLS FOLLOW THE USER'S WORDS (admin 2026-11-23: no forced hardcore joystick; the
// controls follow the prompt). The request names how the car is driven → the game turn says touchControls: { drive } → the kit's
// pads, tilt, auto-gas or joystick. A joystick only when asked for, never when refused. PURE.
import { describe, it, expect } from 'vitest';
import { driveControlsFromWords, driveControlsLine, gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

describe('driveControlsFromWords', () => {
  it.each([
    ['racing game banao, phone tilt karke car chalao', 'tilt'],
    ['car ko phone jhuka ke chalana hai', 'tilt'],
    ['gyro steering wali racing game', 'tilt'],
    ['make a car game with a joystick', 'joystick'],
    ['joystick se gaadi chalao', 'joystick'],
    ['easy controls wali car race', 'auto'],
    ['auto gas, sirf steering karna ho', 'auto'],
    ['make it auto accelerate, I only steer', 'auto'],
    ['buttons se car chalao', 'pads'],
  ])('%s → %s', (text, want) => {
    expect(driveControlsFromWords(text)).toBe(want);
  });
  it.each([
    ['car control hardcore joystick se nahi honi chahiye'],
    ['no joystick please, just make a racing game'],
    ['make a simple racing game'],
    ['cricket game banao'],
    [''],
  ])('names no control (or refuses the joystick): %s → null', (text) => {
    expect(driveControlsFromWords(text)).toBeNull();
  });
  it('the turn carries the line only when the words name a control', () => {
    expect(driveControlsLine('phone tilt karke car chalao')).toMatch(/touchControls: \{ drive: 'tilt' \}/);
    expect(driveControlsLine('make a racing game')).toBe('');
    const files = {};
    const on = gameTurnHandoff('racing game with tilt steering', files, { writingRun: true, moduleTurn: false, importTurn: false, stopped: false });
    expect(on.block).toMatch(/drive: 'tilt'/);
    const off = gameTurnHandoff('racing game banao', files, { writingRun: true, moduleTurn: false, importTurn: false, stopped: false });
    expect(off.block).not.toMatch(/CAR CONTROLS THE USER ASKED FOR/);
  });
});

describe('the kit tells the builder', () => {
  it('the shell instructions map the words to touchControls.drive, and the joystick only on request', () => {
    const shell = generateGameShell();
    expect(shell.instructions).toMatch(/touchControls: \{ drive \}/);
    expect(shell.instructions).toMatch(/drive: 'joystick'\\n?\s*\(ONLY when the user asks for a joystick\)|ONLY when the user asks for a joystick/);
    expect(shell.files['src/game/ui/touchControls.ts']).toMatch(/export type DriveControls = 'pads' \| 'tilt' \| 'auto' \| 'joystick'/);
  });
});
