/**
 * THE VERDICT ON A GAME FIX, SAID TO THE USER (locked plan item 3, 2026-11-24). One call from the route's playtest.
 *
 * - A turn that made the game measurably BETTER is always said, with both scores ("Played before: 41/100. Played
 *   after: 78/100 — playable now").
 * - On the user's own "Make the game playable" turn, an unchanged game is said too ("nothing measurable changed"),
 *   and a game that could not be played again is said as not known. A tap is never answered with silence.
 * - Worse is not handled here: GAME_GOT_WORSE already says it, with a one-tap way back.
 * Evidence only: it records and says; it never gates, charges, edits or undoes anything. Never throws.
 */
import { gameFixOutcome, GAME_FIX_UNVERIFIED_MESSAGE, type GameMeasure } from '../gameRegression';

export interface GameFixPorts {
  fixTurn: boolean;
  record: (issue: { phase: 'preview'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }) => void;
  say: (text: string) => void;
}

/** After a measured playtest. Returns the code it reported, or null. */
export function reportGameFixOutcome(before: GameMeasure | null, after: GameMeasure | null, ports: GameFixPorts): string | null {
  try {
    const outcome = gameFixOutcome(before, after);
    if (!outcome) return null;
    if (outcome.code === 'GAME_FIX_NO_CHANGE' && !ports.fixTurn) return null; // an ordinary edit that kept the score: nothing to say
    ports.record({ phase: 'preview', severity: outcome.code === 'GAME_FIX_VERIFIED' ? 'info' : 'warning', code: outcome.code, message: outcome.message, autoResolved: outcome.code === 'GAME_FIX_VERIFIED' });
    ports.say(`🎮 ${outcome.message}`);
    return outcome.code;
  } catch { return null; }
}

/** When the playtest could not run: only a tapped fix is owed a sentence. */
export function reportGameFixUnverified(ports: GameFixPorts): string | null {
  try {
    if (!ports.fixTurn) return null;
    ports.record({ phase: 'preview', severity: 'warning', code: 'GAME_FIX_UNVERIFIED', message: GAME_FIX_UNVERIFIED_MESSAGE, autoResolved: false });
    ports.say(`🎮 ${GAME_FIX_UNVERIFIED_MESSAGE}`);
    return 'GAME_FIX_UNVERIFIED';
  } catch { return null; }
}
