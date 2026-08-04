import { describe, it, expect } from 'vitest';
import { dataUrlToBlob, dataUrlToBase64, extForMime, imageFilename } from './imageExport';

// A 1x1 transparent PNG as a base64 data URL.
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('imageExport — dataUrlToBlob (regression: Copy pasted the base64 link, not the image)', () => {
  it('turns a base64 PNG data URL into a real image/png Blob with the decoded bytes', () => {
    const blob = dataUrlToBlob(PNG_1x1);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    // The 1x1 PNG decodes to 70 binary bytes — a real image, not the ~90-char base64 string.
    expect(blob.size).toBe(70);
  });

  it('handles a non-base64 (URL-encoded) data URL', () => {
    const blob = dataUrlToBlob('data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E');
    expect(blob.type).toBe('image/svg+xml');
    expect(blob.size).toBe('<svg></svg>'.length);
  });

  it('throws on a plain http URL (so callers fall back to fetch, never mis-decode)', () => {
    expect(() => dataUrlToBlob('https://example.com/a.png')).toThrow();
    expect(() => dataUrlToBlob('')).toThrow();
  });
});

describe('imageExport — dataUrlToBase64 (raw base64 for the native temp-file write)', () => {
  it('returns just the base64 payload of a data URL', () => {
    const b64 = dataUrlToBase64(PNG_1x1);
    expect(b64).toBe(PNG_1x1.split(',')[1]);
    expect(b64.startsWith('data:')).toBe(false);
  });

  it('throws on a non-base64 or http URL (caller falls back to reading the Blob)', () => {
    expect(() => dataUrlToBase64('data:image/svg+xml,%3Csvg%3E')).toThrow();
    expect(() => dataUrlToBase64('https://example.com/a.png')).toThrow();
  });
});

describe('imageExport — filename + extension', () => {
  it('extForMime maps common image types, defaulting to png', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/webp')).toBe('webp');
    expect(extForMime('')).toBe('png');
    expect(extForMime('application/octet-stream')).toBe('png');
  });

  it('imageFilename slugifies the prompt and picks the right extension', () => {
    expect(imageFilename('Modern App Logo!', 'image/png')).toBe('navbharat-modern-app-logo.png');
    expect(imageFilename('  a fintech  banner  ', 'image/jpeg')).toBe('navbharat-a-fintech-banner.jpg');
  });

  it('falls back to a generic name when the prompt has no usable characters', () => {
    expect(imageFilename('', 'image/png')).toBe('navbharat-image.png');
    expect(imageFilename('!!!', 'image/webp')).toBe('navbharat-image.webp');
  });

  it('caps the slug length so a huge prompt never makes an absurd filename', () => {
    const name = imageFilename('a'.repeat(200), 'image/png');
    expect(name.length).toBeLessThanOrEqual('navbharat-'.length + 40 + '.png'.length);
    expect(name.endsWith('.png')).toBe(true);
  });
});
