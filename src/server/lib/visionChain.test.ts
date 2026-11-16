import { describe, it, expect } from 'vitest';
import { visionProviderOrder, runVisionChain } from './visionChain';

describe('visionProviderOrder — universe isolation', () => {
  it('Free universe (allowClaude=false) NEVER includes Claude', () => {
    const order = visionProviderOrder(false);
    expect(order).toEqual(['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI']); // 2026-10-23: no Grok on Free either
    expect(order).not.toContain('GROK');
    expect(order).not.toContain('CLAUDE');
  });

  // Slice C (NAVBHARATAI_ROUTING_PLAN.md §1 row 3): GLM-4.6V-Flash is $0 in/out, so it leads —
  // a free image turn costs NavBharatAI nothing; Vertex stays right behind it for PDFs + fallback.
  // Owner t359u: the always-on suppliers with real vision models lead; GLM then Vertex keep their order.
  it('leads with Qubax → CheaperInference, then GLM (free vision) and Vertex for PDFs/fallback', () => {
    for (const paid of [false, true]) expect(visionProviderOrder(paid).slice(0, 4)).toEqual(['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX']);
  });
  it('never lists Mitrify: it has no image-capable transport', () => {
    expect(visionProviderOrder(true).join()).not.toMatch(/MITRIFY/);
  });

  it('non-Free universes may use Claude, but only as the LAST resort', () => {
    const order = visionProviderOrder(true);
    expect(order).toEqual(['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE']);
    expect(order[order.length - 1]).toBe('CLAUDE');
  });
});

describe('runVisionChain', () => {
  it('returns null for an empty attachment list (no provider is called)', async () => {
    const out = await runVisionChain([], { prompt: 'hi', allowClaude: false });
    expect(out).toBeNull();
  });
});
