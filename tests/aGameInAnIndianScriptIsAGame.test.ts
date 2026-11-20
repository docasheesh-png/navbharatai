// 🎮 "गेम" IS A GAME (failedbr #2163, 2026-11-20).
//
// "हम मुझे एक ऐसा गेम बना कर दो कर रेसिंग वाला जिसमें कर आगे भी चलती हो इंफिनिटी रोड हो …" — a racing game asked for
// entirely in Devanagari — read as domain `general`: no game kit, no game contract, the fast lane. Only "खेल" was
// known; the transliterated "गेम" (and its siblings in the other Indian scripts) was not.
// Reversion: drop the script alternatives from the game domain's regex and the first test fails.

import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const REPORT = 'हम मुझे एक ऐसा गेम बना कर दो कर रेसिंग वाला जिसमें कर आगे भी चलती हो इंफिनिटी रोड हो और लेफ्ट राइट भी होती है और आगे भी चलती हो इसको और भीमिलते हो';

describe("#2163: a game asked for in Devanagari gets the game path", () => {
  it("the report's prompt is a game and gets the kit", () => {
    expect(analyzeRequirementGaps(REPORT).domain).toBe('game');
    expect(gameKitPlan(REPORT, 'vite-react').length).toBeGreaterThan(0);
  });
  it.each(['एक कार रेसिंग गेम बनाओ', 'একটা রেসিং গেম বানাও', 'એક કાર રેસિંગ ગેમ બનાવો', 'ఒక కార్ రేసింగ్ గేమ్ చేయండి', 'ஒரு கார் ரேசிங் கேம் உருவாக்கு'])('%s', (p) => {
    expect(analyzeRequirementGaps(p).domain).toBe('game');
  });
});

describe('the boundaries', () => {
  it('an ordinary Hindi app request is not a game', () => {
    expect(analyzeRequirementGaps('मेरे लिए एक दुकान का हिसाब रखने वाला ऐप बनाओ').domain).not.toBe('game');
  });
});
