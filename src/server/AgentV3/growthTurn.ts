// The two moments of a turn where the growth guard and the library's place-add act — kept out of the route's handler,
// which reads and writes through the small ports below (routes/agentv3.ts is one very large function; a step that can be
// a call is a call).
import { growthGuardEnabled, growsByLists, growthProtectedPaths, growthRestores, growthUserNote, growthAskNote, WORLD_FILE, FEATURES_INDEX, partsKnown, requestIsAbout } from './growthGuard';
import { PART_NAMES_FILE, rememberPartNames } from './partMeaning';
import { mapPlaceAsked, appendPlace, placeAddedHandoff, placeNotAddedHandoff, MAX_PLACES } from './worldGrow';
import { characterAsked, librarySubjectOf, modelWasAdded, setPlayerModel, characterSetHandoff, characterNotSetHandoff, PLAYER_FILE_PATH } from './characterSwap';
import { libraryDisplayName } from './gameAssets/libraryThumbnails';

type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

/**
 * GROWTH GUARD, lock 2: whatever door a change came through, every protected file is compared with what it was when the
 * turn began; a change the request did not ask for is put back, and the report and the user are told. Never throws.
 */
export async function enforceGrowthAtTurnEnd(io: {
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  request: string;
  /** Resolves the content, or rejects; a clean "not found" means the file is gone, any other failure means "unknown". */
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  platformWrote: ReadonlyMap<string, string>;
  refused: readonly string[];
  /** Every path written this turn (the platform's and the builder's) — how a NEW part is known. */
  written?: readonly string[];
  record: (issue: Issue) => void;
  say: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<{ restored: string[]; blocked: string[] }> {
  const none = { restored: [] as string[], blocked: [] as string[] };
  try {
    // A first build has nothing to guard yet, but the parts it makes are still filed under the user's words.
    if (!io.filesAtTurnStart || !growthGuardEnabled(io.env) || !growsByLists(io.filesAtTurnStart)) { await rememberWhatTheUserCalledIt(io); return none; }
    const now: Record<string, string | null> = {};
    for (const p of growthProtectedPaths(io.filesAtTurnStart)) {
      // A read that FAILS is not a deleted file: only a clean "not found" counts as gone; anything else is left unjudged.
      try { const c = await io.read(p); if (typeof c === 'string') now[p] = c; }
      catch (error) { if (/ENOENT|not found|no such file/i.test(String((error as { message?: string })?.message ?? error))) now[p] = null; }
    }
    const restores = growthRestores({ filesAtTurnStart: io.filesAtTurnStart, now, request: io.request, platformWrote: io.platformWrote });
    const put: typeof restores = [];
    for (const r of restores) {
      try { await io.write(r.path, r.restore); put.push(r); } catch { /* reported below as not put back */ }
    }
    if (restores.length > 0) {
      io.record({ phase: 'build', severity: 'warning', code: 'GROWTH_GUARD_RESTORED', autoResolved: put.length === restores.length,
        message: `This turn changed ${restores.length} file(s) of the game that the request did not ask to change; ${put.length} put back as they were: ${restores.slice(0, 8).map((r) => `${r.path} (${r.reason})`).join('; ')}${restores.length > 8 ? ` and ${restores.length - 8} more` : ''}.` });
      const note = growthUserNote(put);
      if (note) { try { io.say(note.trim()); } catch { /* the report still says it */ } }
    }
    // 🔓 And the user is never left stuck: what the builder wanted to change and could not is named, with the words that
    // allow it — said by the platform, whether or not the builder mentioned it.
    const blocked = [...new Set([...io.refused, ...restores.map((r) => r.path)])];
    const ask = growthAskNote(blocked);
    if (ask) {
      io.record({ phase: 'build', severity: 'info', code: 'GROWTH_GUARD_ASKED', autoResolved: true, message: `The user was told which working part(s) this turn would have changed and how to allow it: ${blocked.slice(0, 8).join(', ')}.` });
      try { io.say(ask.trim()); } catch { /* the report still says it */ }
    }
    await rememberWhatTheUserCalledIt(io);
    return { restored: put.map((r) => r.path), blocked };
  } catch { return none; }   // a guard that cannot run leaves the turn exactly as it was
}

/**
 * 📒 THE USER'S OWN WORDS ARE REMEMBERED (partMeaning.ts). A part made this turn is filed under what the user asked for
 * ("sipahi daalo jo peecha kare" → police.ts), and a part the user's request was about is filed under those words too —
 * so the next time they say it their way, the platform knows which part they mean. Best-effort; never fails a turn.
 */
async function rememberWhatTheUserCalledIt(io: Parameters<typeof enforceGrowthAtTurnEnd>[0]): Promise<void> {
  try {
    const start = io.filesAtTurnStart ?? {};
    if (typeof start[FEATURES_INDEX] !== 'string' && !(io.written ?? []).includes(FEATURES_INDEX)) return;
    const idOf = (p: string): string | null => { const m = /^src\/game\/features\/([^/]+)\.tsx?$/.exec(p); return m && m[1] !== 'index' ? m[1] : null; };
    const made = (io.written ?? []).filter((p) => !(p in start)).map(idOf).filter((id): id is string => !!id);
    const known = partsKnown(start);
    const spokenOf = [...known.keys()].filter((id) => requestIsAbout(io.request, id, known));
    const ids = [...new Set([...made, ...spokenOf])];
    if (ids.length === 0) return;
    let current: string | undefined;
    try { current = await io.read(PART_NAMES_FILE); } catch { current = start[PART_NAMES_FILE]; }
    const next = rememberPartNames(current, ids, io.request);
    if (next !== current) await io.write(PART_NAMES_FILE, next);
  } catch { /* remembering is a help, never a condition */ }
}

/**
 * A place picked in the Game Library (worldGrow.ts): the platform adds the entry itself, from the file as it is NOW, and
 * returns what the builder is told. '' when this turn is not that request, or there is no map file. Never throws.
 */
export async function addLibraryPlaceAtTurnStart(io: {
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  record: (issue: Issue) => void;
}): Promise<string> {
  try {
    const kind = mapPlaceAsked(io.prompt);
    if (!kind || !io.filesAtTurnStart || typeof io.filesAtTurnStart[WORLD_FILE] !== 'string') return '';
    const live = await io.read(WORLD_FILE).then((c) => (typeof c === 'string' ? c : null), () => null);
    if (live === null) return '';
    const added = appendPlace(live, kind);
    if (added.ok) {
      await io.write(WORLD_FILE, added.source);
      io.record({ phase: 'build', severity: 'info', code: 'MAP_PLACE_ADDED', autoResolved: true, message: `The platform added the ${kind} "${added.id}" the user picked in the library to the game's map (${added.count} place(s) now) — no model call made this change.` });
      return placeAddedHandoff(kind, added.id, added.count);
    }
    if (added.reason === 'full') {
      io.record({ phase: 'build', severity: 'info', code: 'MAP_PLACE_NOT_ADDED', autoResolved: true, message: `The map already holds its ${MAX_PLACES} places, so the ${kind} picked in the library was not added; the user is told.` });
      return placeNotAddedHandoff(kind);
    }
    return '';
  } catch { return ''; }   // the builder still has the request and the rule
}

/**
 * A character picked in the Game Library (characterSwap.ts): the platform adds that exact model and sets PLAYER.model
 * itself, then returns what the builder is told. Where it cannot, NOTHING is changed on a guess and the builder is told to
 * say so and ask. '' when this turn is not that request, or the game has no player file. Never throws.
 */
export async function setLibraryCharacterAtTurnStart(io: {
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  /** Runs add_library_models for this exact library id and resolves its receipt. */
  addModel: (id: string) => Promise<string>;
  record: (issue: Issue) => void;
}): Promise<string> {
  const id = characterAsked(io.prompt);
  if (!id || !io.filesAtTurnStart || typeof io.filesAtTurnStart[PLAYER_FILE_PATH] !== 'string') return '';
  const name = libraryDisplayName(id);
  const refuse = (why: string) => {
    io.record({ phase: 'build', severity: 'info', code: 'PLAYER_CHARACTER_NOT_SET', autoResolved: true, message: `The library character "${name}" was not set as the player: ${why}. Nothing was changed; the user is told and asked.` });
    return characterNotSetHandoff(name, why);
  };
  try {
    const subject = librarySubjectOf(id);
    if (!subject) return refuse('it is not a model in the NavBharatAI library');
    const receipt = await io.addModel(id).catch((error) => `failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!modelWasAdded(receipt, subject)) return refuse(`the model could not be added to the game (${receipt.replace(/\s+/g, ' ').slice(0, 220)})`);
    const live = await io.read(PLAYER_FILE_PATH).then((c) => (typeof c === 'string' ? c : null), () => null);
    const set = live === null ? { ok: false as const } : setPlayerModel(live, subject);
    if (!set.ok) return refuse(`the model is in the game now (subject '${subject}'), but ${PLAYER_FILE_PATH} is no longer in the shape the platform can set safely`);
    if (set.changed) await io.write(PLAYER_FILE_PATH, set.source);
    io.record({ phase: 'build', severity: 'info', code: 'PLAYER_CHARACTER_SET', autoResolved: true, message: `The platform set the library character "${name}" the user picked as the player (PLAYER.model = '${subject}').` });
    return characterSetHandoff(name, subject);
  } catch (error) { return refuse(`an unexpected error (${error instanceof Error ? error.message : String(error)})`); }
}
