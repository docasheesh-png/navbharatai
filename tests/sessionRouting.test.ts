import { describe, it, expect } from 'vitest';
import { resolveSessionSurface } from '../src/lib/sessionRouting';

describe('resolveSessionSurface — agent-driven (no savedTab)', () => {
  it('routes navbharatai-pro to the Pro surface', () => {
    const s = resolveSessionSurface('navbharatai-pro');
    expect(s.isProSession).toBe(true);
    expect(s.targetTab).toBe('nbi_pro_chat');
  });

  it('routes any agent containing "pro" to the Pro surface', () => {
    expect(resolveSessionSurface('vishwakarma_pro').isProSession).toBe(true);
  });

  it('routes vishwakarma agents to the ASC surface', () => {
    const s = resolveSessionSurface('vishwakarma_basic');
    expect(s.isAscSession).toBe(true);
    // vishwakarma_basic is asc; targetTab is asc_chat
    expect(s.targetTab).toBe('asc_chat');
  });

  it('routes the sda agent to the Doctor surface', () => {
    const s = resolveSessionSurface('sda');
    expect(s.isSdaSession).toBe(true);
    expect(s.targetTab).toBe('sda_chat');
  });

  it('routes a plain navbharatai agent to Free chat', () => {
    const s = resolveSessionSurface('navbharatai');
    expect(s.isProSession).toBe(false);
    expect(s.isAscSession).toBe(false);
    expect(s.isSdaSession).toBe(false);
    expect(s.targetTab).toBe('nbi_chat');
  });
});

describe('resolveSessionSurface — savedTab precedence', () => {
  it('honours a known savedTab over agent inference', () => {
    const s = resolveSessionSurface('navbharatai', 'nbi_pro_chat');
    expect(s.isProSession).toBe(true);
    expect(s.targetTab).toBe('nbi_pro_chat');
  });

  it('savedTab asc_chat forces the ASC surface', () => {
    const s = resolveSessionSurface('navbharatai', 'asc_chat');
    expect(s.isAscSession).toBe(true);
    expect(s.targetTab).toBe('asc_chat');
  });

  it('savedTab sda_chat forces the Doctor surface', () => {
    const s = resolveSessionSurface('navbharatai', 'sda_chat');
    expect(s.isSdaSession).toBe(true);
    expect(s.targetTab).toBe('sda_chat');
  });

  it('an unknown savedTab falls back to agent inference', () => {
    const s = resolveSessionSurface('navbharatai-pro', 'preview' as any);
    expect(s.targetTab).toBe('nbi_pro_chat');
  });
});
