/**
 * A CHANGE THAT MADE THE GAME WORSE IS SAID SO, WITH ONE TAP BACK (admin 2026-11-21).
 *
 * Admin, verbatim: *"isko savdhani se 'on' karo, pahle ye sach me chalta hua app tod deta tha. optional karo, app/game
 * banne ke bad user se hi pucho, game me bugs dhundhna hai kya? aur agar automatic game repair se game tut jaye to user
 * ek prompt se wapas game undo ho jaye."*
 *
 * WHAT THIS IS, AND WHAT IT IS NOT.
 *   - The old automatic repair stays OFF (docs/security/game-auto-repair-suspension.md): it changed the user's game
 *     behind their back and rolled back from an incomplete, text-only snapshot. Nothing here edits anything.
 *   - Fixing is ALREADY the user's choice: the playtest's problems become a one-tap "Make the game playable" offer
 *     (buildFindingSuggestions), and that runs as a normal turn — saved and versioned like every other edit.
 *   - What was missing is the safety net: nobody compared the game before and after a turn. Now every turn on a
 *     game that was measured before AND after is compared, and a turn that made it worse ends with a plain sentence
 *     and a one-tap "Go back" to the saved version from just before that turn — the real Time Machine version
 *     (BuildHistoryStore, the whole app), restored by the existing /api/agentv3/restore-version, which saves the
 *     current app first so the user can come forward again.
 *
 * PURE: no I/O, no clock.
 */
import type { GameDefectCode } from './gamePlaytest';

/** A game's measured state: its Game Quality Score (null when not scored) and the defect codes the playtest named. */
export interface GameMeasure { score: number | null; defects: GameDefectCode[] }

/** The defects that mean the game cannot be played (the same set as gameRepair's HARD_DEFECTS). */
export const UNPLAYABLE: ReadonlySet<string> = new Set([
  'GAME_DEFECT_BLANK', 'GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_NO_TOUCH', 'GAME_DEFECT_START_STUCK',
  'GAME_DEFECT_RUNTIME_ERROR', 'GAME_DEFECT_CAMERA_WRONG', 'GAME_DEFECT_VEHICLE_STALLED', 'GAME_DEFECT_MISSING_LAYER',
]);

/** What each unplayable defect means, in words a person reads. */
const IN_WORDS: Readonly<Record<string, string>> = {
  GAME_DEFECT_BLANK: 'the game screen is blank',
  GAME_DEFECT_INPUT_IGNORED: 'the controls no longer do anything',
  GAME_DEFECT_NO_TOUCH: 'it no longer plays by touch on a phone',
  GAME_DEFECT_START_STUCK: 'pressing Play no longer starts the game',
  GAME_DEFECT_RUNTIME_ERROR: 'the game now hits an error while it is played',
  GAME_DEFECT_CAMERA_WRONG: 'the camera now faces the wrong way',
  GAME_DEFECT_VEHICLE_STALLED: 'the vehicle no longer moves',
  GAME_DEFECT_MISSING_LAYER: 'part of the game engine is missing',
};

/** A score drop that counts as worse: this many points, AND below the playable line. */
export const SCORE_DROP = 15;
export const PLAYABLE = 75;

interface IssueLike { code?: string; message?: string }

/** The game's measure from a build report's issues (the playtest verdict and the GAME_DEFECTS line), or null. PURE. */
export function gameMeasureFromIssues(issues: ReadonlyArray<IssueLike> | null | undefined): GameMeasure | null {
  const list = Array.isArray(issues) ? issues : [];
  let score: number | null = null;
  let played = false;
  const defects = new Set<GameDefectCode>();
  for (const i of list) {
    const code = String(i?.code ?? '');
    const msg = String(i?.message ?? '');
    if (code === 'GAME_PLAYTEST_OK' || code === 'GAME_PLAYTEST_ISSUES') {
      played = true;
      const m = /Game Quality Score (\d{1,3})\/100/.exec(msg);
      if (m) score = Math.min(100, Number(m[1]));
    }
    if (code === 'GAME_DEFECTS') for (const d of msg.match(/GAME_DEFECT_[A-Z_]+/g) ?? []) defects.add(d as GameDefectCode);
  }
  return played ? { score, defects: [...defects] } : null;
}

/**
 * Why the game is worse now, in plain words — or null when it is not. Worse means: a defect that makes it unplayable
 * appeared that was not there before, or the score fell by SCORE_DROP or more AND is now below the playable line.
 * A game that was already unplayable and stayed so is not "made worse" by this turn. PURE.
 */
export function gameGotWorse(before: GameMeasure | null, after: GameMeasure | null): string | null {
  if (!before || !after) return null;
  const had = new Set(before.defects);
  const fresh = after.defects.filter((d) => UNPLAYABLE.has(d) && !had.has(d));
  if (fresh.length) return fresh.map((d) => IN_WORDS[d] ?? d).join('; ');
  if (before.score !== null && after.score !== null && before.score - after.score >= SCORE_DROP && after.score < PLAYABLE) {
    return `its play score fell from ${before.score} to ${after.score} out of 100`;
  }
  return null;
}

interface VersionLike { id?: string; createdAt?: string; ok?: boolean; tier?: string }

/**
 * The saved version of the app as it stood just before this turn: the newest version saved before the turn started
 * that was a good build (ok !== false). A "before-restore" safety copy is a version too, and the right one when the
 * previous turn was a restore. PURE.
 */
export function versionBeforeTurn(versions: ReadonlyArray<VersionLike> | null | undefined, turnStartedAt: number): string | null {
  let best: { id: string; at: number } | null = null;
  for (const v of Array.isArray(versions) ? versions : []) {
    const at = Date.parse(String(v?.createdAt ?? ''));
    if (!v?.id || !Number.isFinite(at) || at >= turnStartedAt || v.ok === false) continue;
    if (!best || at > best.at) best = { id: v.id, at };
  }
  return best?.id ?? null;
}

/** The sentence the user reads above the button. PURE. */
export function gameUndoMessage(reason: string): string {
  return `This change made your game worse: ${reason}. You can go back to the version from just before it — nothing else is lost, and the current version is kept so you can come back to it.`;
}
