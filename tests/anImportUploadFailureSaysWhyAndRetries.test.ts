// AN IMPORT UPLOAD THAT FAILS SAYS WHY, RETRIES WHAT CAN SUCCEED, AND KEEPS MEDIA IN SMALL REQUESTS (single-file game autopsy, 2026-11-14).
// The admin's second import of `abcd.html` ended "0 file(s) were saved, but 1 batch(es) failed to upload": the client threw the HTTP
// status and the server's sentence away, never retried a rate limit or a gateway timeout, and put the whole 5 MB of media into one
// request. The cause of THAT failure is unknown (the status was discarded) — which is exactly the defect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/lib/authHeaders', () => ({ authJsonHeaders: async () => ({ 'Content-Type': 'application/json' }) }));
import { uploadExtractedFiles, partialSaveWarning, ASSET_BATCH_BYTES } from '../src/lib/masterZipImport';
import { b64, bytesWith } from './helpers/singleFileGameFixture';

const media = (kb: number, seed: number): string => 'data:video/mp4;base64,' + b64(bytesWith([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], kb * 1024, seed));
type Reply = { ok: boolean; status: number; error?: string } | Error;
let script: Reply[];
let calls: Array<{ files: Record<string, string> }>;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  script = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    const r = script.shift() ?? { ok: true, status: 200 };
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => (r.error ? { error: r.error } : {}) };
  }));
});
afterEach(() => { vi.useRealTimers(); });

const run = async (files: Record<string, string>) => {
  const p = uploadExtractedFiles(files, 'ws', 'u', 'e');
  await vi.runAllTimersAsync();
  return p;
};

describe('a transient failure is retried; a permanent one is not', () => {
  it('a 503 then success lands the batch (no failure reported)', async () => {
    script = [{ ok: false, status: 503 }, { ok: true, status: 200 }];
    const r = await run({ 'index.html': '<p>x</p>' });
    expect(r).toMatchObject({ imported: 1, failedBatches: 0, reasons: [] });
    expect(calls).toHaveLength(2);
  });
  it('a dropped connection is retried too', async () => {
    script = [new Error('Failed to fetch'), { ok: true, status: 200 }];
    expect((await run({ 'a.html': 'x' })).imported).toBe(1);
  });
  it('a 429 that never clears gives up after 3 tries and says so', async () => {
    script = [{ ok: false, status: 429, error: 'Too many requests' }, { ok: false, status: 429, error: 'Too many requests' }, { ok: false, status: 429, error: 'Too many requests' }];
    const r = await run({ 'a.html': 'x' });
    expect(calls).toHaveLength(3);
    expect(r.failedBatches).toBe(1);
    expect(r.reasons).toEqual(['429 — Too many requests']);
  });
  it('a 413 / 403 is NOT retried — asking again cannot change the answer — and the reason is kept', async () => {
    script = [{ ok: false, status: 413, error: 'Request too large' }];
    const r = await run({ 'a.html': 'x' });
    expect(calls).toHaveLength(1);
    expect(r.reasons[0]).toMatch(/^413/);
  });
});

describe('the user is told WHY', () => {
  it('the warning carries the reason and a retry that is true (import again; saved files are merged)', () => {
    const w = partialSaveWarning(1, 0, ['500 — Failed to import the files.']);
    expect(w).toContain('Why: 500 — Failed to import the files.');
    expect(w).toMatch(/Import it again/);
    expect(w).toMatch(/do not assume the whole project is in yet/i);
    expect(w).not.toMatch(/send your next message/i); // that retry never existed
  });
  it('no failure, no sentence', () => { expect(partialSaveWarning(0, 5, ['x'])).toBe(''); });
});

describe('media travels in small requests', () => {
  it('a code file and three 2 MB videos go as 1 text batch + media batches under the cap, nothing lost', async () => {
    const files: Record<string, string> = { 'index.html': '<p>game</p>', 'assets/media/a.mp4': media(2048, 1), 'assets/media/b.mp4': media(2048, 2), 'assets/media/c.mp4': media(2048, 3) };
    const r = await run(files);
    expect(r).toMatchObject({ imported: 4, failedBatches: 0 });
    expect(calls.length).toBeGreaterThanOrEqual(4); // 1 text + a media batch per video (2.7 MB each as base64)
    const sentPaths = calls.flatMap((c) => Object.keys(c.files)).sort();
    expect(sentPaths).toEqual(Object.keys(files).sort());
    for (const c of calls.filter((x) => Object.keys(x.files).some((p) => p.startsWith('assets/')))) {
      const bytes = Object.values(c.files).reduce((n, v) => n + v.length, 0);
      expect(Object.keys(c.files).length === 1 || bytes <= ASSET_BATCH_BYTES).toBe(true);
    }
    expect(calls[0].files['index.html']).toBeDefined(); // text first
  });
});

describe('an import that saved nothing is not announced as imported', () => {
  it('importLanded is false for 0 files, true for any', async () => {
    const { importLanded } = await import('../src/lib/masterZipImport');
    expect(importLanded({ imported: 0 })).toBe(false);
    expect(importLanded(null)).toBe(false);
    expect(importLanded({ imported: 1 })).toBe(true);
  });
  it('the panel stops before the success line, the Files paint and the preview boot', async () => {
    const { readFileSync } = await import('node:fs');
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    const stop = panel.indexOf('if (!importLanded(result)) {');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(panel.indexOf('adoptWorkspace(targetWorkspaceId);', stop));
    expect(stop).toBeLessThan(panel.indexOf('✅ Imported “${result.fileName}”', stop));
  });
});
