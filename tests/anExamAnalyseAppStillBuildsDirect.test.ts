// BR1964 (report 1041906b…, 2026-11-08) — "Mujhe higher exam hard exam analyse app banana hai"
// failed after the free 25-minute wall-clock cap (1500 s). APP_SCOPE treated it as an ordinary
// one-shot (no mega-signal) — correct for this short ask. The fast lane salvaged 20 files;
// a preview rendered at 14 min (IN_BUILD_GREEN, 35 files); STYLE_RULES_RESUMED then handed
// back 30 missing classes + an a11y item with ~80 s left, and the cap fired before the app
// was judged finished. This file neighbour-locks the scope reading. The timeout / late style
// hand-back are queued (Q-2630, Q-2631), not "fixed" by raising the cap or claiming complete
// over missing styles (autopsy 2f723acb).
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { deadlinePauseMessage } from '../src/server/AgentV3/DeadlinePause';

const PROMPT = 'Mujhe higher exam hard exam analyse app banana hai';

describe('BR1964: an exam-analyse ask still builds as an ordinary one-shot', () => {
  it('scope stays ordinary/direct — this short ask is not LARGE', () => {
    const s = analyzeAppScope(PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.famousApp).toBeNull();
    expect(s.signals.some((x) => /no mega-signal — treated as an ordinary one-shot app/i.test(x))).toBe(true);
  });

  it('requirement-gap analysis still reads the education domain (observed on this report)', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('education');
  });

  it('the deadline-pause summary matches this report\'s user-facing line (RC-4 honest wording)', () => {
    const m = deadlinePauseMessage(37);
    expect(m.summary).toBe(
      'Time limit reached — 37 files changed so far. The previous work is still stopping. Please retry after it finishes.',
    );
    expect(m.narration).toBe(`⏱️ ${m.summary}`);
    expect(m.summary.toLowerCase()).not.toContain('almost done');
  });
});
