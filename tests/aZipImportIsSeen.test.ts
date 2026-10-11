// A ZIP IMPORT IS SEEN (2026-10-11, Q-792).
//
// The Files panel's Upload button imports a whole .zip project (up to 5 GB through the chunked uploader).
// The import wrote its progress to `proBuildProgress` and its outcome to the Pro chat's message list —
// and no screen read either. So a large zip showed nothing for minutes, and a FAILED import changed
// nothing on screen at all. THE CLASS: feedback written to state no screen renders. These tests drive the
// real hook with a fake server stream and pin what the user now sees: progress while it runs, cleared
// however it ends, and a toast for the outcome — the file count, what was dropped, or why it failed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/storage', () => ({ saveAllFiles: vi.fn(async () => undefined) }));

const { useZipImport } = await import('../src/hooks/useZipImport');
type Progress = { fileName: string; stage: string; percent: number } | null;

/** A Response whose body is the given SSE events, one `data:` line each. */
function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n`).join('');
  return new Response(new Blob([body]).stream(), { status: 200 });
}

function harness() {
  const progress: Progress[] = [];
  const toasts: [string, string | undefined][] = [];
  const messages: any[] = [];
  const deps = {
    setFiles: vi.fn(), setHasGeneratedCode: vi.fn(), setIsAppBuilt: vi.fn(),
    setImportProgress: (p: Progress) => { progress.push(p); },
    setProMessages: (v: any) => { const next = typeof v === 'function' ? v(messages.slice()) : v; messages.splice(0, messages.length, ...next); },
    syncFilesToV3: vi.fn(async () => undefined),
    updatePreview: vi.fn(), toggleTab: vi.fn(),
    addToast: (m: string, t?: string) => { toasts.push([m, t]); },
  };
  return { deps, progress, toasts, messages, run: (file: File) => useZipImport(deps).handleZipImport(file) };
}

const zip = (name = 'shop.zip') => new File([new Uint8Array([80, 75, 3, 4])], name, { type: 'application/zip' });

describe('the import the user started from the Files panel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('🔒 shows progress while it runs, then clears it, and says how many files came in', async () => {
    const files = Array.from({ length: 16 }, (_, i) => ({ type: 'file', path: `src/f${i}.js`, content: 'x' }));
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'progress', stage: 'Scanning ZIP (0.1 MB)...' }, ...files, { type: 'complete', appName: 'Shop' }])));
    const h = harness();
    await h.run(zip());

    const shown = h.progress.filter(Boolean) as Exclude<Progress, null>[];
    expect(shown[0]).toMatchObject({ fileName: 'shop.zip' });
    expect(shown.some((p) => p.stage === 'Scanning ZIP (0.1 MB)...')).toBe(true);
    expect(shown.some((p) => /Loading files — 16 so far/.test(p.stage))).toBe(true);
    // never goes backwards
    for (let i = 1; i < shown.length; i++) expect(shown[i].percent).toBeGreaterThanOrEqual(shown[i - 1].percent);
    expect(h.progress.at(-1)).toBeNull();
    expect(h.toasts).toEqual([['Shop: 16 files imported', 'success']]);
  });

  it('🔒 a FAILED import says so on screen and clears the progress — it used to change nothing at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Upload too large', { status: 413 })));
    const h = harness();
    await h.run(zip());
    expect(h.toasts).toEqual([['ZIP import failed: Upload too large', 'error']]);
    expect(h.progress.at(-1)).toBeNull();
  });

  it('files the server refused are named in a warning, not only in a chat nobody sees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { type: 'file', path: 'index.html', content: '<p>hi</p>' },
      { type: 'skipped', reason: 'too large' },
      { type: 'complete', appName: 'Site' },
    ])));
    const h = harness();
    await h.run(zip('site.zip'));
    expect(h.toasts[0]).toEqual(['Site: 1 file imported', 'success']);
    expect(h.toasts[1][1]).toBe('warning');
    expect(h.toasts[1][0]).toMatch(/1 were not imported/);
  });
});

describe('the progress has a screen', () => {
  it('🔒 the Files panel draws it, and BOTH mounts of the panel are given it', () => {
    const panel = readFileSync('src/components/panels/FilesPanel.tsx', 'utf8');
    expect(panel).toContain('importProgress?: { fileName: string; stage: string; percent: number } | null;');
    expect(panel).toMatch(/\{importProgress && \(\s*<div role="status"/);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('importProgress: zipImportProgress,'); // the v5.0 Files tab (spread into FilesPanel)
    expect(app).toContain('zipImportProgress={zipImportProgress}'); // the sidebar Files panel, via ViewPanels
    const views = readFileSync('src/components/panels/ViewPanels.tsx', 'utf8');
    expect(views).toContain('importProgress={zipImportProgress}');
  });

  it('the invisible legacy state is gone, so the import cannot quietly write to it again', () => {
    // Code only — the comments that say what was removed legitimately name it.
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const app = code('src/App.tsx');
    const hook = code('src/hooks/useZipImport.ts');
    for (const name of ['proBuildProgress', 'setProBuildProgress', 'isProLoading', 'setIsProLoading', 'proInput', 'setProInput']) {
      expect(app, name).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(hook, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
