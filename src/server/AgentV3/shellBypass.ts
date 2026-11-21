// A 3D GAME THAT SKIPS THE SHELL LOSES EVERYTHING THE SHELL GIVES (admin 2026-11-20, "aur kya missing hai game me").
//
// Evidence: builds #2475, #2476 and #2477 (all "pubg / bgmi jaisa", all asking for a JOYSTICK). The game kit's shell was
// laid down every time — src/game/Game.ts and src/game/GameCanvas.tsx — and every time the builder ignored it and wrote
// `new THREE.WebGLRenderer()` and its own requestAnimationFrame loop in a component of its own. The shell is where the
// touch joystick and buttons, the start screen, the pause menu, the settings, the HUD, the music, the minimap and the
// action poses live, so all of it silently vanished: #2476 shipped a d-pad whose touch handlers were "empty functions",
// off-screen; #2477's on-screen arrows "changed nothing". The architect prompt already said "mount <GameCanvas>"; a
// sentence in a prompt lost three times out of three. The only signal was an end-of-build line ("kit component(s) this
// game does not use: GameCanvas") that names the file but not the consequence, read after the code is done.
//
// 🧬 THE FIX: the code the builder writes is checked. When the shell is in the project, and a file of the game's own
// creates its own WebGL renderer (or a react-three-fiber <Canvas>), and nothing of the game's own mounts the shell, the
// builder is told AT ONCE, while the file is open, what it is throwing away and the exact way back — and the build's
// readiness report carries it as a warning. A 2D canvas game, a board game, or any game when the shell was never seeded
// is never flagged (Q-2715: a game may legitimately draw its own canvas).
// PURE: no I/O.

import { isGameOwnSource } from './actionVisibility';
import { GAME_STARTER_ALTERNATION } from '../lib/gameStarters';

export interface ShellHalves {
  /** This file creates a renderer of its own. */
  ownRenderer: boolean;
  /** This file mounts or constructs the kit's shell. */
  usesShell: boolean;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const OWN_RENDERER = /\bnew\s+(?:THREE\s*\.\s*)?WebGLRenderer\s*\(|from\s+['"]@react-three\/fiber['"]/;
const USES_SHELL = new RegExp(String.raw`<\s*(?:GameCanvas|${GAME_STARTER_ALTERNATION})\b|\bnew\s+Game\s*\(|from\s+['"][^'"]*\/(?:GameCanvas|${GAME_STARTER_ALTERNATION})(?:\.tsx?)?['"]`);

/** One file's contribution; a file that is not the game's own source contributes nothing. */
export function shellHalves(path: string, content: string): ShellHalves {
  const p = String(path ?? '').replace(/^\.?\//, '');
  if (!isGameOwnSource(p)) return { ownRenderer: false, usesShell: false };
  const src = stripComments(String(content ?? ''));
  return { ownRenderer: OWN_RENDERER.test(src), usesShell: USES_SHELL.test(src) };
}

export interface ShellBypassFinding { files: string[] }

/**
 * The shell is in the project, some of the game's own files build their own renderer, and none of them uses the shell;
 * null otherwise. shellPresent = src/game/GameCanvas.tsx exists (the 3D shell was seeded or written by its recipe).
 */
export function shellBypassFinding(index: ReadonlyMap<string, ShellHalves>, shellPresent: boolean): ShellBypassFinding | null {
  if (!shellPresent) return null;
  const all = [...index.entries()];
  if (all.some(([, h]) => h.usesShell)) return null;
  const own = all.filter(([, h]) => h.ownRenderer).map(([p]) => p).sort();
  return own.length ? { files: own } : null;
}

const WHAT_IS_LOST = 'the touch joystick and buttons (a phone player cannot move at all), the start screen, the pause menu, '
  + 'the settings, the HUD, the music, the minimap and the action poses';

/** The repair note, said while the file is open. */
export function shellBypassNote(f: ShellBypassFinding): string {
  return `\n\n🎮 THIS GAME SKIPS THE KIT'S SHELL: ${f.files.join(', ')} create${f.files.length === 1 ? 's' : ''} a WebGL renderer of its own, `
    + 'and nothing mounts src/game/GameCanvas.tsx — so the game loses ' + WHAT_IS_LOST + '. Put the game on the shell instead: '
    + 'render <GameCanvas setup={(ctx) => { /* build the world on ctx.scene, return its updatables */ }} update={(ctx, dt) => { /* rules */ }} /> '
    + '(or new Game({ container, setup, update }) from src/game/Game.ts), delete your own renderer, camera and requestAnimationFrame loop, '
    + 'and keep only the game\'s own world and rules. Its touch controls, menus and HUD then come with it.';
}

/** The readiness warning, at the end of the build. */
export function shellBypassWarning(f: ShellBypassFinding): string {
  return `GAME SHELL SKIPPED: ${f.files.join(', ')} build${f.files.length === 1 ? 's' : ''} a renderer of its own and nothing mounts `
    + '<GameCanvas> — the game has none of ' + WHAT_IS_LOST + '. Mount <GameCanvas setup update /> and drop the hand-written renderer and loop.';
}
