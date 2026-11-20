// 🎞️ OUR CHECKING BROWSER PLAYS NO H.264, AND A SWIPE FEED RACES ITS OWN play()/pause() (failedbr #2169, 2026-11-20).
//
// A reels-style video app was failed by the render check on two console lines that are facts about our headless
// Chromium, not the app; a repair could change neither, the gate went RED, and the build was not ok. The lines are the
// report's own. Reversion: drop BROWSER_MEDIA_LIMIT_CONSOLE_SRC from BROWSER_LIMIT_CONSOLE_SRC and the tests fail.

import { describe, it, expect } from 'vitest';
import { filterActionableErrors } from '../src/server/AgentV3/AutoFix';
import { CONSOLE_NOISE } from '../src/server/AgentV3/clickExplorer';

const ABORT = 'Error playing video: AbortError: The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22';
const CODEC = 'Error playing video: NotSupportedError: Failed to load because no supported source was found.';

describe("#2169: a video feed is not failed for our browser's media limits", () => {
  it('both report lines are dropped by the render filter and the click explorer', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: ABORT }, { t: 2, kind: 'console', text: CODEC }])).toEqual([]);
    expect(CONSOLE_NOISE.test(ABORT)).toBe(true);
    expect(CONSOLE_NOISE.test(CODEC)).toBe(true);
  });
});

describe('the boundaries', () => {
  it('an uncaught crash, and a NotSupportedError about something else, still count', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'error', text: `Uncaught ${CODEC}` }])).toHaveLength(1);
    const other = "NotSupportedError: Failed to execute 'define' on 'CustomElementRegistry': this name has already been used";
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: other }])).toHaveLength(1);
  });
  it('the camera lines from #2263 are still covered', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: 'Error accessing camera: NotFoundError: Requested device not found' }])).toEqual([]);
  });
});
