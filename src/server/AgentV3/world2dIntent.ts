// WHEN A 2D GAME GETS THE BIG 2D WORLD (admin 2026-11-19). Read from the user's WISH, not one word
// (largeWorldIntent.ts: "sirf word par nahi, intension par trigger ho"), and only where a world makes sense:
//   - the request is a game, and it is NOT drawn in 3D (a 3D game's big world is the Athree map);
//   - it is not a board, card, puzzle or quiz game (a chessboard has no map to grow);
//   - the user means a big world ("bada map", "kahin bhi ghoom sakun", "map bahut chhota hai", "50 km") or names the
//     2D world / a top-down map; a small map on purpose is obeyed.
// A project that already has the world keeps it on every edit.
// PURE. No I/O, no env. Never throws.

import { buildGameContract } from './gameIntent';
import { largeWorldIntent, largeWorldIntentLine } from './largeWorldIntent';

export interface World2DIntent {
  use: boolean;
  reason: string;
}

export interface World2DIntentInput {
  prompt: string | null | undefined;
  /** The game is drawn in 3D (gameKitWants3D). The caller supplies it, so this module stays free of the kit planner. */
  drawnIn3D: boolean;
  /** The project already has src/game/world2d/index.ts. */
  stored?: boolean;
}

const NAMED = /\b(?:2d|two[\s-]?d)\s+(?:world|map|open[\s-]?world)\b|\btop[\s-]?down\s+(?:world|map|rpg|game|adventure)\b|\btile[\s-]?map\b|\b(?:rpg|zelda[\s-]?like|pokemon[\s-]?like)\s+(?:world|map)\b/i;
const NO_WORLD_GENRES = new Set(['puzzle', 'quiz', 'card', 'board']);
const GAME_WORD = /\bgames?\b|\bkhel\b|गेम|खेल/i;

export function world2dIntent(input: World2DIntentInput): World2DIntent {
  try {
    if (input.stored) return { use: true, reason: 'This project already has the 2D world; edits keep it.' };
    const prompt = String(input.prompt ?? '');
    if (!prompt.trim()) return { use: false, reason: 'There is no request to read.' };
    const contract = buildGameContract(prompt);
    const isGame = contract.genre !== 'unknown' || Boolean(contract.vehicle) || GAME_WORD.test(prompt);
    if (!isGame) return { use: false, reason: 'This is not a game, so it has no world to put a map in.' };
    if (input.drawnIn3D || contract.dimension === '3d') return { use: false, reason: 'This game is drawn in 3D; its big world is the Athree map.' };
    if (NO_WORLD_GENRES.has(contract.genre)) return { use: false, reason: `A ${contract.genre} game has no map to grow.` };
    if (NAMED.test(prompt)) return { use: true, reason: 'The request asks for a 2D world map.' };
    const wish = largeWorldIntent(prompt);
    if (wish.wants) return { use: true, reason: largeWorldIntentLine(wish) };
    return { use: false, reason: wish.smallOnPurpose ? largeWorldIntentLine(wish) : 'The request does not ask for a big world.' };
  } catch {
    return { use: false, reason: 'The request could not be read.' };
  }
}
