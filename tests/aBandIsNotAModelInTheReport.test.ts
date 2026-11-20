/**
 * Q-2748 (autopsy 05eb30ba, all three builds): Weak builds' reports said `requestAnalysis.startTier: "sonnet"`.
 * Weak never runs Sonnet; the value is a complexity BAND whose keys are historical model names. Autopsy 2b0a3ed5
 * added a readable label beside the key — half a fix, because the key was still printed and still misread.
 * The report now carries only the band's meaning; telemetry and lanes keep the key; legacy reports map back.
 */
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { analyzeRequest, startTierFromBandLabel, startBandLabel } from '../src/server/AgentV3/RequestAnalyser';
import { buildOutcomeDims } from '../src/server/AgentV3/modelPerformance';

const MODEL_NAMES = /\b(sonnet|opus|haiku|gemini)\b/i;

describe('a complexity band is never printed as a model name in the report', () => {
  it('the reported shape: a standard-band request on a Weak build', () => {
    const d = new BuildDiagnostics('w', 'b');
    d.setRequestAnalysis({ taskType: 'complex_app', complexityScore: 62, startTier: 'sonnet' });
    const ra = d.report().requestAnalysis!;
    expect(ra.complexityBand).toBe('standard band');
    expect(Object.prototype.hasOwnProperty.call(ra, 'startTier')).toBe(false);
    expect(JSON.stringify(ra)).not.toMatch(MODEL_NAMES);
  });

  it('a real analysis of a real prompt leaves no model name in requestAnalysis', () => {
    for (const prompt of ['make a calculator', 'build a full e-commerce app with payments, admin panel and inventory', 'hi']) {
      const d = new BuildDiagnostics('w', 'b');
      d.setRequestAnalysis(analyzeRequest({ prompt }));
      const ra = d.report().requestAnalysis;
      if (ra) expect(JSON.stringify(ra), prompt).not.toMatch(MODEL_NAMES);
    }
  });

  it('telemetry still groups by the same key, for new reports and for legacy reports', () => {
    for (const key of ['gemini', 'haiku', 'sonnet', 'opus'] as const) expect(startTierFromBandLabel(startBandLabel(key))).toBe(key);
    expect(startTierFromBandLabel('nonsense')).toBeNull();
    const d = new BuildDiagnostics('w', 'b');
    d.setRequestAnalysis({ taskType: 'complex_app', complexityScore: 62, startTier: 'sonnet' });
    expect(buildOutcomeDims(d.report()).startTier).toBe('sonnet');
    const legacy = { issues: [], requestAnalysis: { taskType: 'complex_app', complexityScore: 72, startTier: 'opus' } };
    expect(buildOutcomeDims(legacy as never).startTier).toBe('opus');
  });
});
