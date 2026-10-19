import { describe, it, expect } from 'vitest';
import { handBackNotice } from '../src/server/AgentV3/handBackNotice';
import { stylePassCapMs, stylePassCapHit, STYLE_PASS_CAP_MS_DEFAULT } from '../src/server/AgentV3/stylePassCap';

// r6–r10 autopsy: "styling the screens before the preview opens" was shown while the preview was already live,
// and the style pass had no bound of its own.
describe('the style hand-back notice tells the truth about the preview', () => {
  it('a live preview is not described as "before the preview opens"', () => {
    const t = handBackNotice('style', 'Your app is ready!', { previewLive: true, env: {} })!;
    expect(t).not.toMatch(/before the preview opens/);
    expect(t).toMatch(/already open/);
  });
  it('no preview yet keeps the original sentence', () => {
    expect(handBackNotice('style', 'Your app is ready!', { previewLive: false, env: {} })).toMatch(/before the preview opens/);
  });
  it('AGENTV3_STYLE_NOTICE_LIVE=off restores the old sentence', () => {
    expect(handBackNotice('style', 'ready', { previewLive: true, env: { AGENTV3_STYLE_NOTICE_LIVE: 'off' } })).toMatch(/before the preview opens/);
  });
  it('nothing shown → nothing to correct', () => {
    expect(handBackNotice('style', '', { previewLive: true, env: {} })).toBeNull();
  });
});

describe('our style pass has a time cap', () => {
  it('defaults to 3 minutes and is env-configurable', () => {
    expect(stylePassCapMs({})).toBe(STYLE_PASS_CAP_MS_DEFAULT);
    expect(stylePassCapMs({ AGENTV3_STYLE_PASS_CAP_MS: '60000' })).toBe(60000);
    expect(stylePassCapMs({ AGENTV3_STYLE_PASS_CAP_MS: 'off' })).toBeNull();
    expect(stylePassCapMs({ AGENTV3_STYLE_PASS_CAP_MS: '0' })).toBeNull();
    expect(stylePassCapMs({ AGENTV3_STYLE_PASS_CAP_MS: 'junk' })).toBe(STYLE_PASS_CAP_MS_DEFAULT);
  });
  it('fires only after a pass started and ran past the cap', () => {
    expect(stylePassCapHit(null, 10_000_000, {})).toBe(false);
    expect(stylePassCapHit(0, 179_999, {})).toBe(false);
    expect(stylePassCapHit(0, 180_000, {})).toBe(true);
    expect(stylePassCapHit(0, 10_000_000, { AGENTV3_STYLE_PASS_CAP_MS: 'off' })).toBe(false);
  });
});
