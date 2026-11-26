/**
 * ONE READER OF THE COMPLEXITY SCORE IN THE REPORT (Q-3466, failedbr #2523 and #2525).
 *
 * The same report said "COMPLEXITY_ROUTING: COMPLEX (score 15)" and "requestAnalysis.complexityBand: cheapest band".
 * The band came from the analyser's old thresholds (≤ 20 → cheapest), which route nothing any more; the build opened
 * where the complexity verdict sent it. Both lines now come from routedStartTier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { routedStartTier, startBandLabel, analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('the band follows the routing verdict', () => {
  it('a complex build is in the standard band (heaviest when the analyser said so); a simple one in the cheapest', () => {
    expect(routedStartTier('gemini', true)).toBe('sonnet');
    expect(routedStartTier('opus', true)).toBe('opus');
    expect(routedStartTier('sonnet', false)).toBe('gemini');
    expect(routedStartTier(undefined, false)).toBe('gemini');
  });
  it('failedbr #2523 replayed: a score-15 game routed COMPLEX is not reported as the cheapest band', () => {
    const analysis = analyzeRequest({ prompt: 'Create a simple playable shooting game with first-person view, a gun, enemies, shooting mechanics, crosshair, score counter, health system, and restart button. Add basic mobile touch controls' } as never);
    expect(analysis.startTier).toBe('gemini'); // the old threshold alone said "cheapest"
    const diag = new BuildDiagnostics();
    diag.setRequestAnalysis({ ...analysis, startTier: routedStartTier(analysis.startTier, true) });
    expect((diag as unknown as { requestAnalysis: { complexityBand: string } }).requestAnalysis.complexityBand).toBe(startBandLabel('sonnet'));
  });
  it('the route records both lines through it', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/setRequestAnalysis\(analysis && \{ \.\.\.analysis, startTier: routedStartTier\(analysis\.startTier, buildIsComplex\) \}\)/);
    expect(route).toMatch(/second rung, past the cheap flash opener \(\$\{startBandLabel\(routedStartTier\(analysis\?\.startTier, true\)\)\}\)/);
  });
});
