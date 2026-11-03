// GAME ENGINE ULTRA — PHASE 3: REPAIR A GAME THE PLAYTEST PROVED BROKEN, AND NEVER CALL IT DONE WHILE IT IS.
//
// Inputs are Phase 2's measured defects (`playtestDefects`, gamePlaytest.ts) and Phase 1's scope gap
// (`scopeMatch`, gameIntent.ts). Nothing here guesses: a repair is KEPT only when the game is played again
// and has strictly fewer hard defects and no new ones; otherwise it is undone (the explorer repair's rule,
// explorerRepair.ts). The orchestration is pure over injected I/O, so every branch is unit-tested.
//
// 💰 WHO PAYS (admin decision pending — see docs/claude/ENV_REGISTRY.md). Both switches default OFF, so
// production is unchanged. When AGENTV3_GAME_AUTO_REPAIR=on, the route marks the repair's billing phase
// barren whatever the outcome — the PLATFORM absorbs the repair, the user is never charged for it. Billing it
// to the user, even when kept, needs an explicit admin decision and a separate change.
//
// 🚦 THE GATE. AGENTV3_GAME_COMPLETE_GATE=on: a game whose final play still shows a HARD defect (blank,
// input ignored, start stuck, runtime error) or lacks a feature the user named is not reported shippable —
// the release gate goes RED with the reason. It never flips result.ok and never touches a bill.

import type { GameDefect, GameDefectCode } from './gamePlaytest';

export const GAME_REPAIR_PASS = 'game-repair';

export function gameAutoRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_AUTO_REPAIR ?? '').trim().toLowerCase() === 'on';
}
export function gameCompleteGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_COMPLETE_GATE ?? '').trim().toLowerCase() === 'on';
}

/** Defects that mean the game cannot be played — what the gate holds on and what a repair must reduce. */
export const HARD_DEFECTS: ReadonlySet<GameDefectCode> = new Set([
  'GAME_DEFECT_BLANK', 'GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_START_STUCK', 'GAME_DEFECT_RUNTIME_ERROR', 'GAME_DEFECT_MISSING_LAYER',
]);

/** Every defect a repair is asked to fix (soft ones too: touch, camera, stalled vehicle). */
const FIX_HINT: Readonly<Record<GameDefectCode, string>> = {
  GAME_DEFECT_START_STUCK: 'Pressing the start control shows no game surface — make the start control mount and start the game.',
  GAME_DEFECT_BLANK: 'The game surface is blank or one colour — draw the world and the player.',
  GAME_DEFECT_INPUT_IGNORED: 'Arrow keys/WASD/Space/drag change nothing — wire input from src/game/core into the update loop.',
  GAME_DEFECT_NO_TOUCH: 'On a phone a drag or tap does nothing and there are no on-screen controls — add touch controls.',
  GAME_DEFECT_RUNTIME_ERROR: 'An uncaught error is thrown while playing — fix it at its root: find the value that is undefined and why. Never wrap the line in try/catch or add a `|| {}` default — that hides the error and the game stays broken (autopsy 7aa2fe7c / c71e56de).',
  GAME_DEFECT_CAMERA_WRONG: 'The camera faces the vehicle or steering is mirrored — use ctx.follow / CameraRig.follow and driveVehicle from the kit.',
  GAME_DEFECT_VEHICLE_STALLED: 'The vehicle never moves with the accelerator held — call driveVehicle(car, drive, ctx.input.axis(), dt) in EVERY update() for the car the player drives (from src/game/three/objects.ts), with "let car; let drive;" declared outside setup() and set there (drive = createVehicleState(car)). Never move the car by hand.',
  GAME_DEFECT_MISSING_LAYER: 'Code imports game-kit files that are not on disk — run the owning run_recipe (generate_game_3d / generate_game_shell) instead of hand-writing them.',
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

export interface GameRepairIO {
  /** Run one focused repair; true when the runner finished. */
  repair: (prompt: string, signal: AbortSignal) => Promise<boolean>;
  /** Play the game again and return its measured defects and still-missing named features. */
  replay: () => Promise<{ defects: GameDefect[]; scopeMissing: string[] }>;
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
  const base: GameRepairOutcome = { attempted: false, kept: false, reason: '', before: defects.map((d) => d.code), after: null, scopeBefore: [...scopeMissing], scopeAfter: null };
  if (defects.length === 0 && scopeMissing.length === 0) return { ...base, reason: 'nothing to repair' };
  if (opts.repairMs <= 0) return { ...base, reason: 'not enough build time left for a repair and its replay' };
  if (Object.keys(opts.snapshot).length === 0) return { ...base, reason: 'no snapshot of the game could be taken' };
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  opts.buildSignal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), opts.repairMs);
  const undo = async (reason: string, after: GameRepairOutcome['after'] = null, scopeAfter: GameRepairOutcome['scopeAfter'] = null): Promise<GameRepairOutcome> => {
    try { await opts.io.revert(opts.snapshot); } catch (e) { reason += `; the undo failed (${e instanceof Error ? e.message : String(e)})`; }
    return { ...base, attempted: true, reason, after, scopeAfter };
  };
  try {
    let finished = false;
    try { finished = await opts.io.repair(gameRepairPrompt(userPrompt, defects, scopeMissing), ctl.signal); } catch { finished = false; }
    if (!finished || ctl.signal.aborted) return await undo('the repair did not finish in time');
    if ((await opts.io.changedSince(opts.snapshot)) === 0) return { ...base, attempted: true, reason: 'the repair changed no file', after: base.before, scopeAfter: [...scopeMissing] };
    const again = await opts.io.replay();
    const after = again.defects.map((d) => d.code);
    if (!repairImproved(defects, again.defects, scopeMissing, again.scopeMissing)) return await undo('played again, the game was not better (or something new broke) — undone', after, again.scopeMissing);
    return { ...base, attempted: true, kept: true, reason: 'played again: fewer defects, nothing new broke', after, scopeAfter: again.scopeMissing };
  } catch (e) {
    return await undo(`the repair could not be checked (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    clearTimeout(timer);
    opts.buildSignal.removeEventListener('abort', onAbort);
  }
}

/** The diag record for the outcome. PURE. */
export function gameRepairRecord(o: GameRepairOutcome): { code: 'GAME_REPAIR_SKIPPED' | 'GAME_REPAIRED' | 'GAME_REPAIR_UNREPAIRED'; severity: 'info' | 'warning'; autoResolved: boolean; message: string } {
  const ba = `before: ${o.before.join(', ') || 'none'}${o.scopeBefore.length ? ` + missing ${o.scopeBefore.join(', ')}` : ''}; after: ${o.after ? (o.after.join(', ') || 'none') : 'not replayed'}${o.scopeAfter?.length ? ` + missing ${o.scopeAfter.join(', ')}` : ''}`;
  if (!o.attempted) return { code: 'GAME_REPAIR_SKIPPED', severity: 'info', autoResolved: true, message: `Game repair not attempted: ${o.reason}.` };
  if (o.kept) return { code: 'GAME_REPAIRED', severity: 'info', autoResolved: true, message: `Game repaired and kept (${o.reason}) — ${ba}. Repair cost absorbed by the platform.` };
  return { code: 'GAME_REPAIR_UNREPAIRED', severity: 'warning', autoResolved: false, message: `Game repair attempted and undone: ${o.reason} — ${ba}. Repair cost absorbed by the platform.` };
}

/** The incomplete-delivery gate: the reason the game is not shippable, or null. PURE. */
export function gameIncompleteReason(defects: readonly GameDefect[], scopeMissing: readonly string[]): string | null {
  const hard = defects.filter((d) => HARD_DEFECTS.has(d.code)).map((d) => d.code.replace('GAME_DEFECT_', '').toLowerCase().replace(/_/g, ' '));
  const parts: string[] = [];
  if (hard.length) parts.push(`the game was played and is not playable (${hard.join(', ')})`);
  if (scopeMissing.length) parts.push(`features you asked for are missing (${scopeMissing.join(', ')})`);
  return parts.length ? parts.join('; ') : null;
}
