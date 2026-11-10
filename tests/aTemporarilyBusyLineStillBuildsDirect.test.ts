// BR1970 (report 4a2ffae854…, 2026-11-08) — "The AI service is temporarily busy. Please try again
// in 1-2 minutes."
//
// A 9.7s stopped turn. The prompt is the platform’s English Free busy line without the trailing
// folded-hands emoji (freeBusyMessage / AIRouter fallback). It was admitted as an ordinary
// unsized edit (ETA 5–14 min, key edit_unsized). Setup then hit SANDBOX_UNAVAILABLE — E2B’s
// concurrent cap of 20 (already queued as Q-2621). The user stopped ~4s later; nothing was
// written; zeroBillReasonFor({ok:false, stoppedByUser:true}) is "stopped by the user before any
// file was written — never charged".
//
// This lock pins today’s admission (a known busy line is still an ordinary direct/small ask)
// and the zero-rupee stop. Filtering our own busy copy out of the builder is Q-2642, not shipped:
// a request that only happens to contain those words (a status-page banner, a screenshot caption)
// must not be refused. The E2B cap itself stays Q-2621.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';
import { freeBusyMessage } from '../src/server/lib/freeBusyMessage';
import { zeroBillReasonFor } from '../src/server/AgentV3/zeroBillReason';

export const BR1970_PROMPT = 'The AI service is temporarily busy. Please try again in 1-2 minutes.';

describe('BR1970: a service-busy line is still admitted as an ordinary ask today', () => {
  it("this report's prompt is the English busy line without the emoji, and stays ordinary/direct", () => {
    expect(freeBusyMessage('Please build me an app')).toBe(`${BR1970_PROMPT} 🙏`);
    expect(BR1970_PROMPT).toBe(freeBusyMessage('Please build me an app').replace(/\s*🙏\s*$/u, ''));
    const scope = analyzeAppScope(BR1970_PROMPT);
    expect(scope.decision).toBe('direct');
    expect(scope.size).toBe('small');
    expect(scope.famousApp).toBeNull();
    expect(scopeVerdict(BR1970_PROMPT, { complex: true }).large).toBe(false);
    expect(analyzeRequirementGaps(BR1970_PROMPT).domain).toBe('general');
    expect(fastLaneSkipsGame('general')).toBe(false);
    expect(gameKitPlan(BR1970_PROMPT)).toEqual([]);
  });

  it('a user-stop before any file is written is never charged', () => {
    expect(zeroBillReasonFor({ ok: false, stoppedByUser: true }))
      .toBe('stopped by the user before any file was written — never charged');
    expect(zeroBillReasonFor({ ok: false, stoppedByUser: false }))
      .toBe('empty build (0 files produced) — never charged');
  });

  it('Hindi and Hinglish busy lines, and a genuine continue, stay ordinary too', () => {
    for (const prompt of [
      freeBusyMessage('Namaste bhai'),
      freeBusyMessage('मुझे मदद चाहिए'),
      'Continue from where you left off and finish/fix the build so the app works end-to-end.',
    ]) {
      expect(analyzeAppScope(prompt).decision).toBe('direct');
      expect(analyzeRequirementGaps(prompt).domain).not.toBe('game');
    }
  });
});
