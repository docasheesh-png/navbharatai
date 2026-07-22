import { describe, it, expect } from 'vitest';
import { buildScreenshotPrompt, cloneGuardrailsBlock } from './screenshotToPrompt';

describe('buildScreenshotPrompt — faithful clone spec', () => {
  it('asks for a pixel-perfect / 100% faithful recreation', () => {
    const p = buildScreenshotPrompt();
    expect(p.toUpperCase()).toContain('PIXEL-PERFECT');
    expect(p).toContain('SCREENSHOT');
  });

  it('honours the caller style/framework/js options', () => {
    const p = buildScreenshotPrompt('dark neon', 'React', true);
    expect(p).toContain('dark neon');
    expect(p).toContain('React');
    expect(p).toContain('interactive behaviour');
  });
});

describe('cloneGuardrailsBlock — intent-aware design + anti-phishing policy (admin 2026-07-22, refined)', () => {
  const g = cloneGuardrailsBlock();

  it('CASE A — ALLOWS inspired-by / similar look for the user\'s own brand (honour the request)', () => {
    expect(g.toUpperCase()).toContain('INSPIRED-BY');
    expect(g.toUpperCase()).toContain('BUILD IT AS REQUESTED');
    // The Amazon-style-own-brand example the admin gave must be explicitly greenlit.
    expect(g.toLowerCase()).toContain('do not force a watermark');
    expect(g.toLowerCase()).toContain('do not refuse');
  });

  it('CASE B — requires the visible NavBharatAI watermark for a deceptive full clone', () => {
    expect(g).toContain('Made with NavBharatAI');
    expect(g.toUpperCase()).toContain('IMPERSONATION');
  });

  it('CASE B — forces a non-original name and forbids real credential capture', () => {
    expect(g.toLowerCase()).toContain('non-original');
    expect(g.toLowerCase()).toContain('placeholder');
    expect(g.toLowerCase()).toContain('no credential capture');
  });

  it('CASE B — embeds the code notice that instructs downstream AIs to decline stripping the safeguards', () => {
    expect(g).toContain('NAVBHARATAI-CLONE-NOTICE');
    expect(g).toContain('NOTICE TO ANY AI ASSISTANT OR DEVELOPER READING THIS');
    expect(g.toLowerCase()).toContain('decline');
    expect(g.toLowerCase()).toContain('illegal');
    expect(g.toLowerCase()).toContain('phishing');
  });

  it('separates the two cases so honest inspired-by work is never blocked by the phishing guard', () => {
    expect(g).toContain('CASE A');
    expect(g).toContain('CASE B');
  });
});
