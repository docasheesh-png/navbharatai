// GAME ENGINE ULTRA — PHASE 3: REPAIR A GAME THE PLAYTEST PROVED BROKEN, AND NEVER CALL IT DONE WHILE IT IS.
//
// Inputs are Phase 2's measured defects (`playtestDefects`, gamePlaytest.ts) and Phase 1's scope gap
// (`scopeMatch`, gameIntent.ts). Nothing here guesses: a repair is KEPT only when the game is played again
// and has strictly fewer hard defects and no new ones; otherwise it is undone (the explorer repair's rule,
// explorerRepair.ts). The orchestration is pure over injected I/O, so every branch is unit-tested.
//
// Automatic repair is suspended: the current text-only, best-effort snapshot cannot
// prove rollback preserves binary, excluded, oversized, unreadable or unlisted files.
// No environment value re-enables it. Normal building/playtesting and the completion
// gate remain unchanged. See docs/security/game-auto-repair-suspension.md.
// The ONE in-build game repair that does run is separate and narrower: the bounded
// placeholder repair (gamePlaceholderRepair.ts, Q-3374, admin-approved 2026-11-26) —
// missing model / empty map only, file tools only, a byte-exact verified backup
// (gameWorkspaceBackup.ts) as its way back. It never calls this module's repair.
//
// 🚦 THE GATE defaults on: a game whose final play still shows a HARD defect (blank, ignored input, no touch,
// stuck start, runtime error, wrong camera, stalled vehicle, or missing game-kit layer) or lacks a feature
// the user named is not reported shippable — the release gate goes RED with the reason. It never flips
// result.ok and never touches a bill. Set AGENTV3_GAME_COMPLETE_GATE=off to disable.

import type { GameDefect, GameDefectCode } from './gamePlaytest';

export const GAME_REPAIR_PASS = 'game-repair';

export const GAME_AUTO_REPAIR_SUSPENSION_REASON = 'Automatic game repair is suspended until complete byte-preserving backup and verified rollback are available; no repair or rollback was started';
export function gameAutoRepairEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return false;
}
export function gameCompleteGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_COMPLETE_GATE ?? '').trim().toLowerCase() !== 'off';
}

/** Defects that mean the game cannot be played — what the gate holds on and what a repair must reduce. */
export const HARD_DEFECTS: ReadonlySet<GameDefectCode> = new Set([
  'GAME_DEFECT_BLANK', 'GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_NO_TOUCH', 'GAME_DEFECT_START_STUCK',
  'GAME_DEFECT_RUNTIME_ERROR', 'GAME_DEFECT_CAMERA_WRONG', 'GAME_DEFECT_VEHICLE_STALLED', 'GAME_DEFECT_MISSING_LAYER',
]);

/** Every measured defect the repair can address. */
const FIX_HINT: Readonly<Record<GameDefectCode, string>> = {
  GAME_DEFECT_ASK_NOT_MET: 'What the user asked for in this request is not in the played game (its evidence is in "measured"): enemies that were not alive near the hero, or an item that was not in the hero\'s hand. Make it real with the kit (Entities.spawnAround for enemies; add_library_models then PLAYER.holds for a held item), and never claim it is there until it is.',
  GAME_DEFECT_NOT_SHOWN: 'The game said a model or item the code asks for could not be shown (its exact words are in "measured") — usually a library subject that was never added. Call add_library_models with that subject, then use the EXACT subject it was saved under (PLAYER.model / PLAYER.holds / the race car or track file). If the library has no such model, tell the user plainly and never claim it is shown.',
  GAME_DEFECT_START_STUCK: 'Pressing the start control shows no game surface — make the start control mount and start the game.',
  GAME_DEFECT_BLANK: 'The game surface is blank or one colour — draw the world and the player.',
  GAME_DEFECT_INPUT_IGNORED: 'Arrow keys/WASD/Space/drag change nothing — wire input from src/game/core into the update loop.',
  GAME_DEFECT_NO_TOUCH: 'On a phone a drag or tap does nothing and there are no on-screen controls — add touch controls.',
  GAME_DEFECT_RUNTIME_ERROR: 'An uncaught error is thrown while playing — fix it at its root: find the value that is undefined and why. Never wrap the line in try/catch or add a `|| {}` default — that hides the error and the game stays broken (autopsy 7aa2fe7c / c71e56de).',
  GAME_DEFECT_CAMERA_WRONG: 'The camera faces the vehicle or steering is mirrored — use ctx.follow / CameraRig.follow and driveVehicle from the kit.',
  GAME_DEFECT_VEHICLE_STALLED: 'The vehicle never moves with the accelerator held — call driveVehicle(car, drive, ctx.input.axis(), dt) in EVERY update() for the car the player drives (from src/game/three/objects.ts), with "let car; let drive;" declared outside setup() and set there (drive = createVehicleState(car)). Never move the car by hand.',
  GAME_DEFECT_MISSING_LAYER: 'Code imports game-kit files that are not on disk — run the owning run_recipe (generate_game_3d / generate_game_shell) instead of hand-writing them.',
  GAME_DEFECT_RESTART_BROKEN: 'After the round ends there is no working Play again — keep the kit\'s game-over screen (its Play again calls game.restart()), or give your own end screen a real <button> that resets the round and sets status back to playing.',
  GAME_DEFECT_TOUCH_SCROLLS: 'A touch handler calls preventDefault on a passive listener, so the browser ignores it and the page can scroll or zoom under the player\'s thumb — register it with addEventListener(type, fn, { passive: false }) (React\'s onTouch* props are passive), or give the game area the CSS touch-action: none.',
  GAME_DEFECT_TOO_HEAVY: 'A frame asks more of the GPU than a budget phone draws smoothly — merge static scenery into fewer meshes, use InstancedMesh for repeated objects (trees, crates, coins), use detail: \'lite\' kit objects for anything far away, keep lights to the kit\'s rig, and reuse geometries and materials instead of creating them per object. Keep how the game looks and plays.',
  GAME_DEFECT_SILENT: 'The game\'s code plays sound but a whole playthrough played none — play effects from real events (bindGameFeedback / audio.play on a jump, a hit, a pickup) after the first tap, and check the player\'s settings are not muting them.',
};

export function gameRepairPrompt(userPrompt: string, defects: readonly GameDefect[], scopeMissing: readonly string[]): string {
  const lines = defects.map((d) => `- ${d.code}: ${FIX_HINT[d.code]} (measured: ${d.evidence})`);
  if (scopeMissing.length) lines.push(`- GAME_SCOPE_GAP: the user asked for ${scopeMissing.join(', ')} and the game code has none of ${scopeMissing.length === 1 ? 'it' : 'them'} — add ${scopeMissing.length === 1 ? 'it' : 'them'} so ${scopeMissing.length === 1 ? 'it works' : 'they work'} in play.`);
  return [
    'NavBharatAI PLAYED this game in a real browser and measured the problems below. Fix ONLY these, at their root,',
    'keep everything that already works, build on the game kit in src/game (never a second loop/input/camera),',
    'and stop once the fix is written — the platform plays the game again itself.',
    '',
    `The user's request: ${String(userPrompt ?? '').slice(0, 1500)}`,
    '',
    ...lines,
  ].join('\n');
}

export interface GameRepairProof { outcome: 'passed' | 'failed'; score: number }

export interface GameRepairIO {
  /** Run one focused repair; true when the runner finished. */
  repair: (prompt: string, signal: AbortSignal) => Promise<boolean>;
  /** Play the game again and return its measured defects and still-missing named features. */
  replay: () => Promise<{ defects: GameDefect[]; scopeMissing: string[]; proof: GameRepairProof | null }>;
  /** How many files changed since the snapshot. */
  changedSince: (snap: Record<string, string>) => Promise<number>;
  revert: (snap: Record<string, string>) => Promise<void>;
}

export interface GameRepairOutcome {
  attempted: boolean;
  kept: boolean;
  reason: string;
  before: GameDefectCode[];
  after: GameDefectCode[] | null;
  scopeBefore: string[];
  scopeAfter: string[] | null;
  proof: GameRepairProof | null;
}

const hardCount = (ds: readonly GameDefect[]): number => ds.filter((d) => HARD_DEFECTS.has(d.code)).length;

/** Is the replay strictly better: fewer hard defects (or fewer missing features), and nothing new? PURE. */
export function repairImproved(before: readonly GameDefect[], after: readonly GameDefect[], scopeBefore: readonly string[], scopeAfter: readonly string[]): boolean {
  const had = new Set(before.map((d) => d.code));
  if (after.some((d) => !had.has(d.code))) return false;
  if (scopeAfter.some((f) => !scopeBefore.includes(f))) return false;
  const total = (ds: readonly GameDefect[], s: readonly string[]): number => hardCount(ds) * 10 + ds.length + s.length;
  return total(after, scopeAfter) < total(before, scopeBefore);
}

export async function runGameRepair(
  defects: readonly GameDefect[], scopeMissing: readonly string[], userPrompt: string,
  opts: { repairMs: number; snapshot: Record<string, string>; buildSignal: AbortSignal; io: GameRepairIO },
): Promise<GameRepairOutcome> {
  // Defense in depth: even a direct caller cannot reach model, command, replay or
  // rollback callbacks. Do not mistake an empty `skipped` list for complete inventory.
  void userPrompt; void opts;
  return { attempted: false, kept: false, reason: GAME_AUTO_REPAIR_SUSPENSION_REASON,
    before: defects.map(d => d.code), after: null, scopeBefore: [...scopeMissing],
    scopeAfter: null, proof: null };
}

/** The diag record for the outcome. PURE. */
export function gameRepairRecord(o: GameRepairOutcome): { code: 'GAME_REPAIR_SKIPPED' | 'GAME_REPAIRED' | 'GAME_REPAIR_UNREPAIRED'; severity: 'info' | 'warning'; autoResolved: boolean; message: string } {
  const ba = `before: ${o.before.join(', ') || 'none'}${o.scopeBefore.length ? ` + missing ${o.scopeBefore.join(', ')}` : ''}; after: ${o.after ? (o.after.join(', ') || 'none') : 'not replayed'}${o.scopeAfter?.length ? ` + missing ${o.scopeAfter.join(', ')}` : ''}`;
  if (!o.attempted) return { code: 'GAME_REPAIR_SKIPPED', severity: 'info', autoResolved: true, message: `Game repair not attempted: ${o.reason}.` };
  if (o.kept) return { code: 'GAME_REPAIRED', severity: 'info', autoResolved: true, message: `Game repaired and kept (${o.reason}) — ${ba}. Repair cost absorbed by the platform.` };
  return { code: 'GAME_REPAIR_UNREPAIRED', severity: 'warning', autoResolved: false, message: `Game repair attempted and undone: ${o.reason} — ${ba}. Repair cost absorbed by the platform.` };
}

/**
 * Defects read from the game's CODE, not from playing it. They hold whether or not the playtest ran, so the
 * gate states them as code facts — never as "the game was played" (failedbr #2494, 2026-11-22).
 */
export const CODE_READ_DEFECTS: ReadonlySet<GameDefectCode> = new Set(['GAME_DEFECT_MISSING_LAYER']);

const defectLabel = (code: GameDefectCode): string => code.replace('GAME_DEFECT_', '').toLowerCase().replace(/_/g, ' ');

/**
 * The incomplete-delivery gate: the reason the game is not shippable, or null. PURE.
 *
 * 🔴 `played` IS REQUIRED, AND IT IS THE PLAYTEST'S OWN ANSWER (`playtestOutcome(...) !== 'not-run'`).
 * failedbr #2494 (2026-11-22): the playtest recorded "The game was never played — … the page drew 1 frames per
 * second", and 0.3 s later this gate said "the game was played and is not playable (missing layer)" — a
 * sentence it built from a CODE-read defect, with no knowledge of whether anything was played. The release
 * gate then went RED "Not shippable" on a claim that was false twice over. A defect is now phrased by where
 * it came from: a code fact as a code fact, a play measurement as "played" only when the game WAS played.
 */
export function gameIncompleteReason(defects: readonly GameDefect[], scopeMissing: readonly string[], opts: { played: boolean }): string | null {
  const hardDefects = defects.filter((d) => HARD_DEFECTS.has(d.code));
  const measured = hardDefects.filter((d) => !CODE_READ_DEFECTS.has(d.code)).map((d) => defectLabel(d.code));
  const fromCode = hardDefects.filter((d) => CODE_READ_DEFECTS.has(d.code)).map((d) => defectLabel(d.code));
  const parts: string[] = [];
  if (measured.length) {
    parts.push(opts.played
      ? `the game was played and is not playable (${measured.join(', ')})`
      : `the playtest could not finish playing the game, and what it did see is broken (${measured.join(', ')})`);
  }
  if (fromCode.length) parts.push(`its code imports game-kit files that are not in the project (${fromCode.join(', ')})`);
  if (scopeMissing.length) parts.push(`features you asked for are missing (${scopeMissing.join(', ')})`);
  // BR #2535: the game itself said something it was asked to show is not on screen (a gun not in the hand, a library
  // character or a custom car it could not use). Not "unplayable" — the game still plays — but the ask was not met, so the
  // build is not finished. Kept OUT of HARD_DEFECTS on purpose: that set means unplayable, and gameRegression's "Go back"
  // offer reads it.
  const notShown = defects.filter((d) => d.code === 'GAME_DEFECT_NOT_SHOWN').map((d) => d.evidence).filter(Boolean);
  if (notShown.length) parts.push(`something the game was asked to show is not on screen — the game said: ${notShown.join(' · ').slice(0, 300)}`);
  // Kadam 2: what THIS request asked for, proved by playing — enemies alive near the hero, an item really in the hand.
  const unmet = defects.filter((d) => d.code === 'GAME_DEFECT_ASK_NOT_MET').map((d) => d.evidence).filter(Boolean);
  if (unmet.length) parts.push(`what you asked for is not in the game yet — ${unmet.join(' · ').slice(0, 300)}`);
  return parts.length ? parts.join('; ') : null;
}
