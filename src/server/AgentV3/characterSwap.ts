// 🧍 A CHARACTER PICKED IN THE GAME LIBRARY IS SET BY THE PLATFORM ITSELF (failedbr #2485, Q-3229; admin 2026-11-21:
// "andaze se kuch bhi change/update na ho. Jab bhi baat clear na ho, to user se puch li jaye").
//
// The library's "Use as my character" sends one exact request naming one exact model. Nothing about it needs a model's
// judgement: the platform adds that model to the game, sets PLAYER.model in src/game/player.ts — one line — and tells the
// builder it is done. Where it cannot be done (the model is not in the library, could not be added, or the file is no
// longer in the shape the platform wrote), nothing is changed on a guess: the builder is told exactly what happened and
// to say so to the user. PURE: no I/O here (growthTurn.ts carries it).
import { REVIEWED_GAME_ASSETS } from './gameAssets/providers';

export const PLAYER_FILE_PATH = 'src/game/player.ts';

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

/** Did add_library_models say THIS subject is now in the game? Reads the tool's own receipt. */
export function modelWasAdded(receipt: string, subject: string): boolean {
  const m = /^Added to the game from the NavBharatAI library: ([^.]*)\./.exec(String(receipt ?? ''));
  return !!m && m[1].split(',').map((s) => s.trim()).includes(subject);
}

export type SetModelResult = { ok: true; source: string; changed: boolean } | { ok: false };

/** `source` with PLAYER.model set to this subject; every other byte kept. Not ok when the file has no single `model:` line to set. */
export function setPlayerModel(source: string, subject: string): SetModelResult {
  const text = String(source ?? '');
  const lines = [...text.matchAll(/^([ \t]*model:[ \t]*)(null|'[^'\n]*'|"[^"\n]*")([ \t]*,?[ \t]*)$/gm)];
  if (!/export const PLAYER\b/.test(text) || lines.length !== 1) return { ok: false };
  const [whole, lead, , tail] = lines[0];
  const next = `${lead}'${subject}'${tail}`;
  return { ok: true, changed: next !== whole, source: text.slice(0, lines[0].index!) + next + text.slice(lines[0].index! + whole.length) };
}

const NO_GUESS = 'Do NOT choose a different model, do NOT restyle the character and do NOT change any file on a guess.';

export function characterSetHandoff(name: string, subject: string): string {
  return `[DONE BY THE PLATFORM — the user's character] The user picked "${name}" in the Game library as the character they play as. The platform has `
    + `already added that model to the game and set PLAYER.model = '${subject}' in ${PLAYER_FILE_PATH}. Do not edit ${PLAYER_FILE_PATH}, src/App.tsx, the map, `
    + 'the controls or any feature for this request, and do not add the model again. Check that the game still runs, then tell the user in their language that '
    + 'the character was changed, that it has only the moves the model was made with, and that "wapas purana character" brings the default person back.';
}
export function characterNotSetHandoff(name: string, why: string): string {
  return `[NOT DONE — the user's character] The user picked "${name}" in the Game library as the character they play as, and the platform could not set it: ${why}. `
    + `${NO_GUESS} Tell the user plainly, in their language, that the character was not changed and why, and ask what they would like instead `
    + '(another library model, or a different look for the default person).';
}
