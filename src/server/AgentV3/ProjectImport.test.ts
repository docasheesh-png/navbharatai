import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  isZipAttachment,
  safeImportPath,
  extractZipProject,
  detectImportedFramework,
  validateImportedProject,
  importSummaryLine,
  droppedDetailNote,
  chooseMonorepoAppRoot,
  envTemplateNote,
  assetMimeFor,
  parseDataUri,
  IMPORT_MAX_FILES,
} from './ProjectImport';

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

/** Zip with binary entries (Buffers) for asset tests. */
async function makeZipBinary(entries: Record<string, Buffer | string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('isZipAttachment', () => {
  it('detects zips by extension and by MIME', () => {
    expect(isZipAttachment({ name: 'MyApp.ZIP', type: 'application/octet-stream' })).toBe(true);
    expect(isZipAttachment({ name: 'x.bin', type: 'application/zip' })).toBe(true);
    expect(isZipAttachment({ name: 'x.bin', type: 'application/x-zip-compressed' })).toBe(true);
    expect(isZipAttachment({ name: 'photo.png', type: 'image/png' })).toBe(false);
    expect(isZipAttachment({})).toBe(false);
  });
});

describe('safeImportPath (zip-slip guard)', () => {
  it('normalizes backslashes and leading ./', () => {
    expect(safeImportPath('src\\App.tsx')).toBe('src/App.tsx');
    expect(safeImportPath('./src/main.ts')).toBe('src/main.ts');
  });
  it('rejects traversal, absolute and empty paths', () => {
    expect(safeImportPath('../../etc/passwd')).toBeNull();
    expect(safeImportPath('src/../../x')).toBeNull();
    expect(safeImportPath('/etc/passwd')).toBeNull();
    expect(safeImportPath('C:/windows/system32')).toBeNull();
    expect(safeImportPath('a//b')).toBeNull();
    expect(safeImportPath('')).toBeNull();
  });
});

describe('extractZipProject', () => {
  it('extracts source files and strips a single GitHub-style root folder', async () => {
    const buf = await makeZip({
      'my-app-main/package.json': '{"name":"my-app","scripts":{"dev":"vite"}}',
      'my-app-main/src/App.tsx': 'export default () => <div>hi</div>;',
      'my-app-main/index.html': '<html></html>',
    });
    const out = await extractZipProject(buf);
    expect(out.strippedRoot).toBe('my-app-main');
    expect(Object.keys(out.files).sort()).toEqual(['index.html', 'package.json', 'src/App.tsx']);
  });

  it('does NOT strip a root when entries do not share one folder', async () => {
    const buf = await makeZip({ 'package.json': '{}', 'src/App.tsx': 'x' });
    const out = await extractZipProject(buf);
    expect(out.strippedRoot).toBeNull();
    expect(out.files['package.json']).toBe('{}');
  });

  it('drops node_modules/build dirs, live secrets, and large binaries — with honest counts', async () => {
    const buf = await makeZip({
      'package.json': '{}',
      'node_modules/react/index.js': 'x',
      'dist/bundle.js': 'x',
      '.env': 'API_KEY=supersecret',
      '.env.example': 'API_KEY=',
      'certs/server.pem': 'x',
      'video.mp4': 'x', // a non-asset binary → dropped
      'src/main.ts': 'console.log(1)',
    });
    const out = await extractZipProject(buf);
    expect(Object.keys(out.files).sort()).toEqual(['.env.example', 'package.json', 'src/main.ts']);
    expect(out.dropped.dir).toBe(2);
    expect(out.dropped.secret).toBe(2);
    expect(out.dropped.binary).toBe(1); // the .mp4 (a small .png would be KEPT as an asset — see below)
    expect(out.files['.env']).toBeUndefined(); // live secrets NEVER land in the workspace
  });

  it('rejects zip-slip entries instead of writing them', async () => {
    const zip = new JSZip();
    zip.file('ok.txt', 'fine');
    // Windows-style traversal — jszip stores this entry name literally (its own authoring
    // normalization only rewrites forward-slash "../" prefixes), so loadAsync presents exactly
    // what a maliciously crafted archive would. safeImportPath must refuse it.
    zip.file('..\\..\\evil.sh', 'rm -rf /');
    const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    const out = await extractZipProject(buf);
    expect(out.files['ok.txt']).toBe('fine');
    expect(out.dropped.unsafe).toBeGreaterThanOrEqual(1);
    expect(Object.keys(out.files).some((p) => p.includes('..'))).toBe(false);
  });

  it('enforces the file-count cap with an honest overCap count', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < IMPORT_MAX_FILES + 25; i++) entries[`src/f${i}.ts`] = 'x';
    const out = await extractZipProject(await makeZip(entries));
    expect(Object.keys(out.files)).toHaveLength(IMPORT_MAX_FILES);
    expect(out.dropped.overCap).toBe(25);
  });
});

describe('detectImportedFramework', () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
  it('maps package.json deps to FrameworkPicker ids', () => {
    expect(detectImportedFramework({ 'package.json': pkg({ next: '14.0.0' }) })).toBe('nextjs');
    expect(detectImportedFramework({ 'package.json': pkg({ nuxt: '3' }) })).toBe('nuxt');
    expect(detectImportedFramework({ 'package.json': pkg({ '@sveltejs/kit': '2' }) })).toBe('sveltekit');
    expect(detectImportedFramework({ 'package.json': pkg({ svelte: '4' }) })).toBe('svelte');
    expect(detectImportedFramework({ 'package.json': pkg({ vue: '3' }) })).toBe('vue');
    expect(detectImportedFramework({ 'package.json': pkg({ '@angular/core': '17' }) })).toBe('angular');
    expect(detectImportedFramework({ 'package.json': pkg({ astro: '4' }) })).toBe('astro');
    expect(detectImportedFramework({ 'package.json': pkg({ react: '18' }) })).toBe('vite-react');
    expect(detectImportedFramework({ 'package.json': pkg({ express: '4' }) })).toBe('node-express');
    expect(detectImportedFramework({ 'package.json': pkg({}) })).toBe('vanilla');
  });
  it('next wins over react (Next.js apps depend on both)', () => {
    expect(detectImportedFramework({ 'package.json': pkg({ next: '14', react: '18' }) })).toBe('nextjs');
  });
  it('falls back sensibly without/with broken package.json', () => {
    expect(detectImportedFramework({ 'index.html': '<html></html>' })).toBe('vanilla');
    expect(detectImportedFramework({ 'src/x.ts': 'x' })).toBe('vite-react');
    expect(detectImportedFramework({ 'package.json': '{broken' })).toBe('vite-react');
  });
});

describe('validateImportedProject', () => {
  it('hard-fails only a truly empty archive', () => {
    const v = validateImportedProject({});
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toContain('no importable source files');
  });
  it('passes a runnable project with no issues', () => {
    const v = validateImportedProject({ 'package.json': '{"scripts":{"dev":"vite"}}', 'src/main.ts': 'x' });
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });
  it('warns (but still imports) when there is no dev/start script or broken JSON', () => {
    expect(validateImportedProject({ 'package.json': '{"scripts":{}}' }).issues[0]).toContain('no dev/start/serve script');
    expect(validateImportedProject({ 'package.json': '{broken' }).issues[0]).toContain('not valid JSON');
  });
  it('warns for a non-web-project-looking archive', () => {
    const v = validateImportedProject({ 'notes.txt': 'hello' });
    expect(v.ok).toBe(true);
    expect(v.issues[0]).toContain('does not look like a runnable web project');
  });
});

/** Build an ExtractedProject literal for note/summary tests without repeating every zero. */
function extracted(over: {
  files?: Record<string, string>;
  assets?: Record<string, string>;
  sandboxOnly?: Record<string, string>;
  dropped?: Partial<import('./ProjectImport').ExtractedProject['dropped']>;
  totalEntries?: number;
  strippedRoot?: string | null;
  appRoot?: string | null;
}): import('./ProjectImport').ExtractedProject {
  return {
    files: over.files ?? {},
    assets: over.assets ?? {},
    sandboxOnly: over.sandboxOnly ?? {},
    dropped: { dir: 0, junk: 0, secret: 0, binary: 0, tooLarge: 0, unsafe: 0, overCap: 0, outsideAppRoot: 0, ...(over.dropped ?? {}) },
    totalEntries: over.totalEntries ?? 0,
    strippedRoot: over.strippedRoot ?? null,
    appRoot: over.appRoot ?? null,
  };
}

describe('droppedDetailNote', () => {
  it('is empty when nothing was dropped', () => {
    expect(droppedDetailNote(extracted({ files: { 'a.ts': 'x' }, totalEntries: 1 }))).toBe('');
  });
  it('lists every drop reason honestly', () => {
    const note = droppedDetailNote(extracted({ dropped: { dir: 5, junk: 2, secret: 1, tooLarge: 2, unsafe: 1, outsideAppRoot: 4 }, totalEntries: 15 }));
    expect(note).toContain('5 from dependency/build folders');
    expect(note).toContain('2 OS/editor junk files');
    expect(note).toContain('1 secret file');
    expect(note).toContain('2 over the 900KB');
    expect(note).toContain('1 with unsafe paths');
    expect(note).toContain('4 outside the detected app folder');
  });
});

describe('importSummaryLine', () => {
  it('reports counts and skip reasons honestly', () => {
    const line = importSummaryLine(
      extracted({ files: { 'a.ts': 'x', 'b.ts': 'y' }, dropped: { dir: 3, secret: 1, binary: 2 }, totalEntries: 8, strippedRoot: 'app-main' }),
      'vite-react',
    );
    expect(line).toContain('Imported 2 files');
    expect(line).toContain('vite-react');
    expect(line).toContain('3 from dependency/build folders');
    expect(line).toContain('1 secret file');
    expect(line).toContain('2 binary assets');
  });
  it('mentions the re-rooted app folder and sandbox-only lockfiles', () => {
    const line = importSummaryLine(
      extracted({ files: { 'a.ts': 'x' }, sandboxOnly: { 'package-lock.json': 'big' }, appRoot: 'apps/web' }),
      'vite-react',
    );
    expect(line).toContain('apps/web');
    expect(line).toContain('package-lock.json');
    expect(line).toContain('sandbox only');
  });
});

describe('extractZipProject — Tier-2 additions', () => {
  it('drops stack-specific vendor dirs (Python/Rust/Expo) and OS junk files with honest counts', async () => {
    const buf = await makeZip({
      'package.json': '{}',
      'venv/lib/python3.11/site.py': 'x',
      '__pycache__/mod.cpython.pyc.txt': 'x',
      'target/release/notes.txt': 'x',
      '.expo/settings.json': '{}',
      '.idea/workspace.xml': '<xml/>',
      '.DS_Store.txt': 'keepme', // NOT junk — junk match is exact-name
      '.DS_Store': 'x',
      'src/Thumbs.db': 'x',
      'src/main.ts': 'ok',
    });
    const out = await extractZipProject(buf);
    expect(Object.keys(out.files).sort()).toEqual(['.DS_Store.txt', 'package.json', 'src/main.ts']);
    expect(out.dropped.dir).toBe(5);
    expect(out.dropped.junk).toBe(2);
  });

  it('keeps an oversized text lockfile sandbox-only instead of dropping it', async () => {
    const bigLock = `{"name":"app","packages":{${'"x":1,'.repeat(160_000)}"y":1}}`; // > 900KB
    expect(Buffer.byteLength(bigLock, 'utf8')).toBeGreaterThan(900 * 1024);
    const buf = await makeZip({ 'package.json': '{}', 'package-lock.json': bigLock, 'src/big.ts': 'x'.repeat(950 * 1024) });
    const out = await extractZipProject(buf);
    expect(out.sandboxOnly['package-lock.json']).toBe(bigLock);
    expect(out.files['package-lock.json']).toBeUndefined();
    // A non-lockfile over the cap is still dropped (this is a lockfile exception, not a cap raise).
    expect(out.files['src/big.ts']).toBeUndefined();
    expect(out.dropped.tooLarge).toBe(1);
  });

  it('re-roots a monorepo zip to the most app-like nested folder', async () => {
    const buf = await makeZip({
      'apps/web/package.json': '{"scripts":{"dev":"vite"},"dependencies":{"react":"18"}}',
      'apps/web/src/App.tsx': 'app',
      'packages/utils/package.json': '{"name":"utils"}',
      'packages/utils/index.ts': 'x',
      'README.md': 'root readme',
    });
    const out = await extractZipProject(buf);
    expect(out.appRoot).toBe('apps/web');
    expect(Object.keys(out.files).sort()).toEqual(['package.json', 'src/App.tsx']);
    expect(out.dropped.outsideAppRoot).toBe(3); // utils pkg + index + README
  });

  it('does NOT re-root when a root package.json exists, or when nothing looks like an app', async () => {
    const withRoot = await extractZipProject(await makeZip({
      'package.json': '{"workspaces":["apps/*"]}',
      'apps/web/package.json': '{"scripts":{"dev":"vite"}}',
    }));
    expect(withRoot.appRoot).toBeNull();
    expect(withRoot.files['package.json']).toContain('workspaces');
    // Two top-level folders so the single-root strip doesn't apply; the only nested
    // package.json is metadata-only (scores 0) → no re-root, everything lands as-is.
    const noApp = await extractZipProject(await makeZip({
      'docs/package.json': '{"name":"just-metadata"}',
      'notes/readme.md': 'x',
    }));
    expect(noApp.appRoot).toBeNull();
    expect(noApp.files['notes/readme.md']).toBe('x');
  });
});

describe('small binary assets', () => {
  it('assetMimeFor maps keepable image/font extensions, rejects the rest', () => {
    expect(assetMimeFor('src/logo.PNG')).toBe('image/png');
    expect(assetMimeFor('a/b/icon.svg')).toBeNull(); // svg is text, imported as a normal file
    expect(assetMimeFor('fonts/Inter.woff2')).toBe('font/woff2');
    expect(assetMimeFor('media/intro.mp4')).toBeNull(); // video is not a small asset
    expect(assetMimeFor('README')).toBeNull();
  });

  it('parseDataUri round-trips a data URI, rejects non-data strings', () => {
    expect(parseDataUri('data:image/png;base64,AAAA')).toEqual({ mime: 'image/png', base64: 'AAAA' });
    expect(parseDataUri('not a data uri')).toBeNull();
    expect(parseDataUri('data:image/png,rawtext')).toBeNull(); // not base64
  });

  it('keeps a small image asset as a decodable data URI and drops a large one + a video', async () => {
    const smallPng = Buffer.alloc(10 * 1024, 7); // 10KB — kept
    const bigPng = Buffer.alloc(300 * 1024, 9);  // 300KB > 200KB cap — dropped
    const video = Buffer.alloc(5 * 1024, 1);     // small but not a keepable asset type — dropped
    const out = await extractZipProject(await makeZipBinary({
      'package.json': '{}',
      'public/logo.png': smallPng,
      'public/hero.png': bigPng,
      'media/clip.mp4': video,
      'src/main.ts': 'ok',
    }));
    // The small asset is kept OUT of `files` and IN `assets` as a data URI.
    expect(out.files['public/logo.png']).toBeUndefined();
    const uri = out.assets['public/logo.png'];
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const parsed = parseDataUri(uri);
    expect(parsed).not.toBeNull();
    expect(Buffer.from(parsed!.base64, 'base64').equals(smallPng)).toBe(true); // real bytes, uncorrupted
    // The oversized image and the video are dropped (counted as binary), not kept.
    expect(out.assets['public/hero.png']).toBeUndefined();
    expect(out.assets['media/clip.mp4']).toBeUndefined();
    expect(out.dropped.binary).toBe(2);
    // Text files still land normally.
    expect(out.files['src/main.ts']).toBe('ok');
  });

  it('importSummaryLine mentions kept assets', () => {
    const line = importSummaryLine(
      extracted({ files: { 'a.ts': 'x' }, assets: { 'logo.png': 'data:image/png;base64,AA', 'i.ico': 'data:image/x-icon;base64,BB' } }),
      'vite-react',
    );
    expect(line).toContain('2 image/font assets');
  });
});

describe('chooseMonorepoAppRoot', () => {
  it('prefers a runnable app over a bare package, and apps/ over other homes', () => {
    const root = chooseMonorepoAppRoot([
      { path: 'packages/ui/package.json', content: '{"dependencies":{"react":"18"}}' },
      { path: 'apps/web/package.json', content: '{"scripts":{"dev":"next dev"},"dependencies":{"next":"14"}}' },
    ]);
    expect(root).toBe('apps/web');
  });
  it('skips nested workspace containers and unparseable candidates; null when nothing scores', () => {
    expect(chooseMonorepoAppRoot([
      { path: 'sub/package.json', content: '{"workspaces":["a"],"scripts":{"dev":"x"}}' },
      { path: 'broken/package.json', content: '{nope' },
      { path: 'plain/package.json', content: '{"name":"meta-only"}' },
    ])).toBeNull();
    expect(chooseMonorepoAppRoot([])).toBeNull();
  });
});

describe('envTemplateNote', () => {
  it('surfaces the variable NAMES from a .env template (values never imported)', () => {
    const note = envTemplateNote({ '.env.example': 'API_URL=https://x\nexport SUPABASE_KEY=\n# comment\nDB_URL=postgres://' });
    expect(note).toContain('3 environment variables');
    expect(note).toContain('API_URL');
    expect(note).toContain('SUPABASE_KEY');
    expect(note).toContain('DB_URL');
  });
  it('is empty without a template or without variables', () => {
    expect(envTemplateNote({ 'src/main.ts': 'x' })).toBe('');
    expect(envTemplateNote({ '.env.example': '# only comments\n' })).toBe('');
  });
  it('caps the shown list honestly', () => {
    const vars = Array.from({ length: 20 }, (_, i) => `VAR_${i}=x`).join('\n');
    const note = envTemplateNote({ '.env.sample': vars });
    expect(note).toContain('20 environment variables');
    expect(note).toContain('+8 more');
  });
});
