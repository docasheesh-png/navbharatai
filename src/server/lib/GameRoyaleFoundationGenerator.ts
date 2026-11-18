/** Original, bounded offline practice rules. No network, billing or user-project mutation. */
export const GAME_ROYALE_RULES = `export const BOT_COUNT = 2;
export const ARENA_HALF = 42;
export type Match = { elapsed: number; health: number; bots: number[]; cooldown: number; result: 'playing' | 'won' | 'lost' };
export function initialMatch(): Match { return { elapsed: 0, health: 100, bots: [100, 100], cooldown: 0, result: 'playing' }; }
export function zoneRadius(elapsed: number): number { return Math.max(4, 38 - Math.max(0, elapsed) * 0.22); }
export function stepMatch(match: Match, delta: number, distance: number): void {
  if (match.result !== 'playing' || !Number.isFinite(delta) || delta <= 0) return;
  const dt = Math.min(delta, 0.1);
  match.elapsed += dt; match.cooldown = Math.max(0, match.cooldown - dt);
  if (distance > zoneRadius(match.elapsed)) match.health = Math.max(0, match.health - 12 * dt);
  if (match.health <= 0) match.result = 'lost';
  else if (match.bots.every(h => h <= 0)) match.result = 'won';
}
export function fire(match: Match, bot: number | null): boolean {
  if (match.result !== 'playing' || match.cooldown > 0) return false;
  match.cooldown = 0.25;
  if (bot !== null && Number.isInteger(bot) && bot >= 0 && bot < BOT_COUNT) match.bots[bot] = Math.max(0, match.bots[bot] - 34);
  return true;
}
`;
export function generateGameRoyaleFoundation() {
  return { files: { 'src/game/royale/rules.ts': GAME_ROYALE_RULES }, dependencies: [] as Array<{ name: string; version: string }>, instructions: 'Offline practice rules only: two bots, finite arena, no multiplayer or billing.' };
}
