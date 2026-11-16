import { describe, it, expect } from 'vitest';
import { visionProviderOrder, runVisionChain } from './visionChain';

describe('visionProviderOrder — universe isolation', () => {
  it('Free universe (allowClaude=false) NEVER includes Claude', () => {
    const order = visionProviderOrder(false);
    expect(order).toEqual(['GLM', 'VERTEX', 'GEMINI']); // 2026-10-23: no Grok on Free either
    expect(order).not.toContain('GROK');
    expect(order).not.toContain('CLAUDE');
  });

  // Slice C (NAVBHARATAI_ROUTING_PLAN.md §1 row 3): GLM-4.6V-Flash is $0 in/out, so it leads —
  // a free image turn costs NavBharatAI nothing; Vertex stays right behind it for PDFs + fallback.
  it('leads with GLM (free vision), then Vertex for PDFs/fallback — main order when not opted in', () => {
    for (const paid of [false, true]) expect(visionProviderOrder(paid).slice(0, 2)).toEqual(['GLM', 'VERTEX']);
  });
  // Owner t359u: chat photo analysis OPTS IN; the always-on suppliers with real vision models lead.
  it('opt-in leads with Qubax → CheaperInference, then the unchanged chain', () => {
    expect(visionProviderOrder(false, 'free', true)).toEqual(['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI']);
    expect(visionProviderOrder(true, 'paid', true)).toEqual(['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE']);
  });
  it('never lists Mitrify: it has no image-capable transport', () => {
    expect(visionProviderOrder(true, 'paid', true).join()).not.toMatch(/MITRIFY/);
  });

  it('non-Free universes may use Claude, but only as the LAST resort', () => {
    const order = visionProviderOrder(true);
    expect(order).toEqual(['GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE']);
    expect(order[order.length - 1]).toBe('CLAUDE');
  });
});

describe('runVisionChain', () => {
  it('returns null for an empty attachment list (no provider is called)', async () => {
    const out = await runVisionChain([], { prompt: 'hi', allowClaude: false });
    expect(out).toBeNull();
  });
});
