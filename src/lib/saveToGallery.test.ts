import { describe, it, expect } from 'vitest';
import { saveToGallery, resolveAndroidAlbum, albumFileName, GALLERY_ALBUM_NAME, type MediaLike } from './saveToGallery';

/**
 * Q-699 — "Save to Photos" never saved on Android.
 *
 * The plugin's Android code rejects `savePhoto` outright without an `albumIdentifier`, so every
 * Android tap threw and fell through to the share sheet. The fix must add that identifier on Android
 * WITHOUT adding it on iOS, where the same field means an opaque Photos id and an unknown value is
 * rejected — i.e. the obvious one-line "just always pass it" fix would have broken the one platform
 * that worked. Both halves are locked below.
 */

/** A fake plugin that records what it was called with. */
function fakeMedia(opts: { albums?: Array<{ identifier: string; name: string }>; createFails?: boolean } = {}) {
  const albums = [...(opts.albums ?? [])];
  const calls: { savePhoto: Array<Record<string, unknown>>; created: string[]; listed: number } = {
    savePhoto: [], created: [], listed: 0,
  };
  const media: MediaLike = {
    async savePhoto(o) { calls.savePhoto.push({ ...o }); return {}; },
    async getAlbums() { calls.listed += 1; return { albums: [...albums] }; },
    async createAlbum(o) {
      calls.created.push(o.name);
      if (opts.createFails) throw new Error('Album already exists');
      albums.push({ identifier: `/storage/emulated/0/Android/media/com.navbharat.ai/${o.name}`, name: o.name });
      return {};
    },
  };
  return { media, calls };
}

describe('iOS behaviour is unchanged — the regression this fix must not cause', () => {
  it('NEVER sends an albumIdentifier on iOS', async () => {
    /**
     * On iOS the field is a PHAssetCollection localIdentifier; Android's path would be rejected with
     * "Unable to find that album". The plugin also documents that omitting it asks for ADD-ONLY
     * permission instead of full library access — so the empty call is the better one, not a gap.
     */
    const { media, calls } = fakeMedia();
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'ios' });
    expect(calls.savePhoto).toHaveLength(1);
    expect(calls.savePhoto[0]).not.toHaveProperty('albumIdentifier');
    expect(calls.savePhoto[0].path).toBe('file:///tmp/a.png');
  });

  it('does not touch the album API at all on iOS', async () => {
    const { media, calls } = fakeMedia();
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'ios' });
    expect(calls.created).toEqual([]);
    expect(calls.listed).toBe(0);
  });

  it('sends ONLY `path` on iOS — byte-for-byte the call that already works', async () => {
    /**
     * `fileName` is documented "Android only" (iOS names the asset with a UUID), so adding it would
     * have changed the one working platform for nothing. This asserts the exact payload, not just
     * the absence of albumIdentifier — an extra key here IS the regression.
     */
    const { media, calls } = fakeMedia();
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'ios', fileName: 'nb.png' });
    expect(calls.savePhoto[0]).toEqual({ path: 'file:///tmp/a.png' });
  });
});

describe('Android now actually saves', () => {
  it('creates the album the first time and saves INTO it', async () => {
    const { media, calls } = fakeMedia();
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'android' });
    expect(calls.created).toEqual([GALLERY_ALBUM_NAME]);
    expect(calls.savePhoto[0].albumIdentifier).toContain(GALLERY_ALBUM_NAME);
  });

  it('reuses an existing album without trying to create it', async () => {
    const { media, calls } = fakeMedia({ albums: [{ identifier: '/media/NavBharatAI', name: GALLERY_ALBUM_NAME }] });
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'android' });
    expect(calls.created).toEqual([]);
    expect(calls.savePhoto[0].albumIdentifier).toBe('/media/NavBharatAI');
  });

  it('tolerates the plugin rejecting "Album already exists" — createAlbum is not idempotent', async () => {
    /**
     * The real plugin rejects rather than resolving when the directory is already there (a race with
     * itself, or a second device session). The answer must still come from getAlbums().
     */
    const { media, calls } = fakeMedia({
      albums: [], createFails: true,
    });
    // The album appears between the failed create and the second listing, as it would on a real race.
    const original = media.getAlbums.bind(media);
    let n = 0;
    media.getAlbums = async () => {
      n += 1;
      return n === 1 ? { albums: [] } : { albums: [{ identifier: '/media/NavBharatAI', name: GALLERY_ALBUM_NAME }] };
    };
    void original;
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'android' });
    expect(calls.savePhoto[0].albumIdentifier).toBe('/media/NavBharatAI');
  });

  it('strips the extension from the file name — copyFile re-appends it', async () => {
    /**
     * The plugin does `fileName + extension`, taking the extension from the SOURCE file, and its
     * typings say "Do not include extension. Android only." Passing our own `nb.png` through would
     * have written `nb.png.png` into the user's gallery — caught by reading the plugin, not the docs.
     */
    const { media, calls } = fakeMedia();
    await saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'android', fileName: 'nb.png' });
    expect(calls.savePhoto[0].fileName).toBe('nb');
  });

  it('albumFileName leaves a name that has no extension alone, and never returns empty', () => {
    expect(albumFileName('navbharatai-sunset.jpeg')).toBe('navbharatai-sunset');
    expect(albumFileName('no-extension-here')).toBe('no-extension-here');
    expect(albumFileName('my.photo.v2.png')).toBe('my.photo.v2');
    expect(albumFileName('.png')).toBe('.png'); // all-extension → keep it rather than send ''
  });
});

describe('a failure THROWS so the share sheet still runs — never a silent fake save', () => {
  it('throws when the album can be neither found nor created', async () => {
    const media: MediaLike = {
      async savePhoto() { return {}; },
      async getAlbums() { return { albums: [] }; },
      async createAlbum() { throw new Error('Cant create album'); },
    };
    await expect(saveToGallery(media, { path: 'file:///tmp/a.png', platform: 'android' })).rejects.toThrow(/album/i);
  });

  it('never calls savePhoto when the album could not be resolved', async () => {
    let saved = 0;
    const media: MediaLike = {
      async savePhoto() { saved += 1; return {}; },
      async getAlbums() { return { albums: [] }; },
      async createAlbum() { throw new Error('nope'); },
    };
    await expect(saveToGallery(media, { path: 'p', platform: 'android' })).rejects.toThrow();
    expect(saved).toBe(0);
  });

  it('refuses an empty path on every platform', async () => {
    const { media } = fakeMedia();
    await expect(saveToGallery(media, { path: '', platform: 'ios' })).rejects.toThrow(/path/i);
    await expect(saveToGallery(media, { path: '', platform: 'android' })).rejects.toThrow(/path/i);
  });

  it('a getAlbums that answers nothing usable does not crash on a missing field', async () => {
    const media = {
      async savePhoto() { return {}; },
      async getAlbums() { return {} as { albums: Array<{ identifier: string; name: string }> }; },
      async createAlbum() { return {}; },
    } as MediaLike;
    await expect(resolveAndroidAlbum(media)).rejects.toThrow(/could not create or find/i);
  });
});

describe('the call site uses it, on both platforms', () => {
  it('AIImageGenerator saves through this module and passes the real platform', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../components/ide/AIImageGenerator.tsx', import.meta.url), 'utf8'));
    expect(src).toContain("from '../../lib/saveToGallery'");
    expect(src).toContain('saveToGallery(Media, {');
    expect(src).toContain('platform: Capacitor.getPlatform()');
    // The old always-rejecting call must be gone.
    expect(src).not.toContain('Media.savePhoto({ path: written.uri })');
  });
});
