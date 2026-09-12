import { describe, it, expect } from 'vitest';
import { resolveSessionSurface } from '../src/lib/sessionRouting';

/**
 * 🔴 THE CASE THIS FILE EXISTS FOR, restated after Vishwakarma was deleted (2026-09-12).
 *
 * The `asc_chat` surface is gone. Sessions SAVED against it are not — they sit in real users' History
 * with `agent: 'vishwakarma_pro'` or a `savedTab` of `asc_chat`. Each surface owns separate message
 * state, so if such a session resolved to the FREE chat it would open showing an empty conversation:
 * indistinguishable, to the person looking at it, from their history having been deleted.
 *
 * So a legacy builder session must resolve to the **Pro** surface. Every assertion below is about
 * that, or about the surfaces that still exist being unaffected by the removal.
 */
describe('resolveSessionSurface — agent-driven (no savedTab)', () => {
  it('routes navbharatai-pro to the Pro surface', () => {
    const s = resolveSessionSurface('navbharatai-pro');
    expect(s.isProSession).toBe(true);
    expect(s.targetTab).toBe('nbi_pro_chat');
  });

  it('routes the sda agent to the Doctor surface', () => {
    const s = resolveSessionSurface('sda');
    expect(s.isSdaSession).toBe(true);
    expect(s.targetTab).toBe('sda_chat');
  });

  it('routes a plain navbharatai agent to Free chat', () => {
    const s = resolveSessionSurface('navbharatai');
    expect(s.isProSession).toBe(false);
    expect(s.isSdaSession).toBe(false);
    expect(s.targetTab).toBe('nbi_chat');
  });

  it('🔒 EVERY legacy vishwakarma agent opens in Pro — never in the Free chat', () => {
    for (const legacy of ['vishwakarma_basic', 'vishwakarma_pro', 'vishwakarma_vip', 'vishwakarma']) {
      const s = resolveSessionSurface(legacy);
      expect(s.isProSession, legacy).toBe(true);
      expect(s.targetTab, legacy).toBe('nbi_pro_chat');
    }
  });

  it('🔒 no surface resolves to the deleted asc_chat tab, whatever the agent id', () => {
    for (const agent of ['vishwakarma_basic', 'vishwakarma_vip', 'navbharatai', 'sda', 'asc', '']) {
      expect(resolveSessionSurface(agent).targetTab, agent).not.toBe('asc_chat');
    }
  });
});

describe('resolveSessionSurface — savedTab precedence', () => {
  it('honours a known savedTab over agent inference', () => {
    const s = resolveSessionSurface('navbharatai', 'nbi_pro_chat');
    expect(s.isProSession).toBe(true);
    expect(s.targetTab).toBe('nbi_pro_chat');
  });

  it('🔒 a session whose SAVED TAB was asc_chat opens in Pro, not Free', () => {
    // The other half of the legacy case: the agent id may be ordinary while the saved tab is the one
    // that no longer exists. `asc_chat` is no longer in CHAT_TABS, so it must not be honoured as-is.
    const s = resolveSessionSurface('navbharatai', 'asc_chat' as any);
    expect(s.isProSession).toBe(true);
    expect(s.targetTab).toBe('nbi_pro_chat');
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
