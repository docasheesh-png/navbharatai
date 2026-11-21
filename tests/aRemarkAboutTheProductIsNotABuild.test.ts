// failedbr #1879 (2026-11-20): "YouTube dekh raha tha aur Mujhe Tera add Mila … Tu To game banate hi nahin hai"
// (I was watching YouTube and saw your ad … you don't even make games) was built: the word "game" confirmed a
// build, and "YouTube dekh raha tha" made it a YouTube-clone roadmap with a game kit.
import { describe, expect, it } from 'vitest';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

const REAL_1879 = 'YouTube dekh raha tha aur Mujhe Tera add Mila Maine Socha Tujhse Manana to Aasan Hogaya Tu To game banate hi nahin hai';

describe('a remark about what NavBharatAI makes is answered, not built (failedbr #1879)', () => {
  it('the real #1879 message does not confirm a build', () => {
    expect(buildConfirmation(REAL_1879).confirmed).toBe(false);
  });

  it.each(['you guys dont even make games', 'tum log app nahi bana sakte', 'ye game bana nahi sakta', 'tum log games banate hi nahi', 'तुम गेम बनाते ही नहीं'])(
    'a negated statement does not confirm: %s', (m) => {
      expect(buildConfirmation(m).confirmed).toBe(false);
    });

  it.each(['tu to game banate hi nahin hai, ek racing game bana do', 'a snake game', 'ludo game', 'calculator app chahiye', 'ek game jo bacche khel sake', 'Build a todo app, dont make it complicated'])(
    'a request still confirms: %s', (m) => {
      expect(buildConfirmation(m).confirmed).toBe(true);
    });
});

describe('watching a product is not cloning it (failedbr #1879)', () => {
  it.each([REAL_1879, 'YouTube dekh raha tha aur ek todo app banao', 'Instagram pe ek reel dekhi, ek notes app banao', 'Spotify sunte hue ek timer app banao'])(
    'no clone: %s', (m) => {
      expect(analyzeAppScope(m).famousApp).toBeNull();
    });

  it.each(['YouTube jaisa app banao', 'Build a YouTube clone', 'make an app like Instagram'])('a clone request is still one: %s', (m) => {
    expect(analyzeAppScope(m).famousApp).not.toBeNull();
  });
});
