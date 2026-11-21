// The two moments of a turn where the growth guard and the library's place-add act — kept out of the route's handler,
// which reads and writes through the small ports below (routes/agentv3.ts is one very large function; a step that can be
// a call is a call).
import { growthGuardEnabled, growsByLists, growthProtectedPaths, growthRestores, growthUserNote, growthAskNote, WORLD_FILE } from './growthGuard';
import { mapPlaceAsked, appendPlace, placeAddedHandoff, placeNotAddedHandoff, MAX_PLACES } from './worldGrow';

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
  record: (issue: Issue) => void;
  say: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<{ restored: string[]; blocked: string[] }> {
  const none = { restored: [] as string[], blocked: [] as string[] };
  try {
    if (!io.filesAtTurnStart || !growthGuardEnabled(io.env) || !growsByLists(io.filesAtTurnStart)) return none;
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
    return { restored: put.map((r) => r.path), blocked };
  } catch { return none; }   // a guard that cannot run leaves the turn exactly as it was
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
