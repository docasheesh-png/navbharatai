// A SINGLE HTML PAGE IS IMPORTED AS A PROJECT (single-file game autopsy, 2026-11-14): picked through "Import project", read in the
// browser, its media moved out BEFORE upload, and what is sent is code + real files. The upload is captured from `fetch`, so what
// the server receives is what is asserted — not an internal call.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/lib/authHeaders', () => ({ authJsonHeaders: async () => ({ 'Content-Type': 'application/json' }) }));
import { importSingleHtml } from '../src/lib/masterZipImport';
import { isHtmlPagePick, projectAccept } from '../src/lib/zipPicker';
import { IMPORT_LIMITS } from '../src/lib/importRules';
import { prepareImportBody } from '../src/server/AgentV3/importLanding';
import { buildGameFixture, fixtureMedia, longBase64Runs } from './helpers/singleFileGameFixture';

const bodies: Array<{ files: Record<string, string> }> = [];
beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; }));
});

describe('the pick', () => {
  it('knows an HTML page by name or type, and not a zip', () => {
    expect(isHtmlPagePick({ name: 'Game.HTML' })).toBe(true);
    expect(isHtmlPagePick({ name: 'x.htm' })).toBe(true);
    expect(isHtmlPagePick({ name: 'blob', type: 'text/html' })).toBe(true);
    expect(isHtmlPagePick({ name: 'app.zip', type: 'application/zip' })).toBe(false);
    expect(isHtmlPagePick(null)).toBe(false);
  });
  it('the picker offers pages as well as archives, and everything on Android', () => {
    expect(projectAccept('Mozilla/5.0 (X11; Linux x86_64)')).toMatch(/\.zip.*\.html/);
    expect(projectAccept('Mozilla/5.0 (Linux; Android 14)')).toBe('*/*');
  });
});

describe('importSingleHtml', () => {
  const { html, media } = buildGameFixture(fixtureMedia(8.5));
  const file = new File([html], 'Riseup Mart.html', { type: 'text/html' });

  it('uploads code + real media files — the 5.5 MB page is NOT sent as text', async () => {
    const r = await importSingleHtml(file, 'ws-1', 'u', 'e@x.y');
    const sent = Object.assign({}, ...bodies.map((b) => b.files)) as Record<string, string>;
    expect(Object.keys(sent)).toContain('index.html');
    expect(sent['index.html'].length).toBeLessThan(IMPORT_LIMITS.maxTextFileBytes);
    expect(longBase64Runs(sent['index.html'], 200)).toEqual([]);
    const mediaPaths = Object.keys(sent).filter((p) => p.startsWith('assets/media/'));
    expect(mediaPaths).toHaveLength(6);
    expect(mediaPaths.every((p) => sent[p].startsWith('data:'))).toBe(true);
    expect(r.imported).toBe(7);
    expect(r.dropSummary).toMatch(/Moved 6 embedded media file/);
    // …and the server door agrees: what arrived is sorted as 1 text file + 6 assets, nothing re-lifted.
    const landed = prepareImportBody(sent);
    expect(Object.keys(landed.text)).toEqual(['index.html']);
    expect(Object.keys(landed.assets)).toHaveLength(6);
    expect(media.video.length).toBeGreaterThan(1_000_000);
  });

  it('keeps every localStorage key', async () => {
    await importSingleHtml(file, 'ws-1', 'u', 'e');
    const sent = Object.assign({}, ...bodies.map((b) => b.files)) as Record<string, string>;
    for (const key of ['riseup_mart_sim_v2', 'swstats3', 'ru_pause_cfg_v1']) expect(sent['index.html']).toContain(key);
  });

  it('refuses a page over the page ceiling and an empty page, with a reason', async () => {
    const huge = { size: IMPORT_LIMITS.maxHtmlSourceBytes + 1, name: 'big.html', text: async () => '' } as unknown as File;
    await expect(importSingleHtml(huge, 'ws', 'u', 'e')).rejects.toThrow(/over the \d+ MB limit/);
    await expect(importSingleHtml(new File(['  '], 'e.html'), 'ws', 'u', 'e')).rejects.toThrow(/empty/);
    expect(bodies).toHaveLength(0);
  });

  it('a failed upload is reported, never counted as imported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const r = await importSingleHtml(new File(['<html><body>' + 'x'.repeat(3000) + '</body></html>'], 'a.html'), 'ws', 'u', 'e');
    expect(r.imported).toBe(0);
    expect(r.dropSummary).toMatch(/failed to upload/);
  });
});
