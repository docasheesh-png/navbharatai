// failedbr #1277 (2026-11-20): "📨 The team picked up your message: "/** * The game loop — FIXED TIMESTEP…"" — a file body
// pasted mid-build with no words was handed to the builder as an order to act on.
import { describe, expect, it } from 'vitest';
import { liveUserMessageTurn } from '../src/server/AgentV3/AgentRunner';

const LOOP = `/**
 * The game loop — FIXED TIMESTEP.
 */
export function startLoop(step: (dt: number) => void): () => void {
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}`;

describe('a file pasted mid-build is a file, not an order (failedbr #1277)', () => {
  it('says what the paste is and forbids inventing a feature from it', () => {
    const turn = liveUserMessageTurn(LOOP);
    expect(turn).toMatch(/source code with no words/);
    expect(turn).toMatch(/Never invent a feature from it/);
    expect(turn).toContain('FIXED TIMESTEP');
  });
  it('an ordinary live message is unchanged', () => {
    expect(liveUserMessageTurn('make the car red')).not.toMatch(/source code with no words/);
  });
});
