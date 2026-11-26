// 🧍 A CHARACTER PICKED IN THE GAME LIBRARY IS SET BY THE PLATFORM ITSELF (failedbr #2485, Q-3229; admin 2026-11-21:
// "andaze se kuch bhi change/update na ho. Jab bhi baat clear na ho, to user se puch li jaye").
//
// The library's "Use as my character" sends one exact request naming one exact model. Nothing about it needs a model's
// judgement: the platform adds that model to the game, sets PLAYER.model in src/game/player.ts — one line — and tells the
// builder it is done. Where it cannot be done (the model is not in the library, could not be added, or the file is no
// longer in the shape the platform wrote), nothing is changed on a guess: the builder is told exactly what happened and
// to say so to the user. PURE: no I/O here (growthTurn.ts carries it).
//
// 🌍 EVERY GAME, NOT ONLY THE OPEN WORLD (admin 2026-11-22). The file was written only by the open-world mount, and a game
// without it got NOTHING from this step — the request went to the builder unanswered. Every game on the kit's shell reads
// src/game/player.ts by itself now (play/playerBody.ts), so the platform creates the file where the shell can read it, and
// says plainly where a game has no character to swap (a racing game's player is its car; a first-person game shows none).
import { REVIEWED_GAME_ASSETS } from './gameAssets/providers';
import { PLAYER_MOVES, playerMovesLine } from '../lib/playerMoves';

export const PLAYER_FILE_PATH = 'src/game/player.ts';
/** The kit shell that reads src/game/player.ts by itself carries this call (GameShellGenerator.ts). */
export const SHELL_READS_PLAYER_FILE = 'resolvePlayerChoice(';
export const GAME_SHELL_PATH = 'src/game/Game.ts';

/** The library id in the request the library screen sends (libraryThumbnails.useAsCharacterPrompt). Exactly that shape. */
export function characterAsked(prompt: string | null | undefined): string | null {
  const m = /my game's player character \(library id: "([^"\n]{1,160})"\)/.exec(String(prompt ?? ''));
  return m ? m[1] : null;
}

/** The subject a library model is saved under in a game (what loadRequestedAsset is called with), or null if not in the library. */
export function librarySubjectOf(id: string, catalogue: ReadonlyArray<{ id: string; subjects: readonly string[] }> = REVIEWED_GAME_ASSETS): string | null {
  const subject = catalogue.find((c) => c.id === id)?.subjects[0];
  return typeof subject === 'string' && /^[\w -]{1,80}$/.test(subject) ? subject : null;
}

/**
 * The player moves a library model plays: its reviewed animation roles (what the game's handle.play(role) answers to).
 * null when the model is not in the library. PURE.
 */
export function libraryMovesOf(id: string, catalogue: ReadonlyArray<{ id: string; animationRoles?: Readonly<Record<string, string>> }> = REVIEWED_GAME_ASSETS): { has: string[]; lacks: string[] } | null {
  const entry = catalogue.find((c) => c.id === id);
  if (!entry) return null;
  const roles = new Set(Object.keys(entry.animationRoles ?? {}));
  return { has: PLAYER_MOVES.filter((m) => roles.has(m)), lacks: PLAYER_MOVES.filter((m) => m !== 'land' && !roles.has(m)) };
}

/**
 * Why this game has no character the platform can swap, or null when it has one. Read from the game's own files: a racing
 * game's player is its car (the car is a separate path, not this one); the royale practice is first-person. PURE.
 */
export function characterNotSwappable(files: Readonly<Record<string, string>>): string | null {
  const app = String(files['src/App.tsx'] ?? '');
  if (/<RacingRoadGame\b/.test(app)) return 'this is a racing game, and its player is the car, not a character — a library character cannot be set as the car from here';
  // RoyaleGame is the Practice + Online switcher (2026-11-25); both modes are first-person.
  if (/<Royale(?:Practice|Game)\b/.test(app)) return 'this game is played in first person, so the player has no body on screen to replace';
  return null;
}

/** Did add_library_models say THIS subject is now in the game? Reads the tool's own receipt. */
export function modelWasAdded(receipt: string, subject: string): boolean {
  const m = /^Added to the game from the NavBharatAI library: ([^.]*)\./.exec(String(receipt ?? ''));
  return !!m && m[1].split(',').map((s) => s.trim()).includes(subject);
}

export type SetModelResult = { ok: true; source: string; changed: boolean } | { ok: false };

const ONE_VALUE_LINE = (key: string) => new RegExp(`^([ \\t]*${key}:[ \\t]*)(null|'[^'\\n]*'|"[^"\\n]*")([ \\t]*,?[ \\t]*)$`, 'gm');

/**
 * `source` with PLAYER.model set to this subject — and PLAYER.file (the user's own model, which wins over model) set to
 * null, so the pick is what the game shows; every other byte kept. Not ok when the file has no single `model:` line to set
 * (or more than one `file:` line).
 */
export function setPlayerModel(source: string, subject: string): SetModelResult {
  const text = String(source ?? '');
  const lines = [...text.matchAll(ONE_VALUE_LINE('model'))];
  const files = [...text.matchAll(ONE_VALUE_LINE('file'))];
  if (!/export const PLAYER\b/.test(text) || lines.length !== 1 || files.length > 1) return { ok: false };
  const edits = [{ at: lines[0], value: `'${subject}'` }, ...files.map((at) => ({ at, value: 'null' }))].sort((a, b) => b.at.index! - a.at.index!);
  let out = text;
  for (const { at, value } of edits) {
    const [whole, lead, , tail] = at;
    out = out.slice(0, at.index!) + `${lead}${value}${tail}` + out.slice(at.index! + whole.length);
  }
  return { ok: true, changed: out !== text, source: out };
}

const NO_GUESS = 'Do NOT choose a different model, do NOT restyle the character and do NOT change any file on a guess.';

export function characterSetHandoff(name: string, subject: string, moves?: { has: readonly string[]; lacks: readonly string[] } | null): string {
  return `[DONE BY THE PLATFORM — the user's character] The user picked "${name}" in the Game library as the character they play as. The platform has `
    + `already added that model to the game and set PLAYER.model = '${subject}' in ${PLAYER_FILE_PATH}. Do not edit ${PLAYER_FILE_PATH}, src/App.tsx, the map, `
    + 'the controls or any feature for this request, and do not add the model again. The game reads that file by itself. Check that the game still runs, then tell '
    + 'the user in their language that the character was changed, '
    + (moves ? `that it plays ${playerMovesLine(moves.has, moves.lacks)}, ` : 'that it has only the moves the model was made with, ')
    + 'and that "wapas purana character" brings the default person back.';
}
export function characterNotSetHandoff(name: string, why: string): string {
  return `[NOT DONE — the user's character] The user picked "${name}" in the Game library as the character they play as, and the platform could not set it: ${why}. `
    + `${NO_GUESS} Tell the user plainly, in their language, that the character was not changed and why, and ask what they would like instead `
    + '(another library model, or a different look for the default person).';
}
