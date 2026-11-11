// BR1967 (report cffea1301e…, 2026-11-08) — "Upgrade my AI Anime Video Generator…"
//
// APP_SCOPE correctly read this as LARGE (~12 distinct features) and the mega-app
// roadmap planned six infra-ceilinged checkpoints, then the fast lane built milestone 1
// (a Hindi story + duration form) as a 7-file SIMPLE_BUILD_SUCCESS. That hand-off is
// designed: Q-975 / milestoneLaneRequest exist so the simple lane receives the
// milestone brief, not the whole later video pipeline. This file locks the readings
// that must not regress, and documents two check-limits that are queued rather than
// widened (t311u):
//
//   - The prompt stays LARGE / analyze (not a 7-file simple/direct scope).
//   - A video/anime generator is not an in-app image-generation app, so
//     fastLaneSkipsImageApp stays false (milestone 1 is local scene division;
//     skipping the cheap preview would send it to the full builder for the wrong
//     reason).
//   - "कहानी संसाधित करें" / "Process Story" is not a CREATE_WORDS submit label
//     (sibling of Q-2616 "Generate" and autopsy 876afca9 "Calculate"). Widening
//     that lexicon needs an opposite-class corpus and a Devanagari word-boundary
//     plan; it is queued as Q-2636, not shipped here.
//
// No production classifier or delivery-path change ships in this PR.

import { describe, it, expect } from 'vitest';
import { analyzeAppScope, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';
import { appGeneratesImages, fastLaneSkipsImageApp } from '../src/server/AgentV3/inAppImageGeneration';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { classifyForSimpleLane } from '../src/server/AgentV3/OneShotBuilder';
import { deriveJourneys, noJourneyReason, submitTargetIn } from '../src/server/AgentV3/journeyDerivation';

export const BR1967_PROMPT = `Upgrade my AI Anime Video Generator.

Add episode duration options:

- 5 minutes
- 10 minutes
- 20 minutes
- 30 minutes

The user can paste a complete Hindi story. AI should automatically divide it into scenes and generate a complete anime episode with:

- Consistent anime characters
- Natural Hindi male voices
- Character-specific dialogues
- Animated scenes
- Background music and sound effects
- Hindi subtitles
- Automatic scene joining

Generate the video in smaller clips and combine them into one complete MP4 episode.

Show generation progress and save unfinished projects.

The selected duration must be respected as closely as the available generation service allows. Never show fake progress or claim a video is complete when it is not.

Keep the app free to access and clearly disclose any generation limits or API costs. creat app`;

const PROCESS_STORY_APP = {
  'src/App.tsx': `
export default function App() {
  return (
    <form>
      <label htmlFor="story">कहानी पेस्ट करें *</label>
      <textarea id="story" name="story" />
      <fieldset>
        <legend>एपिसोड की अवधि चुनें</legend>
        <label><input type="radio" name="duration" value="5" /> 5 minutes</label>
        <label><input type="radio" name="duration" value="10" /> 10 minutes</label>
      </fieldset>
      <button type="button" onClick={() => {}}>कहानी संसाधित करें</button>
    </form>
  );
}
`,
};

describe('BR1967: an AI anime video generator stays LARGE', () => {
  it("this report's prompt is LARGE because it asks for many distinct features", () => {
    const scope = analyzeAppScope(BR1967_PROMPT);
    expect(scope.decision).toBe('analyze');
    expect(scope.size).toBe('large');
    expect(scope.famousApp).toBeNull();
    const feat = scope.signals.find((s) => /distinct features requested/.test(s));
    expect(feat).toMatch(/~(\d+) distinct features requested/);
    const n = Number(feat!.match(/~(\d+)/)![1]);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBe(12);
    expect(countEnumeratedFeatures(BR1967_PROMPT)).toBeGreaterThanOrEqual(8);
    expect(scopeVerdict(BR1967_PROMPT, { complex: false }).large).toBe(true);
  });

  it('a video/anime generator is not an in-app image-generation skip', () => {
    expect(appGeneratesImages(BR1967_PROMPT)).toBe(false);
    expect(fastLaneSkipsImageApp(BR1967_PROMPT)).toBe(false);
    expect(fastLaneSkipsGame(analyzeRequirementGaps(BR1967_PROMPT).domain)).toBe(false);
    // The existing image-app skip still fires for a real picture generator —
    // this prompt must not ride that path just because it later plans visuals.
    expect(appGeneratesImages('build me an AI image generator')).toBe(true);
    expect(fastLaneSkipsImageApp('build me an AI image generator')).toBe(true);
    // Surplus/Weak gemini-tier new builds remain simple-lane eligible by tier
    // (the milestone-1 preview uses that lane by design; Q-975).
    expect(classifyForSimpleLane('gemini')).toBe(true);
  });
});

describe('BR1967: Process Story / कहानी संसाधित करें is not a submit word (Q-2636 / Q-2616 sibling)', () => {
  it('does not treat Process Story or Hindi process as CREATE_WORDS', () => {
    expect(submitTargetIn('<button type="button">कहानी संसाधित करें</button>')).toBeNull();
    expect(submitTargetIn('<button onClick={() => processStory()}>कहानी संसाधित करें</button>')).toBeNull();
    expect(submitTargetIn('<button type="button">Process Story</button>')).toBeNull();
    expect(submitTargetIn('<button type="button">Generate</button>')).toBeNull();
    expect(submitTargetIn('<button type="button">Calculate</button>')).toBeNull();
  });

  it('still treats an unambiguous save/add button as the submit', () => {
    expect(submitTargetIn('<button type="button">Save project</button>')).toEqual({
      kind: 'text',
      value: 'Save project',
    });
    expect(submitTargetIn('<button type="button">Add scene</button>')).toEqual({
      kind: 'text',
      value: 'Add scene',
    });
  });

  it('derives no journey from the addressable Process-Story form, and says so as a check limit', () => {
    expect(deriveJourneys({ files: PROCESS_STORY_APP, routes: ['/'], marker: 'nbai-x' })).toEqual([]);
    expect(noJourneyReason(PROCESS_STORY_APP)).toMatch(
      /none of its buttons reads as submitting them \(no submit button and no add \/ save \/ create button\)/,
    );
    expect(noJourneyReason(PROCESS_STORY_APP)).toMatch(/limit of this check, not a defect in the app/);
  });

  it('the same form with a Save button still yields a journey (neighbour)', () => {
    const saved = {
      'src/App.tsx': PROCESS_STORY_APP['src/App.tsx'].replace(
        '>कहानी संसाधित करें</button>',
        '>Save project</button>',
      ),
    };
    const js = deriveJourneys({ files: saved, routes: ['/'], marker: 'nbai-x' });
    expect(js.length).toBeGreaterThan(0);
    expect(js[0].submit).toEqual({ kind: 'text', value: 'Save project' });
  });
});
