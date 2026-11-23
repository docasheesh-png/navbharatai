/** Original, bounded offline practice rules. No network, billing or user-project mutation. */
export const GAME_ROYALE_RULES = `export const BOT_COUNT = 2;
export const ARENA_HALF = 42;
export type LootKind = 'medkit' | 'armor';
export type Crate = { x: number; z: number; kind: LootKind; taken: boolean };
export type Match = {
  elapsed: number; health: number; bots: number[]; cooldown: number; result: 'playing' | 'won' | 'lost';
  /** Armour soaks bullet damage before health (the zone ignores it). */
  armor: number; botArmor: number[];
  /** Crates on the ground; anyone who walks over one takes it. */
  loot: Crate[];
  kills: number; damageDealt: number;
  /** What ended the run: 'zone', 'bot 1', 'bot 2' … or '' while playing. */
  cause: string;
  /** Short lines for the kill feed, newest last. */
  feed: string[];
};
/** EXTRAS (template round R6; ideas studied from open-source shooters, our own code): crates to loot, armour, a kill
 * feed, a placement at the end, and a zone warning. The arena and the bots are the same as before. */
export const LOOT_SPOTS: ReadonlyArray<readonly [number, number, LootKind]> = [
  [-12, -5, 'medkit'], [14, 8, 'armor'], [-22, 22, 'medkit'], [26, -20, 'armor'], [2, -30, 'medkit'], [-30, -24, 'armor'],
];
export const MEDKIT_HEAL = 35;
export const ARMOR_POINTS = 50;
export const ZONE_DAMAGE = 12;
export const PICKUP_RADIUS = 1.6;
export function initialMatch(): Match {
  return { elapsed: 0, health: 100, bots: [100, 100], cooldown: 0, result: 'playing', armor: 0, botArmor: [0, 0],
    loot: LOOT_SPOTS.map(([x, z, kind]) => ({ x, z, kind, taken: false })), kills: 0, damageDealt: 0, cause: '', feed: [] };
}
const say = (match: Match, line: string): void => { match.feed = [...match.feed, line].slice(-4); };
export function zoneRadius(elapsed: number): number { return Math.max(4, 38 - Math.max(0, elapsed) * 0.22); }
export function stepMatch(match: Match, delta: number, distance: number): void {
  if (match.result !== 'playing' || !Number.isFinite(delta) || delta <= 0) return;
  const dt = Math.min(delta, 0.1);
  match.elapsed += dt; match.cooldown = Math.max(0, match.cooldown - dt);
  if (distance > zoneRadius(match.elapsed)) { match.health = Math.max(0, match.health - ZONE_DAMAGE * dt); if (match.health <= 0) match.cause = 'zone'; }
  if (match.health <= 0) match.result = 'lost';
  else if (match.bots.every(h => h <= 0)) match.result = 'won';
}
export function fire(match: Match, bot: number | null): boolean {
  if (match.result !== 'playing' || match.cooldown > 0) return false;
  match.cooldown = 0.25;
  if (bot !== null && Number.isInteger(bot) && bot >= 0 && bot < BOT_COUNT && match.bots[bot] > 0) {
    const armor = match.botArmor?.[bot] ?? 0, soaked = Math.min(armor, 34);
    if (match.botArmor) match.botArmor[bot] = armor - soaked;
    const before = match.bots[bot];
    match.bots[bot] = Math.max(0, before - (34 - soaked));
    match.damageDealt = (match.damageDealt ?? 0) + (before - match.bots[bot]) + soaked;
    if (match.bots[bot] <= 0) { match.kills = (match.kills ?? 0) + 1; say(match, 'You eliminated bot ' + (bot + 1)); }
  }
  return true;
}
/** A bot's shot lands on the player: armour first, then health. */
export function hitPlayer(match: Match, amount: number, bot: number): void {
  if (match.result !== 'playing' || !(amount > 0)) return;
  const soaked = Math.min(match.armor, amount);
  match.armor -= soaked; match.health = Math.max(0, match.health - (amount - soaked));
  if (match.health <= 0) { match.result = 'lost'; match.cause = 'bot ' + (bot + 1); }
}
/** Anyone standing on an untaken crate takes it. who: -1 for the player, else a bot's index. Returns the crate taken. */
export function pickUp(match: Match, who: number, x: number, z: number): Crate | null {
  if (match.result !== 'playing') return null;
  if (who >= 0 && !(match.bots[who] > 0)) return null;
  const crate = match.loot.find((c) => !c.taken && Math.hypot(c.x - x, c.z - z) <= PICKUP_RADIUS);
  if (!crate) return null;
  crate.taken = true;
  if (who < 0) {
    if (crate.kind === 'medkit') match.health = Math.min(100, match.health + MEDKIT_HEAL); else match.armor = Math.min(100, match.armor + ARMOR_POINTS);
    say(match, 'You picked up ' + (crate.kind === 'medkit' ? 'a medkit' : 'armour'));
  } else {
    if (crate.kind === 'medkit') match.bots[who] = Math.min(100, match.bots[who] + MEDKIT_HEAL); else match.botArmor[who] = Math.min(100, match.botArmor[who] + ARMOR_POINTS);
    say(match, 'Bot ' + (who + 1) + ' picked up ' + (crate.kind === 'medkit' ? 'a medkit' : 'armour'));
  }
  return crate;
}
/** The nearest untaken crate inside the safe zone (bots go looting when they are not fighting). */
export function nearestCrate(match: Match, x: number, z: number): Crate | null {
  const r = zoneRadius(match.elapsed) - 2;
  let best: Crate | null = null, bestD = Infinity;
  for (const c of match.loot) {
    if (c.taken || Math.hypot(c.x, c.z) > r) continue;
    const d = Math.hypot(c.x - x, c.z - z); if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
/** Metres outside the safe zone (0 inside) — for the zone warning. */
export function outsideBy(match: Match, distance: number): number { return Math.max(0, distance - zoneRadius(match.elapsed)); }
/** Place in the match: 1 when you won, otherwise 1 + bots still standing. */
export function placement(match: Match): number { return match.result === 'won' ? 1 : 1 + match.bots.filter((h) => h > 0).length; }
/** THE DROP: the plane crosses the arena along z = DROP_LINE_Z from -x to +x in DROP_SECONDS at DROP_HEIGHT. */
export const DROP_SECONDS = 8;
export const DROP_HEIGHT = 30;
export const DROP_LINE_Z = 10;
export const FALL_SPEED = 9;
export function planeX(t: number): number { return -ARENA_HALF + 4 + (2 * ARENA_HALF - 8) * Math.min(1, Math.max(0, t / DROP_SECONDS)); }
`;
export function generateGameRoyaleFoundation() {
  return { files: { 'src/game/royale/rules.ts': GAME_ROYALE_RULES }, dependencies: [] as Array<{ name: string; version: string }>, instructions: 'Offline practice rules only: two bots, finite arena, no multiplayer or billing.' };
}
