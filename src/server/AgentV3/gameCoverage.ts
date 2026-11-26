// THE GAME-MAKER COVERAGE BENCHMARK (admin 2026-11-26: "mujhe ek aisa game maker chahiye, jo sabhi prkar ke game bana sake").
//
// The audit's first finding was that nobody could say how many kinds of game NavBharatAI really builds: "it built a game"
// and "the platform gave the builder what that genre needs" were never told apart. This is the measuring stick. Fifty games
// people actually ask for, in their own words (English, Hinglish, Hindi), each read the way a real first build reads it:
// the scope contract, the places on the map, and the kit the platform lays down before the first model call. Every game
// lands in exactly one class:
//   • starter   — a ready, playable genre game is laid down (the race, the runner, the open world / royale map);
//   • rules     — a tested rules engine is laid down (the India games pack: chess, ludo, carrom, cards, cricket, match-3 …);
//   • genre-kit — the genre's rules are laid down (fighting, tower defense);
//   • kit-only  — only the shared kit (loop, input, 3D or 2D, sound): the builder writes the genre itself, from memory;
//   • not-a-game — the platform did not even read it as a game (always a defect).
// "kit-only" is the honest name for "the builder improvises". The ratchet test lets that number only go DOWN.
//
// It reads planning, not delivery: a class here is what the platform GIVES the builder, never proof the finished game plays
// (the playtest and GAME_PROOF say that). PURE.

import { buildGameContract, type GameGenre } from './gameIntent';
import { gameKitPlan } from './gameKitSeed';
import { worldSettingFrom } from './worldSetting';
import type { MapPlaceKind } from './mapGrowthIntent';

export type CoverageClass = 'starter' | 'rules' | 'genre-kit' | 'kit-only' | 'not-a-game';

export interface CanonicalGame {
  id: string;
  prompt: string;
  /** The genre the platform must read. */
  genre: GameGenre;
  /** The places the map must have, in order (omitted = no claim about places). */
  places?: readonly MapPlaceKind[];
  /** What the platform gives this game TODAY. Raising a game to a better class means updating this line on purpose. */
  coverage: CoverageClass;
  /** A starter that is laid down but is not this game (the open world under a block-building sandbox): counted as kit-only. */
  starterFits?: false;
  /** Why it is where it is, when that is a known defect (each has a BUILD_REPORT_QUEUE.md row). */
  note?: string;
}

export const CANONICAL_GAMES: readonly CanonicalGame[] = [
  // Driving and racing
  { id: 'car-race', prompt: 'ek 3D car racing game banao jisme nitro aur drift ho', genre: 'racing', coverage: 'starter' },
  { id: 'bike-race', prompt: 'bike racing game banao highway par traffic ke saath', genre: 'racing', coverage: 'starter' },
  { id: 'kart', prompt: 'a kart racing game with items and a lap timer', genre: 'racing', coverage: 'starter' },
  { id: 'bus-driving', prompt: 'bus driving simulator game, passengers ko stop par utaro', genre: 'simulator', coverage: 'kit-only' },
  { id: 'train-sim', prompt: 'train simulator game banao, signal aur station ke saath', genre: 'simulator', coverage: 'kit-only' },
  { id: 'flight-sim', prompt: '3d flight simulator game banao, plane udao aur land karo', genre: 'simulator', coverage: 'kit-only' },
  { id: 'boat-race', prompt: 'boat racing game on a river', genre: 'racing', coverage: 'starter' },
  // Runners
  { id: 'endless-runner', prompt: 'subway surfers jaisa endless runner game banao', genre: 'runner', coverage: 'kit-only', note: 'a runner with no 3D word is drawn flat, so the 3D LaneRunner starter is never laid down (Q-3483)' },
  { id: 'temple-runner', prompt: 'an endless runner through a jungle temple with coins and jumps', genre: 'runner', coverage: 'kit-only', note: 'same as endless-runner (Q-3483)' },
  { id: 'dino-runner', prompt: 'chrome dino jaisa runner game, cactus se bacho', genre: 'runner', coverage: 'kit-only' },
  // Open worlds, places
  { id: 'gta-city', prompt: 'gta jaisa open world game banao jisme gaadi chura sako aur police peeche aaye', genre: 'rpg', places: ['city'], coverage: 'kit-only', note: 'the big map is laid down but no player stands on it: a car in the request switches off the on-foot starter (Q-3484)' },
  { id: 'village-life', prompt: 'ek gaon ka open world game banao jisme ghar, kuan aur sadak ho', genre: 'rpg', places: ['village'], coverage: 'starter' },
  { id: 'village-not-city', prompt: 'city nahi, sirf gaon wala open world game banao', genre: 'rpg', places: ['village'], coverage: 'starter' },
  { id: 'desert-jungle', prompt: 'open world game with a desert, a jungle and a snow mountain', genre: 'rpg', places: ['desert', 'jungle', 'snow', 'mountain'], coverage: 'starter' },
  { id: 'horse-village', prompt: 'ghoda chalane wala open world game, do gaon ke beech', genre: 'rpg', places: ['village'], coverage: 'starter' },
  // Shooters
  { id: 'bgmi', prompt: 'mujhe bgmi jaisa game chahiye, bada map aur parachute', genre: 'shooter', coverage: 'starter' },
  { id: 'free-fire', prompt: 'free fire jaisa battle royale game banao', genre: 'shooter', coverage: 'starter' },
  { id: 'fps', prompt: 'a first person shooter with enemies, health and a restart button', genre: 'shooter', coverage: 'kit-only' },
  { id: 'zombie', prompt: 'zombie shooting survival game banao, waves me zombie aaye', genre: 'shooter', coverage: 'kit-only' },
  { id: 'space-shooter', prompt: 'space shooter game with asteroids and a boss', genre: 'shooter', coverage: 'kit-only' },
  { id: 'archery', prompt: 'archery game banao, teer se nishana lagao', genre: 'unknown', coverage: 'kit-only' },
  // Fighting and strategy
  { id: 'fighting-3d', prompt: 'tekken jaisa 3d fighting game banao', genre: 'fighting', coverage: 'genre-kit' },
  { id: 'boxing', prompt: 'a boxing game against a computer opponent', genre: 'fighting', coverage: 'genre-kit' },
  { id: 'kushti', prompt: 'kushti wala game banao, dangal me ladai', genre: 'fighting', coverage: 'genre-kit' },
  { id: 'tower-defense', prompt: 'tower defense game banao, qila bachao', genre: 'strategy', coverage: 'genre-kit' },
  { id: 'rts', prompt: 'a real time strategy game where I build a base and an army', genre: 'strategy', coverage: 'kit-only' },
  // India games pack
  { id: 'chess', prompt: 'chess game banao computer ke against', genre: 'board', coverage: 'rules' },
  { id: 'ludo', prompt: 'ludo game banao 4 players ke liye', genre: 'board', coverage: 'rules' },
  { id: 'carrom', prompt: 'carrom board game banao', genre: 'board', coverage: 'rules' },
  { id: 'snakes', prompt: 'saanp seedhi (snakes and ladders) game banao', genre: 'board', coverage: 'rules' },
  { id: 'teen-patti', prompt: 'teen patti card game banao, sirf points ke saath', genre: 'card', coverage: 'rules' },
  { id: 'business', prompt: 'business (vyapaar) board game banao', genre: 'board', coverage: 'rules' },
  { id: 'cricket', prompt: 'cricket game banao jisme batting aur bowling ho', genre: 'sports', coverage: 'rules' },
  { id: 'match3', prompt: 'candy crush jaisa match-3 game', genre: 'puzzle', coverage: 'rules' },
  // Puzzles, arcade, quiz
  { id: 'sudoku', prompt: 'sudoku puzzle game banao', genre: 'puzzle', coverage: 'kit-only' },
  { id: '2048', prompt: '2048 puzzle game', genre: 'puzzle', coverage: 'kit-only' },
  { id: 'tetris', prompt: 'a tetris style falling blocks puzzle', genre: 'puzzle', coverage: 'kit-only' },
  { id: 'quiz', prompt: 'GK quiz game banao timer ke saath', genre: 'quiz', coverage: 'kit-only' },
  { id: 'snake', prompt: 'classic snake game banao', genre: 'snake', coverage: 'kit-only' },
  { id: 'flappy', prompt: 'flappy bird jaisa game banao', genre: 'arcade', coverage: 'kit-only' },
  { id: 'breakout', prompt: 'a breakout brick breaker arcade game', genre: 'arcade', coverage: 'kit-only' },
  { id: 'platformer', prompt: 'mario jaisa platformer game banao', genre: 'platformer', coverage: 'kit-only' },
  // Sports beyond the pack
  { id: 'football-3d', prompt: '3d football game banao, goal karo', genre: 'sports', coverage: 'kit-only' },
  { id: 'basketball', prompt: 'basketball shooting game', genre: 'sports', coverage: 'kit-only' },
  // Sandbox, survival, simulation, others
  { id: 'sandbox', prompt: 'minecraft jaisa block building sandbox game banao', genre: 'unknown', coverage: 'starter', starterFits: false, note: 'the open-world map is laid down, but there is no block placing / breaking (voxel) kit (Q-3485)' },
  { id: 'farming', prompt: 'farming simulator game banao, khet me fasal ugao', genre: 'simulator', coverage: 'kit-only' },
  { id: 'horror', prompt: 'ek horror game banao, andhere ghar me bhoot', genre: 'unknown', coverage: 'kit-only' },
  { id: 'idle-tycoon', prompt: 'an idle tycoon game where I run a chai shop and upgrade it', genre: 'unknown', coverage: 'kit-only' },
  { id: 'rhythm', prompt: 'a rhythm game where you tap to the beat of the music', genre: 'unknown', coverage: 'kit-only' },
  { id: 'hide-seek', prompt: 'hide and seek game banao bachon ke liye', genre: 'unknown', coverage: 'kit-only' },
];

/** The most canonical games that may be "kit-only" (the builder improvises). It may only ever go DOWN. */
export const MAX_KIT_ONLY = 28;

export interface CoverageRead {
  id: string;
  genre: GameGenre;
  places: MapPlaceKind[];
  plan: string[];
  coverage: CoverageClass;
}

/** The class that counts: a starter that is not this game is kit-only. PURE. */
export function effectiveClass(game: CanonicalGame, read: CoverageClass): CoverageClass {
  return read === 'starter' && game.starterFits === false ? 'kit-only' : read;
}

/** What the platform gives one request today. PURE. */
export function coverageOf(prompt: string): Omit<CoverageRead, 'id'> {
  let genre: GameGenre = 'unknown';
  try { genre = buildGameContract(prompt).genre; } catch { /* unknown */ }
  const places = worldSettingFrom(prompt).places.map((p) => p.kind);
  const plan = gameKitPlan(prompt, 'vite-react');
  const coverage: CoverageClass = plan.length === 0 ? 'not-a-game'
    : plan.includes('generate_open_world') || (plan.includes('generate_game_shell') && (genre === 'racing' || genre === 'runner')) ? 'starter'
      : plan.includes('generate_board_games') ? 'rules'
        : plan.includes('generate_genre_kits') ? 'genre-kit'
          : 'kit-only';
  return { genre, places, plan, coverage };
}

/** Every canonical game, read. PURE. */
export function coverageBoard(games: readonly CanonicalGame[] = CANONICAL_GAMES): CoverageRead[] {
  return games.map((g) => { const r = coverageOf(g.prompt); return { id: g.id, ...r, coverage: effectiveClass(g, r.coverage) }; });
}

/** The scoreboard as a short report. PURE. */
export function coverageSummary(board: readonly CoverageRead[] = coverageBoard()): string {
  const count = (c: CoverageClass) => board.filter((r) => r.coverage === c).length;
  const supported = count('starter') + count('rules') + count('genre-kit');
  return [
    `Game-maker coverage: ${supported} of ${board.length} canonical games get a starter, a rules engine or a genre kit.`,
    `starter ${count('starter')} · rules ${count('rules')} · genre-kit ${count('genre-kit')} · kit-only ${count('kit-only')} · not-a-game ${count('not-a-game')}`,
    `Builder improvises: ${board.filter((r) => r.coverage === 'kit-only').map((r) => r.id).join(', ') || 'none'}.`,
  ].join('\n');
}
