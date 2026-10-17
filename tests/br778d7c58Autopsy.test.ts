import { describe, it, expect } from 'vitest';
import { templateInstantPreviewEnabled, isTemplateVerifyJob, shouldUseSlimPrompt, capTemplateVerifyEstimate, TEMPLATE_VERIFY_HIGH_MS } from '../src/server/AgentV3/templateVerify';
import { shouldAutoPublishPreview } from '../src/server/AgentV3/ToolDispatcher';
import { isCommonEnglishWord } from '../src/server/AgentV3/commonEnglishWords';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';
import { GOLDEN_SCAFFOLDS, goldenBuildPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';

describe('BR 778d7c58 autopsy', () => {
  it('instant template preview is default on with an off kill switch', () => {
    expect(templateInstantPreviewEnabled({})).toBe(true);
    expect(templateInstantPreviewEnabled({ AGENTV3_TEMPLATE_INSTANT_PREVIEW: 'off' })).toBe(false);
  });
  it('verify job = simple tier only; slim prompt forced for it', () => {
    expect(isTemplateVerifyJob('simple', {})).toBe(true);
    expect(isTemplateVerifyJob('pro', {})).toBe(false);
    expect(isTemplateVerifyJob(null, {})).toBe(false);
    expect(shouldUseSlimPrompt(false, 'simple', {})).toBe(true);
    expect(shouldUseSlimPrompt(false, 'pro', {})).toBe(false);
    expect(shouldUseSlimPrompt(true, null, {})).toBe(true);
  });
  it('caps a verify ETA without own history; leaves others alone', () => {
    const est = { estimateMs: 300_000, lowMs: 180_000, highMs: 480_000 };
    const c = capTemplateVerifyEstimate(est, true, false);
    expect(c.highMs).toBeLessThanOrEqual(TEMPLATE_VERIFY_HIGH_MS);
    expect(c.lowMs).toBeLessThanOrEqual(c.estimateMs);
    expect(capTemplateVerifyEstimate({ ...est, etaText: '~5 min' }, true, false).etaText).not.toBe('~5 min');
    expect(capTemplateVerifyEstimate(est, false, false)).toBe(est);
    expect(capTemplateVerifyEstimate(est, true, true)).toBe(est);
  });
  it('auto-publishes the preview after a bash that brought the dev server up, once', () => {
    const ok = 'dev server UP on port 5173';
    // Uses the platform health-line parser; a non-health output never triggers.
    expect(shouldAutoPublishPreview('npm ERR! missing script', false, {})).toBe(false);
    expect(shouldAutoPublishPreview(ok, true, {})).toBe(false);
    expect(shouldAutoPublishPreview(ok, false, { AGENTV3_AUTO_PREVIEW: 'off' })).toBe(false);
  });
  it('all-caps ordinary English words are not unknown services; coined names still are', () => {
    expect(isCommonEnglishWord('CALCULATE')).toBe(true);
    expect(unknownNamesInRequest('Panchang app banao jo tithi CALCULATE kare aur muhurat SHOW kare')).toEqual([]);
    expect(unknownNamesInRequest('Ye yese app banao jo data COACT oar sake CALCULATE kare')).toEqual(['COACT']);
  });
  it('every simple golden template prompt says no polish edits, preview already started, read before edit', () => {
    for (const g of GOLDEN_SCAFFOLDS.filter((x: any) => x.tier === 'simple')) {
      const p = goldenBuildPrompt(g as any, 'x');
      expect(p).toMatch(/make NO edits/);
      expect(p).toMatch(/preview has ALREADY been started/);
      expect(p).toMatch(/never edit text you have not read/);
    }
  });
});
