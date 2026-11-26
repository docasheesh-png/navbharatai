/**
 * Print the game-maker coverage scoreboard (src/server/AgentV3/gameCoverage.ts): how many of the fifty canonical games get a
 * starter, a rules engine or a genre kit, and which ones the builder still has to improvise. Planning only — no build runs.
 *
 *   npm run game:coverage
 */
import { CANONICAL_GAMES, coverageBoard, coverageSummary } from '../src/server/AgentV3/gameCoverage';

const board = coverageBoard();
console.log(coverageSummary(board));
console.log('');
for (const [i, r] of board.entries()) {
  const g = CANONICAL_GAMES[i];
  console.log(`${r.coverage.padEnd(10)} ${r.id.padEnd(18)} ${r.genre.padEnd(10)} ${r.places.join('+').padEnd(16)} ${g.note ?? ''}`);
}
