import { describe, it, expect } from 'vitest';
import { judgeIcon, isAcceptedImageType, MIN_ICON_PX, MAX_ICON_BYTES } from '../src/lib/appIcon';

// These rules are checked at upload time on purpose. Play rejects a non-square icon and anything
// under 512×512, and a user finding that out from a store rejection days later — after they have
// already built and uploaded — is a genuinely bad experience we can prevent in one second here.

describe('judgeIcon', () => {
  it('accepts a proper Play-ready icon', () => {
    const r = judgeIcon(512, 512, 200_000);
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it('refuses a non-square image, naming the actual size so the user knows what to crop', () => {
    const r = judgeIcon(1024, 768, 200_000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('1024×768');
    expect(r.error).toMatch(/square/i);
  });

  it('accepts a small square icon but warns that Play wants bigger — usable, not silently perfect', () => {
    const r = judgeIcon(192, 192, 20_000);
    expect(r.ok).toBe(true);
    expect(r.warning).toContain('192×192');
    expect(r.warning).toContain(String(MIN_ICON_PX));
  });

  it('refuses a file too large to be an icon', () => {
    const r = judgeIcon(1024, 1024, MAX_ICON_BYTES + 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MB/);
  });

  it('refuses something that did not decode as an image at all', () => {
    expect(judgeIcon(0, 0, 1000).ok).toBe(false);
  });

  it('a large square icon is fine — bigger than the minimum is not a problem', () => {
    expect(judgeIcon(2048, 2048, 900_000)).toMatchObject({ ok: true, width: 2048 });
  });
});

describe('isAcceptedImageType', () => {
  it('accepts the formats both browsers and the Android pipeline handle', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'IMAGE/PNG']) {
      expect(isAcceptedImageType(t), t).toBe(true);
    }
  });

  it('refuses everything else, including an SVG that Android cannot use as a launcher icon', () => {
    for (const t of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/plain', '']) {
      expect(isAcceptedImageType(t), t).toBe(false);
    }
  });
});
