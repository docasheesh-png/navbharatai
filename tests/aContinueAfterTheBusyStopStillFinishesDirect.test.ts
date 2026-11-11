// BR1971 (report 5b29f5747…, 2026-11-08) — same workspace as BR1970
// (agentv3-v1PafwMznwgkH9HhZTwiZ9TBVgx1-37b1faa9-18af-4461-95e8-246d9de1e073).
//
// About 10 seconds after the BR1970 user-stop (busy-service line, SANDBOX_UNAVAILABLE,
// nothing written, not charged), the platform continue prompt
// "Continue from where you left off and finish/fix the build so the app works end-to-end."
// succeeded in 5.4 min (ETA 4.5–13.6 min, inside the band). The builder grounded three
// existing files, wrote a neighborhood simulation (Gujarati UI, start/stop), typechecked
// clean, rendered at 150s, MOBILE_LAYOUT_OK at 390×844, explorer pressed 2 controls,
// RELEASE_GATE GREEN. Charged ₹1.21 (10% discount applied).
//
// This lock pins: the continue prompt is the platform constant and stays ordinary/direct;
// it is not a busy-service line (Q-2642, if shipped, must match the current prompt only —
// a continue after a previous busy-line stop must still build); the BR1970 English busy
// line is 68 characters (not 67). No admission filter is shipped here.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import {
  CONTINUE_AND_FIX_BUILD_PROMPT,
  isPlatformContinuePrompt,
} from '../src/lib/continueBuildPrompts';
import { isContinuationMessage } from '../src/server/AgentV3/ProjectPlan';
import { freeBusyMessage } from '../src/server/lib/freeBusyMessage';
import { BR1970_PROMPT } from './aTemporarilyBusyLineStillBuildsDirect.test';

const PROMPT =
  'Continue from where you left off and finish/fix the build so the app works end-to-end.';

describe('BR1971: a continue after the busy-line stop still finishes as an ordinary edit', () => {
  it('this report used the platform continue constant verbatim', () => {
    expect(CONTINUE_AND_FIX_BUILD_PROMPT).toBe(PROMPT);
    expect(isPlatformContinuePrompt(PROMPT)).toBe(true);
    expect(isContinuationMessage(PROMPT)).toBe(true);
    expect(PROMPT).toHaveLength(86);
  });

  it('scope stays ordinary/direct — this short continue sentence is not LARGE', () => {
    const s = analyzeAppScope(PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.famousApp).toBeNull();
    expect(scopeVerdict(PROMPT, { complex: true }).large).toBe(false);
    expect(s.signals.some((x) => /no mega-signal — treated as an ordinary one-shot app/i.test(x))).toBe(true);
    expect(analyzeRequirementGaps(PROMPT).domain).not.toBe('game');
  });

  it('is not a busy-service line — Q-2642 must match the current prompt only', () => {
    expect(BR1970_PROMPT).toHaveLength(68);
    expect(BR1970_PROMPT).toBe(freeBusyMessage('Please build me an app').replace(/\s*🙏\s*$/u, ''));
    expect(PROMPT).not.toBe(BR1970_PROMPT);
    expect(isPlatformContinuePrompt(BR1970_PROMPT)).toBe(false);
    expect(isContinuationMessage(BR1970_PROMPT)).toBe(false);
    for (const busy of [
      BR1970_PROMPT,
      freeBusyMessage('Please build me an app'),
      freeBusyMessage('Namaste bhai'),
      freeBusyMessage('मुझे मदद चाहिए'),
    ]) {
      expect(isPlatformContinuePrompt(busy)).toBe(false);
      expect(busy.includes(PROMPT)).toBe(false);
      expect(PROMPT.includes(busy.replace(/\s*🙏\s*$/u, ''))).toBe(false);
    }
  });
});
