// BR1965 (report ebece6c8…, 2026-11-08) — the platform "Fix with AI" continue
// "Continue from where you left off and finish/fix the build so the app works end-to-end."
// succeeded in 8.8 min on an existing NOVA AI assistant (the builder replaced a mock
// aiService with window.NavAI.ask, the documented host path). APP_SCOPE treated it as
// an ordinary one-shot (no mega-signal) — correct for this short platform sentence.
// PROJECT_MODE correctly created no new plan (not a fresh build). This file
// neighbour-locks the scope reading and the constant itself. Unpinned @types/react
// and typescript installs that then tripped a v19-vs-v18 types-mismatch and TS5102
// are queued (Q-2633), not "fixed" by capping majors.
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import {
  CONTINUE_AND_FIX_BUILD_PROMPT,
  isPlatformContinuePrompt,
} from '../src/lib/continueBuildPrompts';
import { isContinuationMessage } from '../src/server/AgentV3/ProjectPlan';

const PROMPT = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';

describe('BR1965: a Fix-with-AI continue still edits as an ordinary one-shot', () => {
  it('this report used the platform continue constant verbatim', () => {
    expect(CONTINUE_AND_FIX_BUILD_PROMPT).toBe(PROMPT);
    expect(isPlatformContinuePrompt(PROMPT)).toBe(true);
    expect(isContinuationMessage(PROMPT)).toBe(true);
  });

  it('scope stays ordinary/direct — this short continue sentence is not LARGE', () => {
    const s = analyzeAppScope(PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.famousApp).toBeNull();
    expect(s.signals.some((x) => /no mega-signal — treated as an ordinary one-shot app/i.test(x))).toBe(true);
  });
});
