// The game template library (owner t414u). One list. Adding or removing a template is one row here.
// The first six are the ones people ask for most. The other twenty-eight categories wait for the next batch.
// A template is a starting point: the source says so, and a later edit may change any of it.

import type { GoldenScaffold } from '../goldenScaffolds/registry';
import { laneDashAppTsx } from './games/laneDash';
import { courtyardAppTsx } from './games/courtyard';
import { gullyInningsAppTsx } from './games/gullyInnings';
import { stackTilesAppTsx } from './games/stackTiles';
import { ringRallyAppTsx } from './games/ringRally';
import { bellRoundAppTsx } from './games/bellRound';
import { pairGroveAppTsx } from './games/pairGrove';
import { dodgeFallAppTsx } from './games/dodgeFall';
import { ladderPathAppTsx } from './games/ladderPath';
import { threeLeavesAppTsx } from './games/threeLeaves';
import { trailWalkAppTsx } from './games/trailWalk';
import { pavilionAppTsx } from './games/pavilion';
import { gardenMatchAppTsx } from './games/gardenMatch';

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
  { id: 'ring-rally', title: 'Ring Rally', category: 'Racing', accent: '#be123c', appTsx: ringRallyAppTsx },
  { id: 'bell-round', title: 'Bell Round', category: 'Trivia', accent: '#0369a1', appTsx: bellRoundAppTsx },
  // Existing starters, registered here as the playable library face. One row adds or removes each.
  { id: 'trail-walk', title: 'Trail Walk', category: 'Adventure', accent: '#15803d', appTsx: trailWalkAppTsx },
  { id: 'pair-grove', title: 'Pair Grove', category: 'Casual', accent: '#7c3aed', appTsx: pairGroveAppTsx },
  { id: 'dodge-fall', title: 'Dodge Fall', category: 'Arcade', accent: '#ea580c', appTsx: dodgeFallAppTsx },
  { id: 'ladder-path', title: 'Ladder Path', category: 'Board', accent: '#0f766e', appTsx: ladderPathAppTsx },
  { id: 'three-leaves', title: 'Three Leaves', category: 'Card', accent: '#1d4ed8', appTsx: threeLeavesAppTsx },
  { id: 'pavilion', title: 'Pavilion', category: 'Sports', accent: '#b45309', appTsx: pavilionAppTsx },
  { id: 'garden-match', title: 'Garden Match', category: 'Puzzle', accent: '#16a34a', appTsx: gardenMatchAppTsx },
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
