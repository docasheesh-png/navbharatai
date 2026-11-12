import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../../lib/downloadFile', () => ({ deliverFile: vi.fn(), deliveryMessage: vi.fn() }));
import { VoiceAI } from './VoiceAI';

describe('Voice AI initial UI', () => {
  it('discloses transmission and privacy, disables generation before config loads, and supplies a mode exit', () => {
    const markup = renderToStaticMarkup(createElement(VoiceAI, { onOpenModePicker: () => {} }));
    expect(markup).toContain('Loading voices and pricing');
    expect(markup).toContain('Sign in to generate speech using your wallet.');
    expect(markup).toContain('Generating sends this text to our speech service provider.');
    expect(markup).toContain('Drafts and audio are not saved in history.');
    expect(markup).toContain('no voice cloning');
    expect(markup).toContain('aria-label="Choose AI mode"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Generate speech/);
    expect(markup).not.toContain('Free');
    expect(markup).not.toContain('Sarvam');
  });
  it('reloads only configuration, preserves the draft and never automatically submits speech', () => {
    const markup = renderToStaticMarkup(createElement(VoiceAI));
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Reload pricing<\/button>/);
    const source = readFileSync(new URL('./VoiceAI.tsx', import.meta.url), 'utf8');
    const configEffect = source.slice(source.indexOf('    const controller = new AbortController();'), source.indexOf('  }, [reload]);'));
    expect(configEffect).toContain("fetch('/api/v1/voice-ai/config'");
    expect(configEffect).not.toContain('setText(');
    expect(configEffect).not.toContain('setAudio(');
    expect(configEffect).not.toContain('generate(');
    expect(configEffect).not.toContain('/generate');
    expect(source).toContain('disabled={busy || !config}');
    expect(source).toContain('Your draft is kept. Review the updated cost before generating.');
    expect(source).toContain('Reload pricing and review the new cost before submitting again.');
  });

  it('uses unique text field and description IDs across open voice windows', () => {
    const markup = renderToStaticMarkup(createElement('div', {}, createElement(VoiceAI), createElement(VoiceAI)));
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
