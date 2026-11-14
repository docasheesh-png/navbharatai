// EMBEDDED MEDIA: moved out of code on the way in, hidden from the model on the way to it (single-file game autopsy, 2026-11-14).
// The fixture has the SHAPE of the admin's 5.4 MB game (bare-base64 intro video, Audio data URIs, image data URIs, a CSS font,
// CDN scripts, localStorage saves) at about 450 KB. The real file is not in the repo.
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import {
  extractEmbeddedMedia, elideEmbeddedMedia, findEmbeddedMedia, holdsEmbeddedMedia, mediaFingerprints, sniffMedia, base64Prefix,
  base64ByteLength, payloadFingerprint, MEDIA_LOADER_NAME, MODEL_ELIDE_MIN_BYTES,
} from '../src/lib/embeddedMedia';
import { pastedStorageKeys } from '../src/server/AgentV3/pastedAppFormat';
import { buildGameFixture, fixtureMedia, longBase64Runs, b64, STORAGE_KEYS, TINY_GIF, CDN_THREE, FONTS_LINK } from './helpers/singleFileGameFixture';

const decode = (dataUri: string): Buffer => Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');

describe('the fixture really has the shape of the game', () => {
  const { html } = buildGameFixture();
  it('is a big one-file page that is mostly base64', () => {
    expect(html.length).toBeGreaterThan(400_000);
    const b64Chars = longBase64Runs(html, 200).reduce((n, r) => n + r.length, 0);
    expect(b64Chars / html.length).toBeGreaterThan(0.9);
    expect(html).toContain('atob(window.__introB64)');
    expect(html).toContain("new Audio('data:audio/mpeg;base64,");
    expect(html).toContain("'data:image/jpeg;base64,");
  });
});

describe('extractEmbeddedMedia — code stays code, media becomes files', () => {
  const media = fixtureMedia();
  const { html } = buildGameFixture(media);
  const r = extractEmbeddedMedia(html);

  it('leaves no long base64 run in the page', () => {
    expect(longBase64Runs(r.html, 200)).toEqual([]);
    expect(r.html.length).toBeLessThan(html.length * 0.02);
  });

  it('writes one file per distinct payload, and every file decodes to the original bytes', () => {
    const byExt = (ext: string): Buffer[] => Object.entries(r.assets).filter(([p]) => p.endsWith('.' + ext)).map(([, v]) => decode(v));
    expect(Object.keys(r.assets)).toHaveLength(6 - 0); // video, 2 audio, jpeg (shared by two uses), png, font
    expect(byExt('mp4')[0].equals(Buffer.from(media.video))).toBe(true);
    expect(byExt('png')[0].equals(Buffer.from(media.png))).toBe(true);
    expect(byExt('woff2')[0].equals(Buffer.from(media.font))).toBe(true);
    const mp3 = byExt('mp3');
    expect(mp3).toHaveLength(2);
    expect(mp3.some((b) => b.equals(Buffer.from(media.audioA)))).toBe(true);
    expect(mp3.some((b) => b.equals(Buffer.from(media.audioB)))).toBe(true);
    const jpg = byExt('jpg');
    expect(jpg).toHaveLength(1);
    expect(jpg[0].equals(Buffer.from(media.jpeg))).toBe(true);
    const jpegEntry = r.report.extracted.find((e) => e.path.endsWith('.jpg'))!;
    expect(jpegEntry.occurrences).toBe(2);
  });

  it('every path the page now uses is a file that was written, under assets/media/', () => {
    const refs = [...r.html.matchAll(/assets\/media\/[A-Za-z0-9._-]+/g)].map((m) => m[0]);
    expect(refs.length).toBeGreaterThanOrEqual(7);
    for (const ref of refs) expect(Object.keys(r.assets), ref).toContain(ref);
  });

  it('changes nothing but the payloads: the code around them is byte-identical', () => {
    const skeleton = (s: string): string => s.replace(/assets\/media\/[A-Za-z0-9._-]+/g, 'P').replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, 'P');
    // The bare literal became __nbAsset64('P'); undo that one shape, and drop the added loader <script>.
    const restored = r.html.replace(/<script>\/\* NavBharatAI[\s\S]*?<\/script>\n/, '').replace(/__nbAsset64\((['"])(P|assets\/media\/[^'"]+)\1\)/g, (_m, q: string) => q + 'P' + q);
    const original = html.replace(/(["'])[A-Za-z0-9+/]{4096,}={0,2}\1/g, (_m, q: string) => q + 'P' + q);
    expect(skeleton(restored)).toBe(skeleton(original));
  });

  it('keeps the localStorage keys and the CDN tags exactly', () => {
    expect(pastedStorageKeys(r.html)).toEqual(pastedStorageKeys(html));
    for (const k of STORAGE_KEYS) expect(r.html).toContain(k);
    expect(r.html).toContain(CDN_THREE);
    expect(r.html).toContain(FONTS_LINK);
  });

  it('keeps a tiny data URI inline (it is code, not media)', () => {
    expect(r.html).toContain(TINY_GIF);
    expect(r.report.keptInline).toBe(1);
  });

  it('adds the loader once, before the first script that uses it', () => {
    expect(r.report.loaderAdded).toBe(true);
    expect(r.html.split('function ' + MEDIA_LOADER_NAME).length - 1).toBe(1);
    expect(r.html.indexOf('function ' + MEDIA_LOADER_NAME)).toBeLessThan(r.html.search(/__nbAsset64\(["']/));
  });

  it('is idempotent: a second pass finds nothing to do', () => {
    const again = extractEmbeddedMedia(r.html);
    expect(again.html).toBe(r.html);
    expect(Object.keys(again.assets)).toEqual([]);
  });

  it('puts assets beside the page when it is not at the root, and the page refers to them relatively', () => {
    const nested = extractEmbeddedMedia(html, { baseDir: 'games/mart' });
    expect(Object.keys(nested.assets).every((p) => p.startsWith('games/mart/assets/media/'))).toBe(true);
    expect(nested.html).toContain("'assets/media/");
    expect(nested.html).not.toContain('games/mart/');
  });
});

describe('the bare-base64 loader hands the page exactly the string it used to hold', () => {
  const { html, media } = buildGameFixture();
  const r = extractEmbeddedMedia(html);

  it('atob(window.__introB64) yields the original video bytes, running the REAL page script against a stub XHR', () => {
    // Serve the extracted files the way a browser would: a synchronous GET returning the file's bytes as a binary string.
    class FakeXHR {
      status = 0; responseText = ''; private url = '';
      open(_m: string, url: string): void { this.url = url; }
      overrideMimeType(): void { /* binary string below */ }
      send(): void {
        const data = r.assets[this.url];
        if (!data) { this.status = 404; return; }
        this.status = 200; this.responseText = decode(data).toString('latin1');
      }
    }
    const scripts = [...r.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const win: Record<string, unknown> = {};
    const sandbox: Record<string, unknown> = {
      window: win, XMLHttpRequest: FakeXHR, btoa: (s: string) => Buffer.from(s, 'latin1').toString('base64'), atob: (s: string) => Buffer.from(s, 'base64').toString('latin1'),
      URL: { createObjectURL: () => 'blob:x' }, Blob: class { constructor(public parts: unknown[]) {} }, Uint8Array, String, Math,
      Audio: class { constructor(public src: string) {} }, Image: class { src = ''; }, localStorage: { setItem: () => undefined, getItem: () => null },
      JSON, Error,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const s of scripts) vm.runInContext(s, sandbox);
    const bytes = win.__introBytes as Uint8Array;
    expect(Buffer.from(bytes).equals(Buffer.from(media.video))).toBe(true);
  });

  it('the loader throws a clear error when the file is missing, instead of returning an empty video', () => {
    const loader = /<script>\/\* NavBharatAI[\s\S]*?<\/script>/.exec(r.html)![0].replace(/<\/?script>/g, '');
    class Missing { status = 0; responseText = ''; open(): void {} overrideMimeType(): void {} send(): void { this.status = 404; } }
    const sandbox: Record<string, unknown> = { XMLHttpRequest: Missing, btoa: () => '', String, Math, Error };
    vm.createContext(sandbox);
    vm.runInContext(loader, sandbox);
    expect(() => vm.runInContext(MEDIA_LOADER_NAME + "('assets/media/nope.mp4')", sandbox)).toThrow(/Could not load/);
  });
});

describe('budgets and the cases that must be left alone', () => {
  const { html } = buildGameFixture();

  it('a payload over the per-asset cap stays where it is and is reported', () => {
    const r = extractEmbeddedMedia(html, { maxAssetBytes: 100_000 });
    expect(r.report.skipped.some((s) => s.reason === 'too-large' && s.mime === 'video/mp4')).toBe(true);
    expect(r.html).toContain('window.__introB64="');
    expect(Object.keys(r.assets).some((p) => p.endsWith('.mp4'))).toBe(false);
  });

  it('the page total budget is honoured', () => {
    const r = extractEmbeddedMedia(html, { maxTotalBytes: 120_000 });
    const total = r.report.extracted.reduce((n, e) => n + e.bytes, 0);
    expect(total).toBeLessThanOrEqual(120_000);
    expect(r.report.skipped.some((s) => s.reason === 'over-budget')).toBe(true);
  });

  it('a long base64 string that is not media is not touched (a token, a hash, a key)', () => {
    const notMedia = 'x'.repeat(5000).replace(/x/g, 'Q');
    const page = `<script>var token="${notMedia}";</script>`;
    const r = extractEmbeddedMedia(page);
    expect(r.html).toBe(page);
    expect(r.report.extracted).toEqual([]);
  });

  it('a non-media data URI (JSON) is left alone', () => {
    const page = '<a href="data:application/json;base64,' + b64(new Uint8Array(4000).fill(65)) + '">x</a>';
    expect(extractEmbeddedMedia(page).html).toBe(page);
  });

  it('text with no base64 is returned as the very same string, and garbage never throws', () => {
    const plain = '<html><body>hello</body></html>';
    expect(extractEmbeddedMedia(plain).html).toBe(plain);
    expect(() => extractEmbeddedMedia(undefined as unknown as string)).not.toThrow();
    expect(extractEmbeddedMedia('').html).toBe('');
  });

  it('format sniffing reads the real signatures', () => {
    const m = fixtureMedia();
    expect(sniffMedia(base64Prefix(b64(m.video), 16))?.mime).toBe('video/mp4');
    expect(sniffMedia(base64Prefix(b64(m.audioA), 16))?.mime).toBe('audio/mpeg');
    expect(sniffMedia(base64Prefix(b64(m.jpeg), 16))?.mime).toBe('image/jpeg');
    expect(sniffMedia(base64Prefix(b64(m.png), 16))?.mime).toBe('image/png');
    expect(sniffMedia(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it('size and fingerprint helpers agree with Buffer', () => {
    for (const n of [0, 1, 2, 3, 100, 1001]) {
      const bytes = new Uint8Array(n).map((_, i) => i * 7);
      expect(base64ByteLength(b64(bytes))).toBe(n);
    }
    expect(payloadFingerprint('abc')).toBe(payloadFingerprint('abc'));
    expect(payloadFingerprint('abc')).not.toBe(payloadFingerprint('abd'));
  });
});

describe('elideEmbeddedMedia — what the model is shown', () => {
  const { html } = buildGameFixture();
  const e = elideEmbeddedMedia(html);

  it('leaves no long base64 run, and is far smaller than the page', () => {
    expect(longBase64Runs(e.text, 200)).toEqual([]);
    expect(e.text.length).toBeLessThan(html.length * 0.02);
    expect(e.elided).toBe(7);
  });

  it('keeps the code, and the placeholders say what is there so the model can leave it alone', () => {
    expect(e.text).toContain('atob(window.__introB64)');
    expect(e.text).toContain("new Audio('data:audio/mpeg;base64,<<media omitted:");
    expect(e.text).toContain('<<base64 media omitted:');
    expect(e.text).toContain(TINY_GIF);
  });

  it('is never longer than its input, and an ordinary file is returned as the same string', () => {
    expect(e.text.length).toBeLessThanOrEqual(html.length);
    const code = 'function add(a, b) { return a + b; }\n'.repeat(60);
    expect(elideEmbeddedMedia(code).text).toBe(code);
    expect(elideEmbeddedMedia('x'.repeat(MODEL_ELIDE_MIN_BYTES - 1)).elided).toBe(0);
  });

  it('holdsEmbeddedMedia / mediaFingerprints tell a page with media from one without', () => {
    expect(holdsEmbeddedMedia(html)).toBe(true);
    expect(holdsEmbeddedMedia(e.text)).toBe(false);
    expect(holdsEmbeddedMedia(extractEmbeddedMedia(html).html)).toBe(false);
    expect(mediaFingerprints(html).size).toBe(6);
    expect(findEmbeddedMedia(html).length).toBe(7);
  });
});
