// 🏟️ CRICKET AND FOOTBALL ON THE WORLD — THE MATCH ON A VENUE (map expansion plan, item 7).
//
// Owner decision (2026-11-23): a cricket or football game gets a world around its ground ONLY when the user asks for one.
// This kit module is how the match stands on the world: the open world (the item-5 world layer) is laid with the game's
// ground as a VENUE region (#4483 — a level pad, the real markings and, for football, the goals, joined to a town by road),
// and the match gets ONE group, `root`, standing on that pad. Everything the match has (players, ball, stumps, the
// camera rig if it wants) goes into `root` at the positions it uses today — the layout's own metres, 0,0 the centre — so the
// rules, the ball's physics and the players are exactly what they were: only where the ground stands has changed. The
// world streams round the ground (or round whatever the game says to follow, for a walk outside).
//
// NOT shipped by any recipe: written into a project only on the user's own request, by the platform (AgentV3/sportsWorld.ts,
// behind AGENTV3_SPORTS_WORLD, off by default). A game without it is exactly as before.
export const WORLD_VENUE_PATH = 'src/game/play/worldVenue.ts';

export const WORLD_VENUE = String.raw`// THE MATCH ON THE WORLD: the game's ground stands on the open world as a venue (a level pad with real markings, joined to a
// town by road), and the match stands on it inside ONE group, root. Put every match thing in root at the positions it uses
// on its own ground (0,0 = the centre; the layouts' own metres) and turn the layout by heading — the rules, the ball and the
// players are unchanged. Use startVenueWorld() in setup() and venueWorld.frame(ctx, dt) in update().
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { createWorldLayer, type WorldLayer } from './worldLayer';
import type { OpenWorldVenue, WorldRegion } from './openWorld';

export type MatchVenue = 'cricket-ground' | 'football-field' | 'stadium';

export interface VenueWorldOptions {
  /** The ground the match is played on. A stadium is a football field with stands. */
  venue: MatchVenue;
  /** The places of the world. Default: src/game/world.ts WORLD.regions (when the game has one), else a town beside the ground. */
  regions?: ReadonlyArray<WorldRegion>;
  /** Which venue region, when the world has more than one of that kind. Default: the first. */
  venueId?: string;
  /** What the world streams round. Default: the ground itself (the match stays on it). The player, for a walk outside. */
  follow?: THREE.Object3D | (() => THREE.Object3D | null | undefined);
  seed?: number;
}

export interface VenueWorld {
  readonly world: WorldLayer;
  readonly venue: OpenWorldVenue;
  /** The match's group, standing on the venue's level ground at its centre. Add the match's things to it. */
  readonly root: THREE.Group;
  /**
   * The heading to give the layout so it lines up with the ground the world draws (footballLayout({ heading }) /
   * cricketLayout({ heading })): a football pitch is drawn along x, a cricket pitch along z.
   */
  readonly heading: number;
  /** The venue's scale against its standard size (1 unless world.ts gave it a size); root is scaled by it, so the match fits the markings. */
  readonly scale: number;
  /** A match point (root's own metres) as a WORLD place: for the minimap, a marker, or a walk back to the ground. */
  toWorld(x: number, z: number): { x: number; y: number; z: number };
  /** Every frame: the world streams. */
  frame(ctx: GameContext, dt: number): void;
  dispose(): void;
}

const HOME = (venue: MatchVenue): WorldRegion[] => [
  { id: 'home-town', kind: 'town' },
  { id: 'home-ground', kind: 'venue', venue, joinTo: 'home-town' },
] as WorldRegion[];

function ownRegions(): ReadonlyArray<WorldRegion> | null {
  try {
    const found = import.meta.glob('../world.ts', { eager: true, import: 'WORLD' }) as Record<string, { regions?: ReadonlyArray<WorldRegion> } | undefined>;
    const regions = Object.values(found)[0]?.regions;
    return Array.isArray(regions) && regions.length > 0 ? regions : null;
  } catch { return null; }
}

/** The places: the given ones, or the game's own, with the ground added beside the first place when they have none. */
export function venueRegions(venue: MatchVenue, given?: ReadonlyArray<WorldRegion> | null): WorldRegion[] {
  const list = (given && given.length ? [...given] : HOME(venue)) as WorldRegion[];
  if (list.some((r) => r.kind === 'venue' && r.venue === venue)) return list;
  const first = list.find((r) => r.kind !== 'venue');
  const ids = new Set(list.map((r) => r.id));
  let id = 'home-ground';
  for (let n = 2; ids.has(id); n++) id = 'home-ground-' + n;
  return [...list, { id, kind: 'venue', venue, ...(first ? { joinTo: first.id } : {}) } as WorldRegion];
}

/** Throws (with a reason a person can read) when the world has no ground of that kind: the game keeps its own ground. */
export function startVenueWorld(ctx: GameContext, options: VenueWorldOptions): VenueWorld {
  const regions = venueRegions(options.venue, options.regions ?? ownRegions());
  const root = new THREE.Group();
  root.name = 'Match';
  const world = createWorldLayer(ctx, { regions, follow: options.follow ?? root, placeAtSpawn: false, ...(options.seed !== undefined ? { seed: options.seed } : {}) });
  const venue = world.venues.find((v) => (options.venueId ? v.id === options.venueId : v.venue === options.venue));
  if (!venue) {
    world.dispose();
    throw new Error('this world has no ' + options.venue + ' on it (no dry, level ground was found for it)');
  }
  const a = venue.toWorld(0, 0), b = venue.toWorld(1, 0);
  const scale = Math.abs(b.x - a.x) || 1;
  root.scale.setScalar(scale);
  world.place(root, venue.centre.x, venue.centre.z);
  return {
    world, venue, root, scale,
    heading: options.venue === 'cricket-ground' ? 0 : Math.PI / 2,
    toWorld: (x, z) => venue.toWorld(x, z),
    frame(c, dt) { world.frame(c, dt); },
    dispose() { world.release(root); root.removeFromParent(); world.dispose(); },
  };
}
`;
