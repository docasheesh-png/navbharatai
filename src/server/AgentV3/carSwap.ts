// 🏁 A CAR PICKED IN THE GAME LIBRARY IS SET BY THE PLATFORM ITSELF (admin 2026-11-22, verbatim: "user puri racing game ko
// bhi AI se modified karwa sake, jaise chahe sab free hand do!").
//
// The racing sibling of characterSwap.ts. In a race on the kit's starter (<RacingRoadGame>) the player's car is ONE file of
// the game, src/game/car.ts (export const CAR), which the starter reads by itself (kit play/raceCustom.ts). The library's
// "Use as my car" sends one exact request naming one exact model: nothing about it needs a model's judgement, so the
// platform adds that model to the game, sets CAR.model — one line, or the whole small file when the game has none yet — and
// tells the builder it is done. Where it cannot (not a library model, not added, the file no longer in a shape it can set
// safely, not a race on the starter), NOTHING is changed on a guess: the builder is told exactly what happened and to say so.
// PURE except setLibraryCarAtTurnStart, which acts only through the ports it is given.
import { librarySubjectOf, modelWasAdded, type SetModelResult } from './characterSwap';
import { libraryDisplayName, MAP_PLACE_PREFIX } from './gameAssets/libraryThumbnails';
import { MY_CAR_FEATURE_PATH, myCarFeatureSource, setMyCarModel, myCarAddedHandoff } from '../lib/GameMyCarFeature';
import { featuresIndexWith, FEATURES_INDEX_PATH } from '../lib/GameEnemiesFeature';

export const CAR_FILE_PATH = 'src/game/car.ts';
export const TRACK_FILE_PATH = 'src/game/track.ts';

/** Is this project a race on the kit's starter (the only game that reads src/game/car.ts)? */
export function racesOnTheStarter(files: Readonly<Record<string, string>> | null | undefined): boolean {
  return /<RacingRoadGame\b/.test(String(files?.['src/App.tsx'] ?? ''));
}

/** The library id in the request "Use as my car" sends (useAsCarPrompt). Exactly that shape. */
export function carAsked(prompt: string | null | undefined): string | null {
  const m = /the car I drive in my racing game \(library id: "([^"\n]{1,160})"\)/.exec(String(prompt ?? ''));
  return m ? m[1] : null;
}

/** The instruction the library screen puts in the composer for "Use as my car". A map place is not a car, so it has none. */
export function useAsCarPrompt(row: { id: string; name: string }): string | null {
  if (row.id.startsWith(MAP_PLACE_PREFIX)) return null;
  return `Make the ${row.name} from the NavBharatAI library the car I drive in my racing game (library id: "${row.id}"). Replace only my car; keep the track, the rivals, the controls and everything else as it is.`;
}

/** The game's own car file, as the platform writes it when the game has none yet. Mirrors src/game/player.ts. */
/** `color`: the car's starting paint (a new race gets one fixed by its project: projectVariety.ts starterCarPaint). */
export function raceCarFile(model: string | null = null, color = 0xb42b2b): string {
  return [
    "// THIS RACE'S CAR — the car you drive. RacingRoadGame reads this file by itself (src/game/play/raceCustom.ts).",
    '// color is the standard car\'s paint (0xRRGGBB). To drive a 3D model instead, set model to a file of this project',
    "// ('public/models/my-car.glb' — where an attached model lands) or to a library model this game has saved ('sports car');",
    '// modelLength is its size in metres, modelYaw turns it (180 if it drives backwards). tuning is how it drives:',
    '// maxSpeed in m/s (25 is about 90 km/h), accel, brake, steerRate. Set model back to null for the standard car.',
    "import type { CarChoice } from './play/raceCustom';",
    '',
    'export const CAR: CarChoice = {',
    `  color: 0x${(Math.floor(Number(color)) >>> 0 & 0xffffff).toString(16).padStart(6, '0')},`,
    `  model: ${model === null ? 'null' : `'${model}'`},`,
    '  modelLength: 4.3,',
    '};',
    '',
  ].join('\n');
}

/** `source` (or a fresh car file when there is none) with CAR.model set to this subject; every other byte kept. */
export function setCarModel(source: string | null | undefined, subject: string): SetModelResult {
  if (source === null || source === undefined) return { ok: true, changed: true, source: raceCarFile(subject) };
  const text = String(source);
  const lines = [...text.matchAll(/^([ \t]*model:[ \t]*)(null|'[^'\n]*'|"[^"\n]*")([ \t]*,?[ \t]*)$/gm)];
  if (!/export const CAR\b/.test(text) || lines.length !== 1) return { ok: false };
  const [whole, lead, , tail] = lines[0];
  const next = `${lead}'${subject}'${tail}`;
  return { ok: true, changed: next !== whole, source: text.slice(0, lines[0].index!) + next + text.slice(lines[0].index! + whole.length) };
}

const NO_GUESS = 'Do NOT choose a different model, do NOT restyle the car and do NOT change any file on a guess.';

export function carSetHandoff(name: string, subject: string): string {
  return `[DONE BY THE PLATFORM — the user's car] The user picked "${name}" in the Game library as the car they drive. The platform has already `
    + `added that model to the game and set CAR.model = '${subject}' in ${CAR_FILE_PATH}; RacingRoadGame reads that file by itself, keeps the car's `
    + `driving and sizes the model to the car. Do not edit ${CAR_FILE_PATH}, src/App.tsx, the track or the rivals for this request, and do not add the model `
    + 'again. Check that the game still runs, then tell the user in their language that their car was changed, that "gaadi ulti chal rahi hai" is fixed '
    + 'with CAR.modelYaw: 180, and that "wapas purani gaadi" brings the standard car back.';
}
export function carNotSetHandoff(name: string, why: string): string {
  return `[NOT DONE — the user's car] The user picked "${name}" in the Game library as the car they drive, and the platform could not set it: ${why}. `
    + `${NO_GUESS} Tell the user plainly, in their language, that the car was not changed and why, and ask what they would like instead.`;
}

type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

/**
 * "Use as my car" at the start of a turn: add the exact model, set CAR.model, return what the builder is told. '' when this
 * turn is not that request. Never throws.
 */
export async function setLibraryCarAtTurnStart(io: {
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  addModel: (id: string) => Promise<string>;
  record: (issue: Issue) => void;
}): Promise<string> {
  const id = carAsked(io.prompt);
  if (!id || !io.filesAtTurnStart) return '';
  const name = libraryDisplayName(id);
  const refuse = (why: string) => {
    io.record({ phase: 'build', severity: 'info', code: 'RACE_CAR_NOT_SET', autoResolved: true, message: `The library car "${name}" was not set as the player's car: ${why}. Nothing was changed; the user is told and asked.` });
    return carNotSetHandoff(name, why);
  };
  try {
    const subject = librarySubjectOf(id);
    if (!subject) return refuse('it is not a model in the NavBharatAI library');
    if (!racesOnTheStarter(io.filesAtTurnStart)) {
      // 🚗 NOT A RACE IS NOT A REFUSAL (admin 2026-11-26: "police car choose ki par woh bhi nahi ayi … yah car available nahi hai").
      // A game on the kit's features list (the open world) gets the car as a feature: drivable, in front of the player.
      if (typeof io.filesAtTurnStart[FEATURES_INDEX_PATH] !== 'string') return refuse('this game is neither a race on NavBharatAI\'s racing starter nor an open-world game on the kit\'s features list, so it has no car the platform can set');
      const got = await io.addModel(id).catch((error) => `failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!modelWasAdded(got, subject)) return refuse(`the model could not be added to the game (${got.replace(/\s+/g, ' ').slice(0, 220)})`);
      const had = io.filesAtTurnStart[MY_CAR_FEATURE_PATH];
      const next = typeof had === 'string' ? setMyCarModel(await io.read(MY_CAR_FEATURE_PATH), subject) : myCarFeatureSource(subject);
      if (next === null) return refuse(`the model is in the game now (subject '${subject}'), but ${MY_CAR_FEATURE_PATH} is no longer in the shape the platform can set safely`);
      await io.write(MY_CAR_FEATURE_PATH, next);
      if (typeof had !== 'string') {
        const listed = featuresIndexWith(await io.read(FEATURES_INDEX_PATH), 'myCar');
        if (listed !== null) await io.write(FEATURES_INDEX_PATH, listed);
      }
      io.record({ phase: 'build', severity: 'info', code: 'MY_CAR_ADDED', autoResolved: true, message: `The platform put the library car "${name}" the user picked in the open-world game as a drivable car (${MY_CAR_FEATURE_PATH}, MY_CAR.model = '${subject}').` });
      return myCarAddedHandoff(name, subject);
    }
    const receipt = await io.addModel(id).catch((error) => `failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!modelWasAdded(receipt, subject)) return refuse(`the model could not be added to the game (${receipt.replace(/\s+/g, ' ').slice(0, 220)})`);
    // A missing file is a fresh car file; a read that FAILS for another reason is not "missing" — nothing is written over it.
    let live: string | null = null;
    try { live = await io.read(CAR_FILE_PATH); }
    catch (error) {
      if (!/ENOENT|not found|no such file/i.test(String((error as { message?: string })?.message ?? error))) return refuse(`${CAR_FILE_PATH} could not be read`);
    }
    const set = setCarModel(live, subject);
    if (!set.ok) return refuse(`the model is in the game now (subject '${subject}'), but ${CAR_FILE_PATH} is no longer in the shape the platform can set safely`);
    if (set.changed) await io.write(CAR_FILE_PATH, set.source);
    io.record({ phase: 'build', severity: 'info', code: 'RACE_CAR_SET', autoResolved: true, message: `The platform set the library car "${name}" the user picked as the car they drive (CAR.model = '${subject}' in ${CAR_FILE_PATH}).` });
    return carSetHandoff(name, subject);
  } catch (error) { return refuse(`an unexpected error (${error instanceof Error ? error.message : String(error)})`); }
}
