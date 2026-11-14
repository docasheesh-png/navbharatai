// A one-file HTML game with the SHAPE of the real one (admin's 5.4 MB "village super mart" page): an intro video held as a
// BARE base64 string that the page decodes with atob(), engine sounds as `new Audio('data:audio/mpeg;base64,…')`, textures as
// `'data:image/jpeg;base64,…'` strings, a font inside CSS `url(data:…)`, three.js and a font stylesheet from a CDN, and saves
// in localStorage. Generated, deterministic and small by default (about 450 KB) — NOT the real file; pass `scale` to grow it.

export interface FixtureMedia {
  video: Uint8Array;
  audioA: Uint8Array;
  audioB: Uint8Array;
  jpeg: Uint8Array;
  png: Uint8Array;
  font: Uint8Array;
}

/** Deterministic pseudo-random bytes behind a real file signature, so format sniffing has something true to read. */
export function bytesWith(head: number[], size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < size; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 0xff; }
  head.forEach((b, i) => { if (i < size) out[i] = b; });
  return out;
}

const ascii = (s: string): number[] => Array.from(s).map((c) => c.charCodeAt(0));
export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

export function fixtureMedia(scale = 1): FixtureMedia {
  return {
    video: bytesWith([0, 0, 0, 0x18, ...ascii('ftypmp42'), 0, 0, 0, 0, ...ascii('mp42isom')], 200_000 * scale, 1),
    audioA: bytesWith([...ascii('ID3'), 3, 0, 0, 0, 0, 0, 0x21], 80_000 * scale, 2),
    audioB: bytesWith([...ascii('ID3'), 3, 0, 0, 0, 0, 0, 0x21], 40_000 * scale, 3),
    jpeg: bytesWith([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii('JFIF')], 60_000 * scale, 4),
    png: bytesWith([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a], 30_000 * scale, 5),
    font: bytesWith([...ascii('wOF2')], 20_000 * scale, 6),
  };
}

export const STORAGE_KEYS = ['riseup_mart_sim_v2', 'swstats3', 'ru_pause_cfg_v1'] as const;
export const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
export const CDN_THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
export const FONTS_LINK = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap';

/** The page. The consumer of the intro video is the real game's own code (atob → bytes → Blob). */
export function buildGameFixture(media: FixtureMedia = fixtureMedia()): { html: string; media: FixtureMedia } {
  const html = [
    '<!doctype html><html><head><meta charset=utf8><title>Fixture Mart</title>',
    `<link href="${FONTS_LINK}" rel="stylesheet">`,
    '<style>',
    `@font-face{font-family:Mart;src:url(data:font/woff2;base64,${b64(media.font)}) format('woff2')}`,
    '#intro{position:fixed;inset:0;background:#000}',
    '</style></head><body>',
    '<div id="intro"><video id="introV" playsinline></video><div id="introTap">Tap to start</div></div>',
    `<script src="${CDN_THREE}"></script>`,
    `<script>window.__introB64="${b64(media.video)}"</script>`,
    '<script>',
    '(function () {',
    '  var b = atob(window.__introB64), n = b.length, u = new Uint8Array(n);',
    '  for (var i = 0; i < n; i++) u[i] = b.charCodeAt(i);',
    '  window.__introB64 = null;',
    '  window.__introBytes = u;',
    "  window.__introURL = URL.createObjectURL(new Blob([u], { type: 'video/mp4' }));",
    '})();',
    `var bikeEngineClip = new Audio('data:audio/mpeg;base64,${b64(media.audioA)}');`,
    `var carEngineClip = new Audio('data:audio/mpeg;base64,${b64(media.audioB)}');`,
    `var HERO_BODY = 'data:image/jpeg;base64,${b64(media.jpeg)}';`,
    `var HERO_ALT = 'data:image/jpeg;base64,${b64(media.jpeg)}';`,
    `var img = new Image(); img.src = 'data:image/png;base64,${b64(media.png)}';`,
    `var tiny = '${TINY_GIF}';`,
    "function saveGame(state) { localStorage.setItem('riseup_mart_sim_v2', JSON.stringify(state)); }",
    "function loadGame() { return JSON.parse(localStorage.getItem('riseup_mart_sim_v2') || '{}'); }",
    "localStorage.setItem('swstats3', '{}'); localStorage.getItem('ru_pause_cfg_v1');",
    'var shelf = { items: [{ name: "Atta", price: 230 }] };',
    'function addShelfItem(name, price) { shelf.items.push({ name: name, price: price }); }',
    '</script></body></html>',
    '',
  ].join('\n');
  return { html, media };
}

/** Every base64 run of at least `min` characters in a text — what must not be left in code, nor shown to a model. */
export function longBase64Runs(text: string, min = 200): string[] {
  return text.match(new RegExp('[A-Za-z0-9+/]{' + min + ',}={0,2}', 'g')) ?? [];
}
