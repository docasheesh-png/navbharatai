// BR1972 (report 4b5e2028…, 2026-11-08) — "मुझे एक education app बनाना है app नाम है edu ai
// examination Assistant" succeeded in ~22 min as an ordinary one-shot. APP_SCOPE is ordinary/direct
// (correct). Requirement-gap analysis reads domain=general, not education: the education regex
// has `\bexam\b` and Hindi परीक्षा but not the words "education" or "examination"
// ("examination" is not `\bexam\b`). Widening that regex is queued (Q-2644) because education
// is listed before fintech and first-match-win would steal "education loan app". This file
// neighbour-locks the observed reading. The recap "Fully responsive design that works on both
// mobile and desktop" is not SIZE_CLAIMED today (Q-2611; do not ship a claim-audit widening).
// GAME_PLAYTEST_NOT_RUN called the MCQ UI a "quiz game"; domain stays not-game.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

export const BR1972_PROMPT = 'मुझे एक education app बनाना है app नाम है edu ai examination Assistant';

const EXAM_ANALYSE = 'Mujhe higher exam hard exam analyse app banana hai';

const RECAP = [
  'I\'ve successfully created a professional AI-powered Education App named "EDU AI – EXAMINATION ASSISTANT" with all the requested features.',
  '### Design & Theme',
  '- Fully responsive design that works on both mobile and desktop',
  'The application is now fully functional and ready for use.',
  'The app works smoothly on both Android phones and computers, meeting all the requirements specified.',
].join('\n');

describe('BR1972: an edu-ai examination-assistant ask still builds as an ordinary one-shot', () => {
  it('the prompt is 70 characters (JS/Unicode code units; Devanagari is in the BMP)', () => {
    expect(BR1972_PROMPT.length).toBe(70);
  });

  it('scope stays ordinary/direct — this short ask is not LARGE and not a famous clone', () => {
    const s = analyzeAppScope(BR1972_PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.famousApp).toBeNull();
    expect(s.signals.some((x) => /no mega-signal — treated as an ordinary one-shot app/i.test(x))).toBe(true);
  });

  it('requirement-gap analysis still reads domain=general (not education, not game)', () => {
    expect(analyzeRequirementGaps(BR1972_PROMPT).domain).toBe('general');
    expect(gameKitPlan(BR1972_PROMPT)).toHaveLength(0);
  });

  it('neighbours keep their domains: exam-analyse is education; education-loan is fintech; "education app" stays general', () => {
    expect(analyzeRequirementGaps(EXAM_ANALYSE).domain).toBe('education');
    expect(analyzeRequirementGaps('Make an education app').domain).toBe('general');
    expect(analyzeRequirementGaps('examination Assistant').domain).toBe('general');
    expect(analyzeRequirementGaps('education loan app').domain).toBe('fintech');
    expect(analyzeRequirementGaps('Make a bike racing game').domain).toBe('game');
  });

  it("this report's recap is not a size claim today, even when the phone check failed (Q-2611)", () => {
    const kinds = (facts: Parameters<typeof auditSummaryClaims>[1]) =>
      auditSummaryClaims(RECAP, facts).map((c) => c.kind);
    expect(kinds({
      consoleCaptured: true,
      previewVerified: true,
      filesWritten: 19,
      buildWasRequested: true,
      sourceIsWholeApp: true,
      sourceText: 'export default function App(){ return <header className="nb-topbar">EDU AI</header>; }',
      phoneLayout: 'failed',
    })).not.toContain('size-contradicted');
  });
});
