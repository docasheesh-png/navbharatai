// The game template library (owner t414u). One list. Adding or removing a template is one row here.
// The first six are the ones people ask for most. The other twenty-eight categories wait for the next batch.
// A template is a starting point: the source says so, and a later edit may change any of it.

import type { GoldenScaffold } from '../goldenScaffolds/registry';
import { laneDashAppTsx } from './games/laneDash';
import { courtyardAppTsx } from './games/courtyard';
import { gullyInningsAppTsx } from './games/gullyInnings';
import { stackTilesAppTsx } from './games/stackTiles';
import { roadRaceAppTsx } from './games/roadRace';
import { bellRoundAppTsx } from './games/bellRound';
import { pairGroveAppTsx } from './games/pairGrove';
import { dodgeFallAppTsx } from './games/dodgeFall';
import { ladderPathAppTsx } from './games/ladderPath';
import { threeLeavesAppTsx } from './games/threeLeaves';
import { trailWalkAppTsx } from './games/trailWalk';
import { pavilionAppTsx } from './games/pavilion';
import { gardenMatchAppTsx } from './games/gardenMatch';
import { oddOneAppTsx } from './games/oddOne';
import { letterLinkAppTsx } from './games/letterLink';
import { rhymePairAppTsx } from './games/rhymePair';
import { boltArenaAppTsx } from './games/boltArena';
import { shieldRushAppTsx } from './games/shieldRush';
import { caveStepsAppTsx } from './games/caveSteps';
import { highCardAppTsx } from './games/highCard';
import { tapBloomAppTsx } from './games/tapBloom';
import { countGardenAppTsx } from './games/countGarden';
import { shapeYardAppTsx } from './games/shapeYard';
import { teaStallAppTsx } from './games/teaStall';
import { riverFerryAppTsx } from './games/riverFerry';
import { seedRowAppTsx } from './games/seedRow';
import { towerLineAppTsx } from './games/towerLine';
import { campQuestAppTsx } from './games/campQuest';
import { roadTaleAppTsx } from './games/roadTale';
import { gapScreen } from './games/gapScreens';

export type PlayCategory =
  | 'Action' | 'Adventure' | 'Arcade' | 'Board' | 'Card' | 'Casino' | 'Casual' | 'Educational'
  | 'Music' | 'Puzzle' | 'Racing' | 'Role Playing' | 'Simulation' | 'Sports' | 'Strategy' | 'Trivia' | 'Word';

export interface GameTemplate {
  id: string;
  title: string;
  category: PlayCategory;
  accent: string;
  appTsx: string;
}

export const GAME_LIBRARY: readonly GameTemplate[] = [
  { id: 'lane-dash', title: 'Lane Dash', category: 'Arcade', accent: '#4f46e5', appTsx: laneDashAppTsx },
  { id: 'courtyard', title: 'Courtyard', category: 'Board', accent: '#0f766e', appTsx: courtyardAppTsx },
  { id: 'gully-innings', title: 'Gully Innings', category: 'Sports', accent: '#b45309', appTsx: gullyInningsAppTsx },
  { id: 'stack-tiles', title: 'Stack Tiles', category: 'Puzzle', accent: '#7c3aed', appTsx: stackTilesAppTsx },
  { id: 'ring-rally', title: 'Ring Rally', category: 'Racing', accent: '#be123c', appTsx: roadRaceAppTsx('race', 'ring-rally-best-v1') },
  { id: 'bell-round', title: 'Bell Round', category: 'Trivia', accent: '#0369a1', appTsx: bellRoundAppTsx },
  // Existing starters, registered here as the playable library face. One row adds or removes each.
  { id: 'trail-walk', title: 'Trail Walk', category: 'Adventure', accent: '#15803d', appTsx: trailWalkAppTsx },
  { id: 'pair-grove', title: 'Pair Grove', category: 'Casual', accent: '#7c3aed', appTsx: pairGroveAppTsx },
  { id: 'dodge-fall', title: 'Dodge Fall', category: 'Arcade', accent: '#ea580c', appTsx: dodgeFallAppTsx },
  { id: 'ladder-path', title: 'Ladder Path', category: 'Board', accent: '#0f766e', appTsx: ladderPathAppTsx },
  { id: 'three-leaves', title: 'Three Leaves', category: 'Card', accent: '#1d4ed8', appTsx: threeLeavesAppTsx },
  { id: 'pavilion', title: 'Pavilion', category: 'Sports', accent: '#b45309', appTsx: pavilionAppTsx },
  { id: 'garden-match', title: 'Garden Match', category: 'Puzzle', accent: '#16a34a', appTsx: gardenMatchAppTsx },
  { id: 'bolt-arena', title: 'Bolt Arena', category: 'Action', accent: '#dc2626', appTsx: boltArenaAppTsx },
  { id: 'cave-steps', title: 'Cave Steps', category: 'Adventure', accent: '#365314', appTsx: caveStepsAppTsx },
  { id: 'high-card', title: 'High Card', category: 'Card', accent: '#1e3a8a', appTsx: highCardAppTsx },
  { id: 'coin-wheel', title: 'Coin Wheel', category: 'Casino', accent: '#a16207', appTsx: gapScreen('coin-wheel', 'coin-wheel-best-v1') },
  { id: 'tap-bloom', title: 'Tap Bloom', category: 'Casual', accent: '#db2777', appTsx: tapBloomAppTsx },
  { id: 'count-garden', title: 'Count Garden', category: 'Educational', accent: '#0f766e', appTsx: countGardenAppTsx },
  { id: 'beat-steps', title: 'Beat Steps', category: 'Music', accent: '#7c3aed', appTsx: gapScreen('beat-steps', 'beat-steps-best-v1') },
  { id: 'slope-ride', title: 'Slope Ride', category: 'Racing', accent: '#9a3412', appTsx: roadRaceAppTsx('run', 'slope-ride-best-v1') },
  { id: 'camp-quest', title: 'Camp Quest', category: 'Role Playing', accent: '#3f6212', appTsx: campQuestAppTsx },
  { id: 'tea-stall', title: 'Tea Stall', category: 'Simulation', accent: '#92400e', appTsx: teaStallAppTsx },
  { id: 'tower-line', title: 'Tower Line', category: 'Strategy', accent: '#334155', appTsx: towerLineAppTsx },
  { id: 'odd-one', title: 'Odd One', category: 'Trivia', accent: '#0369a1', appTsx: oddOneAppTsx },
  { id: 'letter-link', title: 'Letter Link', category: 'Word', accent: '#4338ca', appTsx: letterLinkAppTsx },
  { id: 'shield-rush', title: 'Shield Rush', category: 'Action', accent: '#b91c1c', appTsx: shieldRushAppTsx },
  { id: 'coin-dice', title: 'Coin Dice', category: 'Casino', accent: '#a16207', appTsx: gapScreen('coin-dice', 'coin-dice-best-v1') },
  { id: 'shape-yard', title: 'Shape Yard', category: 'Educational', accent: '#0f766e', appTsx: shapeYardAppTsx },
  { id: 'drum-row', title: 'Drum Row', category: 'Music', accent: '#6d28d9', appTsx: gapScreen('drum-row', 'drum-row-best-v1') },
  { id: 'road-tale', title: 'Road Tale', category: 'Role Playing', accent: '#3f6212', appTsx: roadTaleAppTsx },
  { id: 'river-ferry', title: 'River Ferry', category: 'Simulation', accent: '#92400e', appTsx: riverFerryAppTsx },
  { id: 'seed-row', title: 'Seed Row', category: 'Strategy', accent: '#334155', appTsx: seedRowAppTsx },
  { id: 'rhyme-pair', title: 'Rhyme Pair', category: 'Word', accent: '#4338ca', appTsx: rhymePairAppTsx },
];

export function gameById(id: string, library: readonly GameTemplate[] = GAME_LIBRARY): GameTemplate | undefined {
  return library.find((game) => game.id === id);
}

export function materializeGame(game: GameTemplate, skin: { title?: string; accent?: string } = {}): string {
  const title = (skin.title || game.title).replace(/[<>]/g, '').slice(0, 40);
  const accent = /^#[0-9a-fA-F]{6}$/.test(skin.accent || '') ? skin.accent! : game.accent;
  return game.appTsx.replaceAll('__TITLE__', title).replaceAll('__ACCENT__', accent);
}

export function gameScaffold(game: GameTemplate, skin: { title?: string; accent?: string } = {}): GoldenScaffold {
  const title = (skin.title || game.title).replace(/[<>]/g, '').slice(0, 40);
  return { id: game.id, label: title, title, appTsx: materializeGame(game, { ...skin, title }), tier: 'simple' };
}
