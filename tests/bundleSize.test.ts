import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { summarizeBundle, bundleSummaryLine, formatBytes } from '../src/server/AgentV3/BundleSize';

/** P-PIPE.78 — pure bundle-size measurement over a built dist map. */

describe('formatBytes', () => {
  it('renders B / KB / MB and guards non-positive', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});

describe('summarizeBundle', () => {
  it('is empty for an empty map', () => {
    const s = summarizeBundle(new Map());
    expect(s.fileCount).toBe(0);
    expect(s.totalRawBytes).toBe(0);
    expect(s.largestJs).toBeNull();
    expect(bundleSummaryLine(s)).toBe('');
  });

  it('sums raw + gzip and picks the largest JS chunk by raw size', () => {
    const big = Buffer.from('x'.repeat(5000));
    const small = Buffer.from('y'.repeat(500));
    const css = Buffer.from('.a{color:red}'.repeat(50));
    const files = new Map<string, Buffer>([
      ['assets/index-abc.js', big],
      ['assets/vendor-xyz.js', small],
      ['assets/style-1.css', css],
    ]);
    const s = summarizeBundle(files);
    expect(s.fileCount).toBe(3);
    expect(s.totalRawBytes).toBe(big.length + small.length + css.length);
    // gzip total equals the sum of per-file gzip lengths.
    const gzExpected = gzipSync(big).length + gzipSync(small).length + gzipSync(css).length;
    expect(s.totalGzipBytes).toBe(gzExpected);
    // Largest JS is the big one (css is ignored for the "largest JS" pick).
    expect(s.largestJs?.name).toBe('assets/index-abc.js');
    expect(s.largestJs?.rawBytes).toBe(big.length);
  });

  it('reports a bundle with no JS (css-only) and omits the largest-JS clause', () => {
    const files = new Map<string, Buffer>([['assets/style.css', Buffer.from('.a{}')]]);
    const s = summarizeBundle(files);
    expect(s.largestJs).toBeNull();
    const line = bundleSummaryLine(s);
    expect(line).toContain('Bundle: 1 files');
    expect(line).not.toContain('largest JS');
  });

  it('produces an honest one-line deploy summary with the largest chunk', () => {
    const files = new Map<string, Buffer>([['assets/app.js', Buffer.from('z'.repeat(2048))]]);
    const line = bundleSummaryLine(summarizeBundle(files));
    expect(line).toContain('Bundle: 1 files');
    expect(line).toContain('largest JS assets/app.js');
    expect(line).toContain('gz)');
  });
});
