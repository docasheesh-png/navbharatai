/**
 * failedbr #686 (queue Q-3215): "Game bnao" was planned as Snake; the user then sent "Game bnao bike race" mid-build,
 * which was picked up — and the live-message turn told the model to act "without discarding progress", so it kept
 * building Snake. A message that names a different app is the user's choice, and it wins.
 */
import { describe, expect, it } from 'vitest';
import { liveUserMessageTurn } from '../src/server/AgentV3/AgentRunner';

describe('a live message that changes what is built', () => {
  const turn = liveUserMessageTurn('Game bnao bike race');
  it('tells the model the new choice wins, and never to keep the old app', () => {
    expect(turn).toMatch(/If it changes WHAT is being built[^]*the user's new choice wins/);
    expect(turn).toMatch(/never keep building the old one/);
    expect(turn).not.toMatch(/Act on it now without discarding progress/);
  });
  it('🔒 an ordinary tweak still keeps the progress, and the message itself is carried', () => {
    expect(turn).toMatch(/Otherwise keep the progress made so far/);
    expect(turn.endsWith('\nGame bnao bike race')).toBe(true);
  });
});
