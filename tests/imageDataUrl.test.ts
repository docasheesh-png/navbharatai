import { describe, it, expect } from 'vitest';
import { parseDataUrl, base64Bytes, initImageTooLarge } from '../src/server/lib/imageDataUrl';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('attachment validation', () => {
  it('reads a data URL and rejects anything else', () => {
    expect(parseDataUrl(DATA_URL)).toEqual({ mimeType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(parseDataUrl('https://h/a.png')).toBeNull();
    expect(parseDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
  });

  it('sizes base64 without decoding it', () => {
    expect(base64Bytes('QUJD')).toBe(3);      // "ABC"
    expect(base64Bytes('QUJDRA==')).toBe(4);  // "ABCD"
    expect(base64Bytes('')).toBe(0);
  });

  it('bounds the attachment at 8 MB', () => {
    const under = `data:image/png;base64,${'A'.repeat(1000)}`;
    const over = `data:image/png;base64,${'A'.repeat(12_000_000)}`;
    expect(initImageTooLarge(under)).toBe(false);
    expect(initImageTooLarge(over)).toBe(true);
  });
});
