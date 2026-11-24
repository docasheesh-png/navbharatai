/**
 * Locked plan item 1 (admin 2026-11-24; weakness audit P0-4): a comment is not a game feature.
 *
 * Every check that decides a fact about a generated game from its source used to read raw text, comments included:
 * the scope match ("did we build what the user asked for?"), the canvas-game detector, the replay facts (progress,
 * restart, sound), the driving detector, the DOM-game kind, and the keyboard-only note. One helper,
 * `withoutComments` (src/server/lib/codeOnly.ts), now feeds all of them. Strings and templates are kept: UI text
 * that proves a feature lives in them. Fixtures are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutComments } from '../src/server/lib/codeOnly';
import { scopeMatch, buildGameContract } from '../src/server/AgentV3/gameIntent';
import { isCanvasGameProject, replayFromCode, isDrivingGame } from '../src/server/AgentV3/gamePlaytest';
import { isKeyboardOnlyGame } from '../src/server/AgentV3/touchPlayableGame';

const ROOT = join(__dirname, '..');

describe('withoutComments', () => {
  it('blanks line and block comments, keeps strings and templates, keeps length and lines', () => {
    const src = "const a = 'http://x'; // levels\n/* enemies */ const t = `Level ${n} // not a comment`;\n";
    const out = withoutComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).toContain("'http://x'");
    expect(out).toContain('`Level ${n} // not a comment`');
    expect(out).not.toMatch(/levels|enemies/);
  });
});

describe('🔴 the scope match: a comment does not satisfy what the user asked for', () => {
  const contract = buildGameContract('make a shooter game with levels and enemies and a score');
  it('the contract asks for levels and enemies', () => {
    expect(contract.requiredFeatures).toEqual(expect.arrayContaining(['levels', 'enemies']));
  });
  it('TODO comments are reported missing', () => {
    const files = { 'src/Game.ts': '// TODO: levels\n/* enemies come later */\nexport const score = 0;\n' };
    const m = scopeMatch(contract, files);
    expect(m.missing).toEqual(expect.arrayContaining(['levels', 'enemies']));
  });
  it('real code is still present (neighbour)', () => {
    const files = { 'src/Game.ts': 'export const levels = [1, 2, 3];\nexport const enemies: Enemy[] = [];\nexport let score = 0;\n' };
    const m = scopeMatch(contract, files);
    expect(m.missing).not.toEqual(expect.arrayContaining(['levels']));
    expect(m.present).toEqual(expect.arrayContaining(['levels', 'enemies']));
  });
  it('🔴 real code named the way code is written counts: plurals and camelCase', () => {
    const files = { 'src/Game.ts': 'let currentLevel = 1;\nfunction spawnEnemy() {}\nfunction addScore(n: number) {}\n' };
    expect(scopeMatch(contract, files).present).toEqual(expect.arrayContaining(['levels', 'enemies', 'score']));
  });
  it('UI text in a template still counts (strings are kept)', () => {
    const files = { 'src/Hud.tsx': 'export const Hud = ({ n }: { n: number }) => <p>{`Level ${n}`}</p>;\n' };
    expect(scopeMatch(contract, files).present).toContain('levels');
  });
});

describe('🔒 siblings: every code-fact reader ignores comments', () => {
  it('replayFromCode: a commented restart is not a restart', () => {
    expect(replayFromCode({ 'src/Game.ts': '// restart button: later\nexport const x = 1;\n' }).restart).toBe(false);
    expect(replayFromCode({ 'src/Game.tsx': 'export const B = () => <button>Play again</button>;\n' }).restart).toBe(true);
  });
  it('isDrivingGame: a car in a comment does not make a driving game', () => {
    const commented = { 'src/Game.ts': '// car speed with ArrowUp accelerate\nexport const x = 1;\n' };
    expect(isDrivingGame(commented)).toBe(false);
    expect(isDrivingGame({ 'src/Game.ts': "let car = { speed: 0 };\nif (key === 'ArrowUp') car.speed += 1;\n" })).toBe(true);
  });
  it('isCanvasGameProject: a commented canvas and loop is not a canvas game', () => {
    expect(isCanvasGameProject({ 'src/App.tsx': '// <canvas> + requestAnimationFrame later\nexport default () => null;\n' })).toBe(false);
  });
  it('isKeyboardOnlyGame: a TODO about touch does not make the game touch-ready', () => {
    const src = "// TODO: add touchstart\nrequestAnimationFrame(loop);\nwindow.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') x--; });\n";
    expect(isKeyboardOnlyGame('src/Game.ts', src)).toBe(true);
  });
  it('census: each reader file calls withoutComments', () => {
    for (const f of ['src/server/AgentV3/gameIntent.ts', 'src/server/AgentV3/gamePlaytest.ts', 'src/server/AgentV3/touchPlayableGame.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/withoutComments\(/);
    }
  });
});
