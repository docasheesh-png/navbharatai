// THE SCORE'S BAND AND THE ROUTING VERDICT SAY THE SAME THING (failedbr #2523 / #2525, Q-3466, 2026-11-26).
//
// Both reports printed `COMPLEXITY_ROUTING: Complexity: COMPLEX (score 15, model)` beside
// `requestAnalysis: { complexityScore: 15, complexityBand: "cheapest band" }` — two readers of one score, each true of
// itself, and no line saying which decided. The class: two report lines describing the same routing from two functions.
// Both now read `scoreBandVersusRouting`, and a source guard keeps the route from building the line inline again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { scoreBandVersusRouting } from '../src/server/AgentV3/RequestAnalyser';
import { complexityRoutingMessage } from '../src/server/AgentV3/complexityRouting';

// The decision failedbr #2523 recorded (weakBuildPreflight's model verdict) and its analyser tier.
const BR2523 = { verdict: 'complex' as const, score: 15, source: 'model' as const, reason: 'one bounded preflight classified the requested implementation scope' };

describe('one answer for the band and the routing', () => {
  it('failedbr #2523: the routing line says the model verdict overrode the cheapest band', () => {
    const line = complexityRoutingMessage(BR2523, 'gemini');
    expect(line).toContain('Complexity: COMPLEX (score 15, model)');
    expect(line).toContain('places this request in the cheapest band');
    expect(line).toContain('the model verdict (complex) overrode it');
  });

  it('failedbr #2523: the requestAnalysis block records the same verdict and the same sentence', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p' });
    d.setRequestAnalysis({ taskType: 'simple_app', complexityScore: 15, startTier: 'gemini' }, BR2523);
    const ra = d.report().requestAnalysis!;
    expect(ra.complexityBand).toBe('cheapest band');
    expect(ra.routedAs).toBe('complex');
    expect(ra.routedBy).toBe('model');
    expect(ra.bandOverriddenByRouting).toBe(scoreBandVersusRouting('gemini', BR2523).note);
    expect(complexityRoutingMessage(BR2523, 'gemini')).toContain(ra.bandOverriddenByRouting!);
  });

  it('a verdict that agrees with its band adds no sentence, and the old line is unchanged', () => {
    const simple = { verdict: 'simple' as const, score: 15, source: 'deterministic' as const, reason: '' };
    expect(complexityRoutingMessage(simple, 'gemini')).toBe("Complexity: simple (score 15, deterministic) — the build opens on the ladder's first rung.");
    expect(scoreBandVersusRouting('sonnet', { verdict: 'complex', source: 'model' }).overridden).toBe(false);
  });

  it('a deterministic verdict never claims to override (a pinned power mode sets the band, not the score)', () => {
    expect(scoreBandVersusRouting('sonnet', { verdict: 'simple', source: 'deterministic' }).overridden).toBe(false);
  });

  it('no routing known ⇒ the block is exactly what it was', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p' });
    d.setRequestAnalysis({ taskType: 'simple_app', complexityScore: 15, startTier: 'gemini' });
    expect(d.report().requestAnalysis).toEqual({ taskType: 'simple_app', complexityScore: 15, complexityBand: 'cheapest band' });
  });

  it('the route builds the line through the shared helper, never inline', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('complexityRoutingMessage(complexityDecision, analysis?.startTier)');
    expect(route).toContain('setRequestAnalysis(analysis, complexityDecision)');
    expect(route).not.toMatch(/`Complexity: (?:COMPLEX|simple) \(score/);
  });
});
