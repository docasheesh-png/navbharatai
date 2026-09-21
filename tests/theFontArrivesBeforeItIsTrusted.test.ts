// The Add-text font is trusted only once its stylesheet has ARRIVED and its faces are LOADED.
//
// Admin, 2026-09-21: "text add kiya, text ka font change kiya par ho nahi raha hai, fix karo."
//
// Reproduced in a real Chromium against a stylesheet that took 1.5 s to arrive: `document.fonts.load()`
// resolved in 0 ms having matched NOTHING, `document.fonts.check()` answered TRUE, and the canvas
// measured "Hello World" at 423.8 px in the fallback against 355 px in the real face. `check()` is
// true when no face of the family exists yet — and equally true for a family that does not exist at
// all — so the loader said "ready" before the font was there, the editor painted in the fallback, and
// nothing ever painted again. The same answer also meant the "could not be loaded" warning could
// never fire. This suite drives the loader with a fake document that behaves as Chromium measured.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Face = { status: 'loaded' | 'unloaded' | 'error' };
interface FakeOpts {
  /** What the `<link>` does once appended. */
  sheet: 'load' | 'error' | 'never';
  /** What `fonts.load` resolves to AFTER the sheet has loaded (before it, always [] — as measured). */
  faces?: Face[] | 'reject';
  /** Leave `document.fonts` undefined — an old WebView. */
  noFontsApi?: boolean;
}

function installFakeDocument(opts: FakeOpts) {
  const links: Array<{ id: string; rel: string; href: string; sheet: object | null; removed: boolean; onload: null | (() => void); onerror: null | (() => void) }> = [];
  let sheetLoaded = false;
  const loadCalls: Array<{ spec: string; beforeSheet: boolean }> = [];
  let checkCalls = 0;
  const fonts = opts.noFontsApi ? undefined : {
    load: async (spec: string) => {
      loadCalls.push({ spec, beforeSheet: !sheetLoaded });
      if (!sheetLoaded) return [];               // Chromium: nothing matches until the @font-face rules exist
      if (opts.faces === 'reject') throw new Error('NetworkError: A network error occurred.');
      return opts.faces ?? [];
    },
    check: () => { checkCalls += 1; return true; }, // the trap: always true
  };
  const doc = {
    fonts,
    head: {
      appendChild: (link: (typeof links)[number]) => {
        links.push(link);
        if (opts.sheet === 'load') setTimeout(() => { sheetLoaded = true; link.sheet = {}; link.onload?.(); }, 5);
        if (opts.sheet === 'error') setTimeout(() => { link.onerror?.(); }, 5);
      },
    },
    createElement: (tag: string) => {
      if (tag !== 'link') throw new Error('unexpected element ' + tag);
      const link = { id: '', rel: '', href: '', sheet: null as object | null, removed: false, onload: null, onerror: null } as (typeof links)[number];
      (link as unknown as { remove: () => void }).remove = () => { link.removed = true; };
      return link;
    },
    getElementById: (id: string) => links.find((l) => l.id === id && !l.removed) ?? null,
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  return { links, loadCalls, checks: () => checkCalls };
}

async function freshLoader() {
  vi.resetModules();
  return import('../src/lib/imageFontLoader');
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('🔴 the race that broke "change the font"', () => {
  beforeEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });
  afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });

  it('does NOT report ready while the stylesheet has not arrived — and does not even ask fonts.load yet', async () => {
    const fake = installFakeDocument({ sheet: 'never', faces: [{ status: 'loaded' }] });
    const { loadImageFont } = await freshLoader();
    const verdict = loadImageFont('poppins');
    const outcome = await Promise.race([verdict.then(() => 'settled'), settle().then(() => 'still waiting')]);
    expect(outcome).toBe('still waiting');
    expect(fake.loadCalls).toEqual([]);
    expect(fake.links).toHaveLength(1);
    expect(fake.links[0].href).toContain('fonts.googleapis.com');
  });

  it('reports ready only after the sheet loaded AND every face it matched is loaded — both weights asked', async () => {
    const fake = installFakeDocument({ sheet: 'load', faces: [{ status: 'loaded' }] });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('poppins')).resolves.toBe(true);
    expect(fake.loadCalls.map((c) => c.beforeSheet)).toEqual([false, false]);
    expect(fake.loadCalls.map((c) => c.spec)).toEqual(['400 64px "Poppins"', '700 64px "Poppins"']);
  });

  it('🔒 fonts.check() is never consulted for the verdict — it is true for a font that is not there', async () => {
    const fake = installFakeDocument({ sheet: 'load', faces: [] });
    const { loadImageFont } = await freshLoader();
    // The sheet loaded but the family has NO face here (a name Google served nothing for): check()
    // would say true; the honest answer is false.
    await expect(loadImageFont('poppins')).resolves.toBe(false);
    expect(fake.checks()).toBe(0);
  });

  it('a face that matched but did not load is not "ready"', async () => {
    installFakeDocument({ sheet: 'load', faces: [{ status: 'loaded' }, { status: 'error' }] });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('poppins')).resolves.toBe(false);
  });

  it('a single-weight display face answers both asks with its one face, and that is ready', async () => {
    const one: Face = { status: 'loaded' };
    installFakeDocument({ sheet: 'load', faces: [one] });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('bungee')).resolves.toBe(true);
  });
});

describe('🔒 it never lies about success, and a failure is retryable', () => {
  beforeEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });
  afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });

  it('a stylesheet the browser refused (400, blocked host, offline) is false — and the link is removed so a retry really fetches', async () => {
    const fake = installFakeDocument({ sheet: 'error' });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('poppins')).resolves.toBe(false);
    expect(fake.links[0].removed).toBe(true);
    await expect(loadImageFont('poppins')).resolves.toBe(false);
    expect(fake.links).toHaveLength(2);
    expect(fake.loadCalls).toEqual([]);
  });

  it('a face whose file failed to fetch (load() rejects) is false', async () => {
    installFakeDocument({ sheet: 'load', faces: 'reject' });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('poppins')).resolves.toBe(false);
  });

  it('a device with no document.fonts cannot be asked — true, never a warning it cannot justify', async () => {
    installFakeDocument({ sheet: 'load', noFontsApi: true });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('poppins')).resolves.toBe(true);
  });

  it('the default (device) font needs nothing fetched', async () => {
    const fake = installFakeDocument({ sheet: 'never' });
    const { loadImageFont } = await freshLoader();
    await expect(loadImageFont('system')).resolves.toBe(true);
    expect(fake.links).toHaveLength(0);
  });

  it('ten layers on one face fetch it once, and share one verdict', async () => {
    const fake = installFakeDocument({ sheet: 'load', faces: [{ status: 'loaded' }] });
    const { loadImageFont } = await freshLoader();
    const results = await Promise.all(Array.from({ length: 10 }, () => loadImageFont('poppins')));
    expect(results.every(Boolean)).toBe(true);
    expect(fake.links).toHaveLength(1);
    expect(fake.loadCalls).toHaveLength(2);
  });

  it('a link left in the document by an earlier mount is trusted only when its sheet exists', async () => {
    const fake = installFakeDocument({ sheet: 'load', faces: [{ status: 'loaded' }] });
    const first = await freshLoader();
    await expect(first.loadImageFont('poppins')).resolves.toBe(true);
    // A remount: fresh module state, same document, the link already there with its sheet.
    const second = await freshLoader();
    await expect(second.loadImageFont('poppins')).resolves.toBe(true);
    expect(fake.links).toHaveLength(1);
  });
});
