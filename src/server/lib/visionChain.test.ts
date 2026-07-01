import { describe, it, expect } from 'vitest';
import { visionProviderOrder, runVisionChain } from './visionChain';

describe('visionProviderOrder — universe isolation', () => {
  it('Free universe (allowClaude=false) NEVER includes Claude', () => {
    const order = visionProviderOrder(false);
    expect(order).toEqual(['VERTEX', 'GEMINI', 'GROK']);
    expect(order).not.toContain('CLAUDE');
  });

  it('leads with Vertex so the Free universe reads images AND PDFs via its primary Google auth', () => {
    expect(visionProviderOrder(false)[0]).toBe('VERTEX');
    expect(visionProviderOrder(true)[0]).toBe('VERTEX');
  });

  it('non-Free universes may use Claude, but only as the LAST resort', () => {
    const order = visionProviderOrder(true);
    expect(order).toEqual(['VERTEX', 'GEMINI', 'GROK', 'CLAUDE']);
    expect(order[order.length - 1]).toBe('CLAUDE');
  });
});

describe('runVisionChain', () => {
  it('returns null for an empty attachment list (no provider is called)', async () => {
    const out = await runVisionChain([], { prompt: 'hi', allowClaude: false });
    expect(out).toBeNull();
  });
});
