import { describe, it, expect } from 'vitest';
import { footerSection, v3MobileFooterActive } from './v3FooterApi';

describe('footerSection (v3.0 mobile footer — active-item highlight from real surface state)', () => {
  it('chat when the workspace is collapsed (chat is full-width), whatever tab is remembered', () => {
    expect(footerSection(false, 'preview')).toBe('chat');
    expect(footerSection(false, 'files')).toBe('chat');
  });
  it('maps each open workspace surface to its section', () => {
    expect(footerSection(true, 'preview')).toBe('preview');
    expect(footerSection(true, 'files')).toBe('files');
    expect(footerSection(true, 'diff')).toBe('diff');
    expect(footerSection(true, 'terminal')).toBe('terminal');
    expect(footerSection(true, 'history')).toBe('history');
  });
  it('falls back to chat for an unknown tab value (never a dead highlight)', () => {
    expect(footerSection(true, 'bogus')).toBe('chat');
  });
});

describe('v3MobileFooterActive (must mirror the App.tsx bottom-nav visibility gate exactly)', () => {
  it('active on mobile/tablet outside focus mode', () => {
    expect(v3MobileFooterActive('mobile', false)).toBe(true);
    expect(v3MobileFooterActive('tablet', false)).toBe(true);
  });
  it('inactive on desktop and in focus mode — the header keeps its controls there', () => {
    expect(v3MobileFooterActive('desktop', false)).toBe(false);
    expect(v3MobileFooterActive('mobile', true)).toBe(false);
    expect(v3MobileFooterActive('desktop', true)).toBe(false);
  });
});
