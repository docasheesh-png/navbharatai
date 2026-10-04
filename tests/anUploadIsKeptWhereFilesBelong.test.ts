/**
 * Q-542 (autopsy 68f0a486, "Gyan Spark Academy"): uploaded videos and PDFs were turned into data URLs and
 * saved in localStorage — about 5 MB for the whole app — while the summary said "drag-and-drop uploads work".
 * The class: file bytes put into a small key-value store. Fixed upstream (prompt rule, the pro starters ship
 * an IndexedDB file store, our own social starter no longer models the bug, a failed save is shown), at write
 * time (a once-per-build note carrying the file store), and in the summary (the claim is corrected).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { transformSync } from 'esbuild';
import {
  BROWSER_FILE_STORE_TS, appKeepsUploadsInSmallStore, readsUploadIntoText, uploadStorageWriteNote, uploadsClaim,
} from '../src/server/AgentV3/browserFileStore';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { proStoreTs, proUiTsx } from '../src/server/AgentV3/goldenScaffolds/proShell';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

/** The report's shape: an upload screen reads files as data URLs, a context saves the list in localStorage. */
const SCHOOL = {
  'src/pages/Materials.tsx': `export default function Materials() {
  const { addMaterial } = useSchool();
  function onDrop(files: FileList) {
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => addMaterial({ name: file.name, type: file.type, data: String(reader.result) });
      reader.readAsDataURL(file);
    }
  }
  return <div onDrop={(e) => onDrop(e.dataTransfer.files)}>Drag and drop videos or PDFs</div>;
}`,
  'src/context/SchoolContext.tsx': `export function SchoolProvider() {
  const [materials, setMaterials] = useState(() => JSON.parse(localStorage.getItem('gyan_materials') || '[]'));
  useEffect(() => { localStorage.setItem('gyan_materials', JSON.stringify(materials)); }, [materials]);
}`,
};

describe('the class: file bytes in a small key-value store', () => {
  it('the school app is caught', () => {
    expect(appKeepsUploadsInSmallStore(SCHOOL)).toBe(true);
    expect(readsUploadIntoText('src/pages/Materials.tsx', SCHOOL['src/pages/Materials.tsx'])).toBe(true);
  });

  it('every small store counts: sessionStorage, NavData rows, a persisted collection', () => {
    const page = SCHOOL['src/pages/Materials.tsx'];
    expect(appKeepsUploadsInSmallStore({ 'src/a.tsx': page, 'src/b.ts': "sessionStorage.setItem('x', v)" })).toBe(true);
    expect(appKeepsUploadsInSmallStore({ 'src/a.tsx': page, 'src/b.ts': 'await window.NavData.add("files", row)' })).toBe(true);
    expect(appKeepsUploadsInSmallStore({ 'src/a.tsx': page, 'src/b.tsx': "const posts = useCollection<Post>('posts', [])" })).toBe(true);
  });

  it('an app that keeps files where they belong is not', () => {
    expect(appKeepsUploadsInSmallStore({ ...SCHOOL, 'src/lib/files.ts': BROWSER_FILE_STORE_TS })).toBe(false);
    expect(appKeepsUploadsInSmallStore({ ...SCHOOL, 'src/lib/up.ts': "await supabase.storage.from('materials').upload(path, file)" })).toBe(false);
    expect(appKeepsUploadsInSmallStore({ ...SCHOOL, 'src/lib/up.ts': "import { uploadBytes } from 'firebase/storage';" })).toBe(false);
    expect(appKeepsUploadsInSmallStore({ ...SCHOOL, 'src/lib/db.ts': "import { set } from 'idb-keyval';" })).toBe(false);
  });

  it('no upload read into text, or nowhere saved — not the class', () => {
    expect(appKeepsUploadsInSmallStore({ 'src/b.ts': SCHOOL['src/context/SchoolContext.tsx'] })).toBe(false);
    expect(appKeepsUploadsInSmallStore({ 'src/a.tsx': SCHOOL['src/pages/Materials.tsx'] })).toBe(false);
    // A canvas drawing exported with toDataURL is not an upload.
    expect(appKeepsUploadsInSmallStore({ 'src/a.tsx': 'const png = canvas.toDataURL();', 'src/b.ts': "localStorage.setItem('d', png)" })).toBe(false);
    // Tests and build output are not the app.
    expect(appKeepsUploadsInSmallStore({ 'src/a.test.tsx': SCHOOL['src/pages/Materials.tsx'], 'src/b.ts': "localStorage.setItem('x', v)" })).toBe(false);
  });
});

describe('said while the file is open — once, with the fix one write away', () => {
  it('the note names the file, the 5 MB limit, the two right places, and carries the file store', () => {
    const note = uploadStorageWriteNote('src/pages/Materials.tsx', SCHOOL['src/pages/Materials.tsx']);
    expect(note).toContain('src/pages/Materials.tsx');
    expect(note).toMatch(/5 MB/);
    expect(note).toContain('generate_storage');
    expect(note).toContain('saveFile(file)');
    expect(note).toContain(BROWSER_FILE_STORE_TS);
    expect(uploadStorageWriteNote('src/lib/files.ts', BROWSER_FILE_STORE_TS)).toBe('');
    expect(uploadStorageWriteNote('src/index.css', 'readAsDataURL(')).toBe('');
  });

  class FakeActuator implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_ws: string, path: string): Promise<string> {
      const f = this.files.get(path);
      if (f === undefined) throw new Error(`ENOENT: ${path}`);
      return f;
    }
    async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_ws: string, port: number): Promise<string> { return `https://s-${port}.example.dev`; }
  }

  it('the builder hears it on its first such write, and only once per build', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new FakeActuator(), 'ws-up', new WorkspaceState(stream), stream);
    const write = async (path: string) => String((await d.dispatch({ id: path, name: 'write_file', input: { path, content: SCHOOL['src/pages/Materials.tsx'] } }, 'architect')).content);
    expect(await write('src/pages/Materials.tsx')).toContain('📁 Upload storage — src/pages/Materials.tsx');
    expect(await write('src/pages/Homework.tsx')).not.toContain('📁 Upload storage');
  });
});

describe('the summary may not call such uploads working', () => {
  const facts = { consoleCaptured: true, screenshotTaken: false, previewVerified: true, uploadsInSmallStore: true };

  it('the report\'s claim is corrected', () => {
    const got = auditSummaryClaims('Teachers get drag-and-drop uploads for videos and PDFs, plus fees and attendance.', facts);
    expect(got.map((c) => c.kind)).toContain('uploads-in-small-store');
    expect(got.find((c) => c.kind === 'uploads-in-small-store')!.measured).toMatch(/about 5 MB/);
  });

  it('a sentence that says where the files stay is honest; no fact, no check', () => {
    expect(uploadsClaim('Uploads are saved on this device only.')).toBeNull();
    expect(auditSummaryClaims('Uploads are kept locally in your browser.', facts).map((c) => c.kind)).not.toContain('uploads-in-small-store');
    expect(auditSummaryClaims('Drag-and-drop uploads work.', { ...facts, uploadsInSmallStore: undefined }).map((c) => c.kind)).not.toContain('uploads-in-small-store');
    expect(auditSummaryClaims('Drag-and-drop uploads work.', { ...facts, uploadsInSmallStore: false }).map((c) => c.kind)).not.toContain('uploads-in-small-store');
  });

  it('the route judges it only on the files that ARE the app', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('uploadsInSmallStore: isImportTurn || isEditMode ? undefined : appKeepsUploadsInSmallStore(Object.fromEntries(writtenFiles)),');
  });
});

describe('upstream: the builder is told, and our own starters no longer model the bug', () => {
  it('the system prompt names the right place for a saved upload', () => {
    const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(prompt).toMatch(/A saved upload goes into IndexedDB as the file itself — src\/lib\/files\.ts/);
  });

  it('census: no starter keeps uploads in a small store, and every pro starter ships the file store', () => {
    for (const g of GOLDEN_SCAFFOLDS) {
      const files = goldenScaffoldFiles(g);
      expect(appKeepsUploadsInSmallStore(files), g.id).toBe(false);
      // Per file too: shipping the file store does not excuse a screen that still reads uploads into text.
      for (const [p, c] of Object.entries(files)) expect(readsUploadIntoText(p, c), `${g.id} ${p}`).toBe(false);
      if (g.tier === 'pro') expect(files['src/lib/files.ts'], g.id).toBe(BROWSER_FILE_STORE_TS);
    }
  });

  it('the social starter saves a photo as a file and says where it is kept', () => {
    const social = goldenScaffoldFiles(GOLDEN_SCAFFOLDS.find((g) => g.id === 'social-feed')!)['src/App.tsx'];
    expect(social).not.toMatch(/readAsDataURL/);
    expect(social).toContain("import { saveFile, useFileUrl } from './lib/files';");
    expect(social).toContain('Photos are saved on this device.');
  });

  it('a list that fails to save says so on every screen — never a silent loss', () => {
    expect(proStoreTs).not.toMatch(/catch\s*\{\s*\/\*\s*quota/);
    expect(proStoreTs).toContain("window.dispatchEvent(new CustomEvent('app:save-error', { detail: { key, message } }))");
    expect(proUiTsx).toContain("export const SAVE_ERROR_EVENT = 'app:save-error';");
    expect(proUiTsx).toContain('window.addEventListener(SAVE_ERROR_EVENT, onError);');
  });
});

// ── A REAL BROWSER, where one exists: the file store keeps what localStorage cannot ──────────────────────
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    // The module as an app would ship it, with React's two hooks stubbed (only the plain functions run here).
    const js = transformSync(BROWSER_FILE_STORE_TS.replace("import { useEffect, useState } from 'react';", 'const useEffect = () => {}; const useState = (v) => [v, () => {}];'), { loader: 'ts', format: 'esm' }).code;
    const page = `<!doctype html><html><body><script type="module">${js}
window.store = { saveFile, loadFile, removeFile };
window.ready = true;
</script></body></html>`;
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  it('a 6 MB video fails in localStorage, and is saved — and still there after a reload — in the file store', async () => {
    const script = `import playwright from '${PW}';
const { chromium } = playwright;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(${JSON.stringify(base)});
  await page.waitForFunction(() => window.ready === true);
  const out = await page.evaluate(async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024).map((_, i) => i % 251);
    const file = new File([bytes], 'lesson.mp4', { type: 'video/mp4' });
    const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    let localStorageSaved = true;
    try { localStorage.setItem('materials', JSON.stringify([{ name: file.name, data: dataUrl }])); } catch (e) { localStorageSaved = false; }
    const saved = await window.store.saveFile(file);
    return { localStorageSaved, saved };
  });
  await page.reload();
  await page.waitForFunction(() => window.ready === true);
  const back = await page.evaluate(async (id) => { const b = await window.store.loadFile(id); return b ? { size: b.size, type: b.type } : null; }, out.saved.id);
  console.log('RESULT ' + JSON.stringify({ ...out, back }));
} finally { await browser.close(); }
`;
    const dir = mkdtempSync(join(tmpdir(), 'nbai-files-real-'));
    const file = join(dir, 'run.mjs');
    writeFileSync(file, script);
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 90_000 }, (e, o) => (e ? rej(e) : res(o))));
    const r = JSON.parse(stdout.split('\n').find((l) => l.startsWith('RESULT '))!.slice(7));
    expect(r.localStorageSaved).toBe(false); // the report's way: the save throws
    expect(r.saved).toMatchObject({ name: 'lesson.mp4', type: 'video/mp4', size: 6 * 1024 * 1024 });
    expect(r.back).toEqual({ size: 6 * 1024 * 1024, type: 'video/mp4' }); // the file store's way: kept
  }, 120_000);
});
