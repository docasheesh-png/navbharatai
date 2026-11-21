// failedbr #1349 (2026-11-20): "Muje ek game banani hai\nFf india jisa" ("a game like FF India" = Free Fire) got a
// 2D-only kit: "The request does not say this game is 3D". "free fire" was a royale; its shorthand was not.
import { describe, expect, it } from 'vitest';
import { gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';
import { BATTLE_ROYALE_REFERENCE } from '../src/server/lib/wellKnownGameTitles';

describe('Free Fire shorthand is a royale (failedbr #1349)', () => {
  it.each(['Muje ek game banani hai\nFf india jisa', 'ff max jaisa game banao', 'ffmax game banao', 'FF game banao'])('3D: %s', (p) => {
    expect(gameKitWants3D(p)).toBe(true);
  });
  it.each(['color #ff0000 button app', 'set background to ff and build a todo app', 'staff attendance app'])('not a royale: %s', (p) => {
    expect(BATTLE_ROYALE_REFERENCE.test(p)).toBe(false);
  });
});
