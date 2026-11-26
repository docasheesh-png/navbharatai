// ⚡ A REQUEST THE PLATFORM HAS ALREADY COMPLETED DOES NOT RUN THE BUILDER (failedbr #2496, 2026-11-22).
//
// The Game library's "Use as my character" sent its exact instruction. At 9.7 s the platform ran add_library_models, and
// at 20.5 s it set PLAYER.model = 'villager' (PLAYER_CHARACTER_SET): the request was DONE. The turn then ran the whole
// builder loop anyway — 16 model calls (~1 M input tokens), six file reads, two typechecks, two screenshots and an
// unasked edit to a file the growth guard had to put back — and then every finishing pass, for 6.9 minutes under an
// ETA of 7.5–23.5 minutes taken from the project's last complex builds. The user waited minutes for a 20-second change.
//
// 🔎 THE CLASS: a turn whose whole request a deterministic platform action has fully satisfied still runs the builder
// loop, and its ETA is priced as a build. Every platform action that can complete a request on its own at turn start is
// covered here, not only the character: the library character (characterSwap.ts), the library car (carSwap.ts) and the
// library map place (worldGrow.ts) — all three run inside libraryActionsAtTurnStart (growthTurn.ts).
//
// THE RULE:
//   - Only when the request IS the library's own generated instruction, word for word (nothing added), AND the action
//     recorded its success receipt, does the turn finish without the builder: no model call. The real proof is kept —
//     the preview is started, the post-build typecheck gate and the real-browser render proof still run. What stands down:
//     the model reviewer, every finishing pass that writes into the app, the click explorer and the playtest (each said
//     in the report, never silently).
//   - A request with anything more in it runs the builder exactly as before; it is already told (by the action's own
//     handoff) that the action is done and must not be touched.
//   - An action that did not succeed (not in the library, could not be added, a file in a shape it cannot set) never
//     finishes the turn: the builder runs and tells the user, as before. No success is ever claimed for it.
// Kill switch: AGENTV3_PLATFORM_DONE_TURN=off restores the builder loop on every such turn.
import { characterAsked, libraryMovesOf, PLAYER_FILE_PATH } from './characterSwap';
import { carAsked, useAsCarPrompt, CAR_FILE_PATH } from './carSwap';
import { mapPlaceAsked, type PlaceKind } from './worldGrow';
import { WORLD_FILE } from './growthGuard';
import { libraryDisplayName, useAsCharacterPrompt, addToGamePrompt, MAP_PLACE_PREFIX } from './gameAssets/libraryThumbnails';
import { libraryActionsAtTurnStart, addEnemiesAtTurnStart } from './growthTurn';
import { templateRunResult } from './templateVerify';
import { formatEta, formatEtaRange } from '../lib/BuildTimeEstimator';
import { PLATFORM_DONE_TURN_CODE } from './etaHistory';
import { lackedMovesClause } from '../lib/playerMoves';

type Issue = { phase: 'build'; severity: 'info' | 'warning'; code: string; autoResolved: boolean; message: string };

/** The report code a platform-completed turn carries. The ETA history reads it (etaHistory.isTeachableBuild). */
export { PLATFORM_DONE_TURN_CODE };

export function platformDoneTurnEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PLATFORM_DONE_TURN ?? '').trim().toLowerCase() !== 'off';
}

export type PickerRequest =
  | { kind: 'character'; id: string }
  | { kind: 'car'; id: string }
  | { kind: 'map-place'; place: PlaceKind };

const squash = (s: string | null | undefined): string => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/**
 * The library action this request is — ONLY when the request is that action's generated instruction word for word
 * (whitespace aside). A request the user added anything to, or changed, is null: it asks for more than the action does.
 * PURE.
 */
export function pickerOnlyRequest(prompt: string | null | undefined): PickerRequest | null {
  const text = squash(prompt);
  if (!text) return null;
  const characterId = characterAsked(text);
  if (characterId && text === squash(useAsCharacterPrompt({ id: characterId, name: libraryDisplayName(characterId) }))) return { kind: 'character', id: characterId };
  const carId = carAsked(text);
  if (carId && text === squash(useAsCarPrompt({ id: carId, name: libraryDisplayName(carId) }))) return { kind: 'car', id: carId };
  const place = mapPlaceAsked(text);
  if (place && text === squash(addToGamePrompt({ id: `${MAP_PLACE_PREFIX}${place}`, name: place }))) return { kind: 'map-place', place };
  return null;
}

/** The success receipt each action records — and only on success (growthTurn.ts / carSwap.ts). */
export const PLATFORM_ACTION_SUCCESS_CODE: Readonly<Record<PickerRequest['kind'], string>> = Object.freeze({
  character: 'PLAYER_CHARACTER_SET',
  car: 'RACE_CAR_SET',
  'map-place': 'MAP_PLACE_ADDED',
});

export interface PlatformDone {
  kind: PickerRequest['kind'];
  /** The file the platform set (the model it added is recorded by add_library_models itself). */
  changed: string;
  /** What the user is told — plain English, no vendor or model-engine name. */
  message: string;
}

/** What the user is told for a completed action. PURE. */
export function platformDoneMessage(req: PickerRequest): string {
  if (req.kind === 'character') {
    const name = libraryDisplayName(req.id);
    const moves = libraryMovesOf(req.id);
    const movesLine = !moves ? ''
      : moves.has.length === 0 ? ' It has no animations of its own, so NavBharatAI animates its walk, run and actions for it.'
        : ` It has its own animations for: ${moves.has.join(', ')}.${moves.lacks.length ? ` For the rest: ${lackedMovesClause(moves.lacks)}.` : ''}`;
    return `Done — your player character is now ${name}.${movesLine} The map, the controls and everything else are as they were. `
      + 'To bring the default person back, say "wapas purana character".';
  }
  if (req.kind === 'car') {
    return `Done — the car you drive is now the ${libraryDisplayName(req.id)}. It keeps the car's driving; only its look changed, and the track, `
      + 'the rivals and the controls are as they were. If it faces the wrong way, ask for it to be turned around; to bring the standard car back, say "wapas purani gaadi".';
  }
  return `Done — one new ${req.place} is on your map, away from the other places with open country between. Every place already on the map is kept. `
    + 'Ask for more any time.';
}

const CHANGED_FILE: Readonly<Record<PickerRequest['kind'], string>> = Object.freeze({ character: PLAYER_FILE_PATH, car: CAR_FILE_PATH, 'map-place': WORLD_FILE });

/**
 * Did this turn's platform action complete the WHOLE request? Only for a picker-only request whose action recorded its
 * own success receipt, and no refusal. PURE.
 */
export function platformCompletedRequest(prompt: string, recorded: readonly Pick<Issue, 'code'>[], env: NodeJS.ProcessEnv = process.env): PlatformDone | null {
  if (!platformDoneTurnEnabled(env)) return null;
  const req = pickerOnlyRequest(prompt);
  if (!req) return null;
  const codes = recorded.map((r) => r.code);
  if (codes.some((c) => /_NOT_(SET|ADDED)$/.test(c))) return null;
  if (!codes.includes(PLATFORM_ACTION_SUCCESS_CODE[req.kind])) return null;
  return { kind: req.kind, changed: CHANGED_FILE[req.kind], message: platformDoneMessage(req) };
}

/**
 * The library actions at turn start (growthTurn.libraryActionsAtTurnStart), plus the one question the route needs answered
 * after them: is the request now complete? When it is, `done.cur` is set, the report and the user are told, and the
 * preview is started — the builder is not run. Returns the builder's handoff either way. Never throws.
 */
export async function libraryActionsForTurn(io: Parameters<typeof libraryActionsAtTurnStart>[0] & {
  done: { cur: PlatformDone | null };
  narrate: (text: string) => void;
  /** Boots or refreshes the preview through the managed update_preview path (idempotent). */
  startPreview: () => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const recorded: Issue[] = [];
  const picked = await libraryActionsAtTurnStart({ ...io, record: (issue) => { recorded.push(issue); io.record(issue); } });
  // 👾 Enemies the request asks for (GameEnemiesFeature.ts) go in at turn start too — but they are not a picker action: the
  // builder still runs after them (they never finish a turn on their own), so they stay out of the picker composition above.
  const enemies = await addEnemiesAtTurnStart(io);
  const handoff = [picked, enemies].filter(Boolean).join('\n\n');
  try {
    const done = platformCompletedRequest(io.prompt, recorded, io.env);
    if (!done) return handoff;
    io.done.cur = done;
    io.record({ phase: 'build', severity: 'info', code: PLATFORM_DONE_TURN_CODE, autoResolved: true,
      message: `The request was exactly the Game library's own instruction and the platform completed it at turn start (${done.changed}), so the builder `
        + 'loop did not run — no model call was made. The proof is still taken: the preview is started, the project is typechecked and the app is opened in a real browser. Not done on this turn: no control is pressed and the game is not played (the click explorer and the playtest stand down), and no finishing pass writes into the app.' });
    io.narrate(done.message);
    try { await io.startPreview(); } catch { /* the post-build preview proof still runs and says what it found */ }
  } catch { /* deciding this can never fail the turn: the builder runs as before */ }
  return handoff;
}

/** The run result a platform-completed turn stands in for (no model call: zero tokens, zero steps), or the existing one. */
export function platformDoneRunResult<T>(existing: T | undefined, done: PlatformDone | null): T | undefined {
  return templateRunResult(existing, { deliver: done !== null, summary: done?.message ?? '' });
}

/** The ETA band of a picker-only turn: the action, a typecheck and the browser proofs — never a build's history. */
export const PLATFORM_DONE_ETA = Object.freeze({ lowMs: 30_000, estimateMs: 90_000, highMs: 180_000 });

/** `est`, or the short honest band when this request is one the platform completes itself. PURE. */
export function capPlatformDoneEstimate<T extends { estimateMs: number; lowMs: number; highMs: number; etaText?: string }>(est: T, prompt: string, env: NodeJS.ProcessEnv = process.env): T {
  if (!platformDoneTurnEnabled(env) || !pickerOnlyRequest(prompt)) return est;
  return { ...est, ...PLATFORM_DONE_ETA, ...(est.etaText !== undefined ? { etaText: formatEta(PLATFORM_DONE_ETA.estimateMs) } : {}) };
}

/** The opening ETA line for such a turn — says why it is short, never "based on your last builds". PURE. */
export function platformDoneEtaLine(prompt: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!platformDoneTurnEnabled(env) || !pickerOnlyRequest(prompt)) return null;
  const range = formatEtaRange(PLATFORM_DONE_ETA.lowMs, PLATFORM_DONE_ETA.highMs, PLATFORM_DONE_ETA.estimateMs);
  return `⏱️ About ${range} — NavBharatAI makes this change itself, without building anything new, then checks that the game still compiles and opens in a browser.`;
}
