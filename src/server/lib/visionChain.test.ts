import { describe, it, expect } from 'vitest';
import { visionProviderOrder, runVisionChain } from './visionChain';

describe('visionProviderOrder — universe isolation', () => {
  it('Free universe (allowClaude=false) NEVER includes Claude', () => {
    const order = visionProviderOrder(false);
    expect(order).toEqual(['GLM', 'VERTEX', 'GEMINI', 'GROK']);
    expect(order).not.toContain('CLAUDE');
  });

  // Slice C (NAVBHARATAI_ROUTING_PLAN.md §1 row 3): GLM-4.6V-Flash is $0 in/out, so it leads —
  // a free image turn costs NavBharatAI nothing; Vertex stays right behind it for PDFs + fallback.
  it('leads with GLM (free vision) and keeps Vertex second for PDFs/fallback', () => {
    expect(visionProviderOrder(false)[0]).toBe('GLM');
    expect(visionProviderOrder(true)[0]).toBe('GLM');
    expect(visionProviderOrder(false)[1]).toBe('VERTEX');
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
