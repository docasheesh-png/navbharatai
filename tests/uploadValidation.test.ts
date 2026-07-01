import { describe, it, expect } from 'vitest';
import { base64DecodedBytes, isSupportedAttachment, validateAttachment, MAX_ATTACHMENT_BYTES } from '../src/server/lib/uploadValidation';

/** P-DATA.6 — pure upload validation: decoded size, type allowlist, accept/reject. */

describe('base64DecodedBytes', () => {
  it('computes decoded byte length (ignoring padding/whitespace)', () => {
    // "hello" → base64 "aGVsbG8=" (5 bytes)
    expect(base64DecodedBytes('aGVsbG8=')).toBe(5);
    expect(base64DecodedBytes('')).toBe(0);
  });
});

describe('isSupportedAttachment', () => {
  it('accepts documents/code/archives/images by extension or MIME', () => {
    expect(isSupportedAttachment('report.docx', '')).toBe(true);
    expect(isSupportedAttachment('data.csv', 'text/csv')).toBe(true);
    expect(isSupportedAttachment('a.ts', '')).toBe(true);
    expect(isSupportedAttachment('archive.zip', 'application/zip')).toBe(true);
    expect(isSupportedAttachment('pic.png', 'image/png')).toBe(true);
  });
  it('rejects unknown/dangerous types', () => {
    expect(isSupportedAttachment('malware.exe', 'application/x-msdownload')).toBe(false);
    expect(isSupportedAttachment('lib.so', 'application/octet-stream')).toBe(false);
    expect(isSupportedAttachment('noext', '')).toBe(false);
  });
});

describe('validateAttachment', () => {
  it('accepts a small supported file', () => {
    expect(validateAttachment({ name: 'a.txt', type: 'text/plain', base64: 'aGVsbG8=' })).toEqual({ ok: true });
  });
  it('rejects an empty, oversized, or unsupported file', () => {
    expect(validateAttachment({ name: 'a.txt', type: 'text/plain', base64: '' }).ok).toBe(false);
    const bigLen = Math.ceil((MAX_ATTACHMENT_BYTES + 1024) / 3) * 4;
    expect(validateAttachment({ name: 'a.txt', type: 'text/plain', base64: 'A'.repeat(bigLen) }).ok).toBe(false);
    const r = validateAttachment({ name: 'x.exe', type: 'application/x-msdownload', base64: 'AAAA' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unsupported');
  });
});
