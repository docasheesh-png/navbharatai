import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  isZipAttachment,
  safeImportPath,
  extractZipProject,
  zipEntryDeclaredBytes,
  detectImportedFramework,
  validateImportedProject,
  importSummaryLine,
  importAccountingLine,
  maskNonCodeRegions,
  droppedDetailNote,
  chooseMonorepoAppRoot,
  envTemplateNote,
  assetMimeFor,
  parseDataUri,
  IMPORT_MAX_FILES, devScriptRunsNodeServer, findUnresolvedLocalImports, fixMispathLocalImports, shouldRetryImportAnonymously, detectFrameworkFromWorkspace,
  detectFrameworkFromSourceExtensions, frameworkFamily, checkFrameworkCoherence, frameworkCoherenceGuidance } from './ProjectImport';

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
    // Uses an injected small cap (the real IMPORT_MAX_FILES is 16000 — building that many entries
    // in a test zip is needlessly slow; the cap LOGIC is identical regardless of the number).
    const cap = 50;
    const entries: Record<string, string> = {};
    for (let i = 0; i < cap + 25; i++) entries[`src/f${i}.ts`] = 'x';
    const out = await extractZipProject(await makeZip(entries), { maxFiles: cap });
    expect(Object.keys(out.files)).toHaveLength(cap);
    expect(out.dropped.overCap).toBe(25);
  });

  it('the production file cap is raised to handle a large (Mitrify-scale) app', () => {
    expect(IMPORT_MAX_FILES).toBeGreaterThanOrEqual(16_000);
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

  describe('detectFrameworkFromWorkspace — correct a stale label on a continue turn (PulseBoard autopsy 2026-07-20)', () => {
    const vitePkg = pkg({ react: '18', 'react-dom': '18', vite: '5' });
    it('THE PulseBoard case: Next.js CODE + config but package.json STILL says Vite → nextjs (structure wins)', () => {
      // The exact drift: the label/package.json lagged as vite-react while the app was already Next.js.
      const files = {
        'package.json': vitePkg,              // still the vite scaffold — deps LAG the code
        'next.config.js': 'module.exports = {}',
        'src/app/layout.tsx': 'export default function L(){return null}',
        'src/app/api/ingest/route.ts': 'export function POST(){}',
      };
      expect(detectFrameworkFromWorkspace(files)).toBe('nextjs');
    });
    it('a real next dependency alone → nextjs (dependency signal)', () => {
      expect(detectFrameworkFromWorkspace({ 'package.json': pkg({ next: '14', react: '18' }) })).toBe('nextjs');
    });
    it('app-router SHAPE (layout + route handler) with no config file → nextjs', () => {
      expect(detectFrameworkFromWorkspace({
        'package.json': vitePkg,
        'app/dashboard/layout.tsx': 'export default function L(){}',
        'app/api/stats/route.ts': 'export function GET(){}',
      })).toBe('nextjs');
    });
    it('other framework config files are recognised', () => {
      expect(detectFrameworkFromWorkspace({ 'package.json': vitePkg, 'nuxt.config.ts': '' })).toBe('nuxt');
      expect(detectFrameworkFromWorkspace({ 'package.json': vitePkg, 'astro.config.mjs': '' })).toBe('astro');
      expect(detectFrameworkFromWorkspace({ 'package.json': vitePkg, 'svelte.config.js': '' })).toBe('sveltekit');
      expect(detectFrameworkFromWorkspace({ 'package.json': vitePkg, 'angular.json': '{}' })).toBe('angular');
    });
    it('NEVER false-flips a genuine Vite React app (returns null → caller keeps the label)', () => {
      expect(detectFrameworkFromWorkspace({
        'package.json': vitePkg,
        'vite.config.ts': '',
        'src/App.tsx': 'export default function App(){}',
        'src/components/layout.tsx': 'export const Layout = () => null', // a stray "layout" is NOT app-router
      })).toBeNull();
      expect(detectFrameworkFromWorkspace({})).toBeNull();
      expect(detectFrameworkFromWorkspace({ 'src/App.tsx': 'x' })).toBeNull();
    });
    it('a lone app-router layout WITHOUT a route handler does not flip (needs both signals)', () => {
      expect(detectFrameworkFromWorkspace({ 'package.json': vitePkg, 'src/app/layout.tsx': 'x' })).toBeNull();
    });
  });
  it('falls back sensibly without/with broken package.json', () => {
    expect(detectImportedFramework({ 'index.html': '<html></html>' })).toBe('vanilla');
    expect(detectImportedFramework({ 'src/x.ts': 'x' })).toBe('vite-react');
    expect(detectImportedFramework({ 'package.json': '{broken' })).toBe('vite-react');
  });

  // Fix 2 (2026-07-06): a Replit/Lovable FULL-STACK export (react frontend + Express server whose OWN
  // dev script boots it) is NOT a pure Vite app — its live preview runs on the Node server's port
  // (3000), not Vite's 5173. Mis-detecting it as vite-react caused "did not come up on port 5173".
  it('a react+express app whose dev script runs a node server → node-express (the Mitrify shape)', () => {
    const fullstack = JSON.stringify({
      dependencies: { react: '18', express: '4', 'drizzle-orm': '0.3' },
      scripts: { dev: 'NODE_ENV=development tsx server/index.ts' },
    });
    expect(detectImportedFramework({ 'package.json': fullstack })).toBe('node-express');
  });
  it('react + express but a VITE dev script stays vite-react (server dep alone must not flip it)', () => {
    const viteApp = JSON.stringify({ dependencies: { react: '18', express: '4' }, scripts: { dev: 'vite' } });
    expect(detectImportedFramework({ 'package.json': viteApp })).toBe('vite-react');
  });
  it('a meta-framework (Next) wins even with a node server dep + script', () => {
    const next = JSON.stringify({ dependencies: { next: '14', react: '18', express: '4' }, scripts: { dev: 'tsx server.ts' } });
    expect(detectImportedFramework({ 'package.json': next })).toBe('nextjs');
  });
});

describe('devScriptRunsNodeServer (full-stack tell)', () => {
  const s = (dev: string) => JSON.stringify({ scripts: { dev } });
  it('detects tsx/ts-node/node/nodemon launching a server entry', () => {
    expect(devScriptRunsNodeServer(s('tsx server/index.ts'))).toBe(true);
    expect(devScriptRunsNodeServer(s('NODE_ENV=development tsx server.ts'))).toBe(true);
    expect(devScriptRunsNodeServer(s('node dist/server.js'))).toBe(true);
    expect(devScriptRunsNodeServer(s('ts-node src/app.ts'))).toBe(true);
    expect(devScriptRunsNodeServer(s('nodemon'))).toBe(true);
  });
  it('is false for a Vite/framework dev script or missing input', () => {
    expect(devScriptRunsNodeServer(s('vite'))).toBe(false);
    expect(devScriptRunsNodeServer(s('next dev'))).toBe(false);
    expect(devScriptRunsNodeServer(s('vite --host'))).toBe(false);
    expect(devScriptRunsNodeServer(undefined)).toBe(false);
    expect(devScriptRunsNodeServer('{broken')).toBe(false);
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
  sandboxAssets?: Record<string, string>;
  sandboxOnly?: Record<string, string>;
  dropped?: Partial<import('./ProjectImport').ExtractedProject['dropped']>;
  totalEntries?: number;
  strippedRoot?: string | null;
  appRoot?: string | null;
}): import('./ProjectImport').ExtractedProject {
  return {
    files: over.files ?? {},
    assets: over.assets ?? {},
    sandboxAssets: over.sandboxAssets ?? {},
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

  it('durable-tiers a small image, sandbox-tiers a large one, drops a video', async () => {
    const smallPng = Buffer.alloc(10 * 1024, 7);  // 10KB — durable asset
    const bigPng = Buffer.alloc(900 * 1024, 9);   // 900KB > 640KB durable cap, <= 5MB — sandbox-only
    const video = Buffer.alloc(5 * 1024, 1);      // not a keepable asset type — dropped
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
    // The large image goes to the SANDBOX tier (renders in preview), not dropped, not durable.
    expect(out.sandboxAssets['public/hero.png']).toMatch(/^data:image\/png;base64,/);
    expect(out.assets['public/hero.png']).toBeUndefined();
    // Only the video is dropped now (a non-image binary).
    expect(out.assets['media/clip.mp4']).toBeUndefined();
    expect(out.sandboxAssets['media/clip.mp4']).toBeUndefined();
    expect(out.dropped.binary).toBe(1);
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

describe('findUnresolvedLocalImports — the agentic missing-files gate (deep-test App #4)', () => {
  // THE exact App #4 (Instagram) failure: App.tsx imported ./hooks (a DIRECTORY module — useAuth) and
  // ./App.module.css, neither ever written → preview stubbed them → useAuth() undefined → runtime crash.
  it('flags a missing directory-import (./hooks) and a missing CSS-module (./App.module.css)', () => {
    const files = {
      'package.json': '{}',
      'src/App.tsx': "import { useAuth } from './hooks';\nimport styles from './App.module.css';\nexport default function App(){ const { isAuthenticated } = useAuth(); return <div className={styles.app}>{String(isAuthenticated)}</div>; }",
      'src/main.tsx': "import App from './App';\nApp;",
    };
    const missing = findUnresolvedLocalImports(files);
    const bases = missing.map((m) => m.missing).sort();
    expect(bases).toContain('src/hooks');
    expect(bases).toContain('src/App.module.css');
    expect(missing.every((m) => m.importedBy === 'src/App.tsx')).toBe(true);
  });

  it('resolves a directory-import when its index file exists (no false positive)', () => {
    const files = {
      'src/App.tsx': "import { useAuth } from './hooks';\nuseAuth;",
      'src/hooks/index.ts': 'export function useAuth(){ return { isAuthenticated: false }; }',
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('resolves a CSS-module when the stylesheet exists (no false positive)', () => {
    const files = {
      'src/App.tsx': "import styles from './App.module.css';\nstyles;",
      'src/App.module.css': '.app { color: red; }',
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  // Kanban build (2026-07-13): src/stores/useBoardStore.ts WAS written, but Dashboard imported it with an
  // over-relative path that escaped src/, so the gate said "missing" and the repair wrote a DUPLICATE.
  it('flags a MISPATH (file exists elsewhere) with existsAt, so the repair fixes the path not duplicates it', () => {
    const files = {
      'src/components/Dashboard.tsx': "import { useBoardStore } from '../../stores/useBoardStore';\nuseBoardStore;", // one ../ too many → escapes src/
      'src/stores/useBoardStore.ts': 'export const useBoardStore = () => ({});',
    };
    const out = findUnresolvedLocalImports(files);
    expect(out).toHaveLength(1);
    expect(out[0].missing).toBe('stores/useBoardStore'); // normalized target that doesn't exist at repo root
    expect(out[0].existsAt).toBe('src/stores/useBoardStore.ts'); // …but the module DOES exist here
  });

  it('does NOT set existsAt for a genuinely-missing file (no same-tail file anywhere → create it)', () => {
    const files = {
      'src/components/ui/Select.tsx': "import s from './Select.module.css';\ns;",
    };
    const out = findUnresolvedLocalImports(files);
    expect(out).toHaveLength(1);
    expect(out[0].missing).toBe('src/components/ui/Select.module.css');
    expect(out[0].existsAt).toBeUndefined(); // truly missing — the repair must CREATE it
  });

  it('does NOT suggest existsAt when the tail is AMBIGUOUS (two files match → never a guess)', () => {
    const files = {
      'src/pages/Dashboard.tsx': "import x from '../../widgets/Chart';\nx;", // escapes to widgets/Chart
      'src/a/widgets/Chart.tsx': 'export default 1;',
      'src/b/widgets/Chart.tsx': 'export default 1;', // two files share the /widgets/Chart tail
    };
    const out = findUnresolvedLocalImports(files);
    expect(out).toHaveLength(1);
    expect(out[0].existsAt).toBeUndefined(); // ambiguous → no suggestion, falls back to "create"
  });
});

describe('fixMispathLocalImports — deterministic wrong-import-path repair (deep-test build #1, expense tracker)', () => {
  // THE build #1 case: App.tsx imported the types module by a WRONG relative path while src/types/index.ts
  // existed — the fast lane detected it but only told the (throttled) LLM to fix it, so a 1-char path error
  // escalated to a 10-min rebuild cascade. The engine must fix a wrong path to an EXISTING file itself.
  it('rewrites a wrong path to the correct relative specifier when the module exists (barrel/index)', () => {
    const files = {
      'src/App.tsx': "import { Expense } from '../types';\nExpense;", // wrong: one ../ too many → escapes src/
      'src/types/index.ts': 'export interface Expense { id: string }',
    };
    const { files: out, fixes } = fixMispathLocalImports(files);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].importedBy).toBe('src/App.tsx');
    expect(fixes[0].to).toBe('./types');
    expect(out['src/App.tsx']).toContain("from './types'");
    // and the fix genuinely resolves now (src/types/index.ts via the barrel)
    expect(findUnresolvedLocalImports(out)).toEqual([]);
  });

  it('fixes an over-relative path that escaped src/ (the Kanban mispath) to the correct one', () => {
    const files = {
      'src/components/Dashboard.tsx': "import { useBoardStore } from '../../stores/useBoardStore';\nuseBoardStore;",
      'src/stores/useBoardStore.ts': 'export const useBoardStore = () => ({});',
    };
    const { files: out, fixes } = fixMispathLocalImports(files);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].to).toBe('../stores/useBoardStore');
    expect(findUnresolvedLocalImports(out)).toEqual([]);
  });

  it('leaves a genuinely-missing import UNTOUCHED (no existsAt → the repair must create it)', () => {
    const files = { 'src/ui/Select.tsx': "import s from './Select.module.css';\ns;" };
    const { files: out, fixes } = fixMispathLocalImports(files);
    expect(fixes).toEqual([]);
    expect(out['src/ui/Select.tsx']).toBe(files['src/ui/Select.tsx']); // unchanged
  });

  it('never touches an AMBIGUOUS tail (two candidates) or a bare package import', () => {
    const files = {
      'src/pages/Dashboard.tsx': "import x from '../../widgets/Chart';\nimport React from 'react';\nx;React;",
      'src/a/widgets/Chart.tsx': 'export default 1;',
      'src/b/widgets/Chart.tsx': 'export default 1;',
    };
    const { fixes } = fixMispathLocalImports(files);
    expect(fixes).toEqual([]); // ambiguous → no guess; 'react' is a package → ignored
  });

  it('leaves an already-correct import unchanged (idempotent)', () => {
    const files = {
      'src/App.tsx': "import { Expense } from './types';\nExpense;",
      'src/types/index.ts': 'export interface Expense { id: string }',
    };
    const { fixes } = fixMispathLocalImports(files);
    expect(fixes).toEqual([]);
  });
});

describe('shouldRetryImportAnonymously (deep-test App #5 — public repo, token-authed clone failed)', () => {
  // THE App #5 case: a token-authenticated clone of a PUBLIC repo brought in 0 files (the token's scope
  // didn't cover it), so retry anonymously.
  it('retries when an authed clone added nothing and a token was used', () => {
    expect(shouldRetryImportAnonymously({ hydrated: false, addedFileCount: 0, hadToken: true, urlsDiffer: true })).toBe(true);
  });

  it('does NOT retry when the authed clone already landed files', () => {
    expect(shouldRetryImportAnonymously({ hydrated: true, addedFileCount: 0, hadToken: true, urlsDiffer: true })).toBe(false);
    expect(shouldRetryImportAnonymously({ hydrated: false, addedFileCount: 12, hadToken: true, urlsDiffer: true })).toBe(false);
  });

  it('does NOT retry when there was no token (anonymous was already the first attempt)', () => {
    expect(shouldRetryImportAnonymously({ hydrated: false, addedFileCount: 0, hadToken: false, urlsDiffer: false })).toBe(false);
  });

  it('does NOT retry when the anonymous URL is identical to the authed one (nothing to change)', () => {
    expect(shouldRetryImportAnonymously({ hydrated: false, addedFileCount: 0, hadToken: true, urlsDiffer: false })).toBe(false);
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

describe('findUnresolvedLocalImports — an incomplete repo snapshot is named AT IMPORT TIME', () => {
  const app = (imports: string) => `import React from 'react';\n${imports}\nexport default function App(){return null}`;

  it('the exact reported case: App.tsx imports five src/pages/* files the repo never contained', async () => {
    const { findUnresolvedLocalImports } = await import('./ProjectImport');
    const files = {
      'src/App.tsx': app([
        `import Patients from './pages/Patients';`,
        `import OPD from './pages/OPD';`,
        `import Queue from './pages/Queue';`,
        `import Medicines from './pages/Medicines';`,
        `import Reports from './pages/Reports';`,
      ].join('\n')),
      'src/main.tsx': `import App from './App';`,
      'package.json': '{}',
    };
    const missing = findUnresolvedLocalImports(files);
    expect(missing.map((m) => m.missing).sort()).toEqual([
      'src/pages/Medicines', 'src/pages/OPD', 'src/pages/Patients', 'src/pages/Queue', 'src/pages/Reports',
    ]);
    expect(missing[0].importedBy).toBe('src/App.tsx');
  });

  it('resolves extension + index variants and the @/ alias — a COMPLETE repo reports nothing', async () => {
    const { findUnresolvedLocalImports } = await import('./ProjectImport');
    const files = {
      'src/App.tsx': app(`import P from './pages/Patients';\nimport U from '@/utils/helpers';\nimport Q from './pages/Queue';`),
      'src/pages/Patients.tsx': 'export default 1;',
      'src/pages/Queue/index.tsx': 'export default 1;',
      'src/utils/helpers.ts': 'export const x = 1;',
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('ignores bare npm packages, builtins, and non-source files (dependency territory, not missing files)', async () => {
    const { findUnresolvedLocalImports } = await import('./ProjectImport');
    const files = {
      'src/App.tsx': app(`import clsx from 'clsx';\nimport fs from 'node:fs';`),
      'README.md': `import broken from './nowhere';`, // not a source file — never scanned
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('is bounded at 20 named misses (a truncated story is still an honest one)', async () => {
    const { findUnresolvedLocalImports } = await import('./ProjectImport');
    const imports = Array.from({ length: 30 }, (_, i) => `import X${i} from './gone/M${i}';`).join('\n');
    const files = { 'src/App.tsx': app(imports) };
    expect(findUnresolvedLocalImports(files)).toHaveLength(20);
  });
});

describe('zip-bomb DoS guard (SECURITY) — a hostile archive is refused before it OOMs the process', () => {
  it('zipEntryDeclaredBytes reads the declared uncompressed size defensively (0 when unavailable)', () => {
    expect(zipEntryDeclaredBytes({ _data: { uncompressedSize: 12345 } })).toBe(12345);
    expect(zipEntryDeclaredBytes({ _data: {} })).toBe(0);
    expect(zipEntryDeclaredBytes({})).toBe(0);
    expect(zipEntryDeclaredBytes(null)).toBe(0);
    expect(zipEntryDeclaredBytes({ _data: { uncompressedSize: -5 } })).toBe(0);
  });
  it('drops a single over-inflating entry WITHOUT decompressing the whole thing (declared-size pre-check)', async () => {
    const zip = new JSZip();
    zip.file('package.json', '{"name":"ok"}');
    // 4 MB of a repeated byte — compresses to a few KB, but DECLARES > the 3 MB lockfile ceiling, so
    // the guard skips it before expanding it into memory (a hostile inflate-in-one-entry payload).
    zip.file('bomb.txt', 'A'.repeat(4 * 1024 * 1024));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const out = await extractZipProject(buf);
    expect(out.files['bomb.txt']).toBeUndefined();     // the over-inflating entry never lands
    expect(out.dropped.tooLarge).toBeGreaterThanOrEqual(1);
    expect(out.files['package.json']).toBe('{"name":"ok"}'); // the real file still imports
  });
  it('still imports a normal small project unchanged (guard never touches a legit zip)', async () => {
    const zip = new JSZip();
    zip.file('package.json', '{"name":"ok"}');
    zip.file('src/App.tsx', 'export default () => null;');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const out = await extractZipProject(buf);
    expect(Object.keys(out.files).sort()).toEqual(['package.json', 'src/App.tsx']);
  });
});

// The reported Frankenstein workspace (buildId a4be5a05): a SvelteKit source tree on a React package.json.
const REACT_PKG = JSON.stringify({
  name: 'project',
  scripts: { dev: 'vite', build: 'tsc && vite build' },
  dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
  devDependencies: { '@vitejs/plugin-react': '^4.3.1', typescript: '^5.5.3', vite: '^5.4.1' },
});
const FRANKENSTEIN = {
  'package.json': REACT_PKG,
  'src/routes/+layout.svelte': '<slot />',
  'src/routes/+page.svelte': '<h1>Home</h1>',
  'src/routes/+layout.server.ts': "import type { LayoutServerLoad } from './$types';\nexport const load: LayoutServerLoad = () => ({});",
  'src/lib/stores/theme.ts': "import { writable } from 'svelte/store';\nexport const theme = writable('light');",
};

describe('detectFrameworkFromSourceExtensions', () => {
  it('classifies a .svelte + $lib/+page tree as sveltekit', () => {
    expect(detectFrameworkFromSourceExtensions(FRANKENSTEIN)).toBe('sveltekit');
  });
  it('plain .svelte (no SvelteKit markers) is svelte', () => {
    expect(detectFrameworkFromSourceExtensions({ 'src/App.svelte': '<h1>hi</h1>' })).toBe('svelte');
  });
  it('.vue files are vue', () => {
    expect(detectFrameworkFromSourceExtensions({ 'src/App.vue': '<template><div/></template>' })).toBe('vue');
  });
  it('a plain React .tsx tree is NOT claimed (returns null — react is the default)', () => {
    expect(detectFrameworkFromSourceExtensions({ 'src/App.tsx': "export default () => <div/>;" })).toBeNull();
  });
});

describe('frameworkFamily', () => {
  it('collapses react-family ids together', () => {
    expect(frameworkFamily('nextjs')).toBe('react');
    expect(frameworkFamily('vite-react')).toBe('react');
    expect(frameworkFamily('sveltekit')).toBe('svelte');
    expect(frameworkFamily('nuxt')).toBe('vue');
  });
});

describe('checkFrameworkCoherence', () => {
  it('flags the Frankenstein workspace (svelte source, react package.json that cannot build it)', () => {
    const c = checkFrameworkCoherence(FRANKENSTEIN);
    expect(c.ok).toBe(false);
    expect(c.sourceFramework).toBe('sveltekit');
    expect(c.packageFramework).toBe('vite-react');
    expect(c.evidence.join(' ')).toMatch(/\.svelte/);
  });

  it('a LEGITIMATE SvelteKit app (svelte source + svelte deps) is coherent — never false-fires', () => {
    const legit = {
      'package.json': JSON.stringify({ name: 'app', devDependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^4.0.0', vite: '^5.0.0' } }),
      'src/routes/+page.svelte': '<h1>ok</h1>',
      'src/lib/x.ts': "export const x = 1;",
    };
    expect(checkFrameworkCoherence(legit).ok).toBe(true);
  });

  it('a plain React app is coherent', () => {
    expect(checkFrameworkCoherence({ 'package.json': REACT_PKG, 'src/App.tsx': 'export default () => <div/>;' }).ok).toBe(true);
  });

  it('a Vue source tree on a React package.json is flagged', () => {
    const c = checkFrameworkCoherence({ 'package.json': REACT_PKG, 'src/App.vue': '<template><div/></template>' });
    expect(c.ok).toBe(false);
    expect(c.sourceFramework).toBe('vue');
  });

  it('no package.json → coherent (nothing to contradict)', () => {
    expect(checkFrameworkCoherence({ 'src/App.svelte': '<h1/>' }).ok).toBe(true);
  });
});

describe('frameworkCoherenceGuidance', () => {
  it('produces an actionable non-mutating warning for a mismatch, empty for a coherent workspace', () => {
    const g = frameworkCoherenceGuidance(checkFrameworkCoherence(FRANKENSTEIN));
    expect(g).toContain('WORKSPACE FRAMEWORK MISMATCH');
    expect(g).toContain('sveltekit');
    expect(g).toContain('ONE framework');
    expect(g).toMatch(/do NOT mass-rewrite/i);
    expect(frameworkCoherenceGuidance(checkFrameworkCoherence({ 'package.json': REACT_PKG, 'src/App.tsx': 'export default () => <div/>;' }))).toBe('');
  });
});

// ROOT CAUSE (admin 2026-08-03, mitrify GitHub import): the repo listing said "316 files", the build
// said "166 source files", and NOTHING in the build report explained the gap — so the only reading
// available was "10% bhi import nahi ho paya". These lock the durable accounting that answers it.
describe('importAccountingLine — every archive entry is accounted for, in the report', () => {
  it('states the total, what was KEPT, and what was NOT imported with a reason for each', () => {
    const line = importAccountingLine(extracted({
      files: Object.fromEntries(Array.from({ length: 165 }, (_, i) => [`src/f${i}.ts`, 'x'])),
      assets: { 'logo.png': 'data:image/png;base64,AA' },
      dropped: { binary: 138, junk: 6, secret: 2, dir: 4 },
      totalEntries: 316,
    }));
    expect(line).toContain('316 archive entries');
    expect(line).toContain('165 source files');
    expect(line).toContain('1 image/font asset');
    // every drop reason is named, with its count
    expect(line).toContain('138 large binaries');
    expect(line).toContain('6 OS/editor junk');
    expect(line).toContain('2 secret files');
    expect(line).toContain('4 dependency/build files');
    expect(line).toContain('NOT imported 150'); // 138+6+2+4 — the numbers ADD UP
  });

  it('says plainly when nothing was dropped (never a silent "maybe something is missing")', () => {
    const line = importAccountingLine(extracted({ files: { 'a.ts': 'x' }, totalEntries: 1 }));
    expect(line).toContain('nothing was dropped');
    expect(line).not.toContain('NOT imported');
  });

  it('names the monorepo app root when the import was re-rooted', () => {
    const line = importAccountingLine(extracted({ files: { 'a.ts': 'x' }, totalEntries: 2, appRoot: 'apps/web' }));
    expect(line).toContain('apps/web');
  });

  it('mentions sandbox-only lockfiles as KEPT, not lost', () => {
    const line = importAccountingLine(extracted({
      files: { 'a.ts': 'x' }, sandboxOnly: { 'package-lock.json': '{}' }, totalEntries: 2,
    }));
    expect(line).toContain('1 lockfile');
    expect(line).toContain('sandbox only');
  });

  it('explains that source-file count is what matters (the exact confusion in the report)', () => {
    const line = importAccountingLine(extracted({ files: { 'a.ts': 'x' }, dropped: { binary: 9 }, totalEntries: 10 }));
    expect(line).toMatch(/npm install/);
    expect(line).toMatch(/what the AI reads and edits/i);
  });

  it('singularises correctly for a one-entry archive', () => {
    const line = importAccountingLine(extracted({ files: { 'a.ts': 'x' }, totalEntries: 1 }));
    expect(line).toContain('1 archive entry');
    expect(line).toContain('1 source file');
  });
});

// ROOT CAUSE (self-import autopsy 2026-08-03): importing NavBharatAI itself warned "This import looks
// INCOMPLETE — 20 file(s) its code references are missing", naming src/server/AgentV3/Missing,
// .../b, src/lib/App, src/components/ide/component … NONE were real. They were analyzer TEST FIXTURES,
// generated-code TEMPLATE LITERALS and a path quoted in a COMMENT. Worse, the warning offers "say
// 'create the missing files' and I'll build them" — acting on that would have written garbage files
// (Missing.ts, b.ts, App.ts) into a perfectly healthy repo. These lock the fix.
describe('maskNonCodeRegions — only REAL code is scanned for imports', () => {
  it('blanks line + block comments but preserves length and newlines', () => {
    const src = "import a from './a';\n// import x from './Nope';\nconst b = 1;";
    const masked = maskNonCodeRegions(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(3);
    expect(masked).toContain("import a from './a';");
    expect(masked).not.toContain('./Nope');
  });

  it('blanks template literals (generated-code samples)', () => {
    const src = "const sample = `import Component from './component';`;";
    expect(maskNonCodeRegions(src)).not.toContain('./component');
  });

  it('does NOT desynchronise on a template that CONTAINS comments (the scaffold-generator case)', () => {
    // A code generator's template holds generated code WITH its own /* */ and // comments. A chained
    // comment-then-template regex ate across the template's boundary, exposing its body as real code.
    const src = [
      'const TPL = `',
      '/* generated header */',
      '// keep this',
      "import App from './App';",
      '`;',
      "import real from './real';",
    ].join('\n');
    const masked = maskNonCodeRegions(src);
    expect(masked).not.toContain('./App');      // template body stayed masked
    expect(masked).toContain("import real from './real';"); // real code after it survived
  });

  it('does NOT desynchronise on an ESCAPED backtick inside a template (markdown fence case)', () => {
    const src = [
      'const DOC = `',
      '\\`\\`\\`ts',
      "import { r } from './server/x/routes';",
      '\\`\\`\\`',
      '`;',
      "import real from './real';",
    ].join('\n');
    const masked = maskNonCodeRegions(src);
    expect(masked).not.toContain('./server/x/routes');
    expect(masked).toContain("import real from './real';");
  });

  it('a backtick inside an ordinary string does not open a phantom template', () => {
    const src = "const tick = '`';\nimport real from './real';";
    expect(maskNonCodeRegions(src)).toContain("import real from './real';");
  });

  it('keeps ordinary string text (a real import specifier lives in one)', () => {
    expect(maskNonCodeRegions("import x from './x';")).toContain("'./x'");
  });
});

describe('findUnresolvedLocalImports — no phantom "missing files" from fixtures/templates/comments', () => {
  const app = { 'src/App.tsx': "import React from 'react';\nexport default function App(){return null;}" };

  it('ignores an import quoted INSIDE a test fixture string (the exact repo case)', () => {
    // Verbatim shape from ArchitectureAnalysis.test.ts.
    const files = {
      ...app,
      'src/analyze.test.ts': `const g = graphOf({ 'src/App.tsx': "import { X } from './Missing';\\nexport function App(){}" });`,
    };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('ignores an import inside a generated-code TEMPLATE literal', () => {
    const files = { ...app, 'src/gen.tsx': "const code = `import { Btn } from './button';`;" };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('ignores an import mentioned in a COMMENT', () => {
    const files = { ...app, 'src/lib/firebase.ts': "// App.tsx re-exports so `import { auth } from './App'` keeps working.\nexport const x = 1;" };
    expect(findUnresolvedLocalImports(files)).toEqual([]);
  });

  it('STILL reports a genuinely missing import (the real signal is not weakened)', () => {
    const files = { 'src/App.tsx': "import Header from './components/Header';\nexport default function App(){return null;}" };
    const out = findUnresolvedLocalImports(files);
    expect(out).toHaveLength(1);
    expect(out[0].missing).toBe('src/components/Header');
    expect(out[0].importedBy).toBe('src/App.tsx');
  });

  it('still reports a missing import that follows a masked region in the same file', () => {
    const files = {
      'src/App.tsx': "const t = `import Fake from './Fake';`;\nimport Real from './Real';\nexport default function App(){return null;}",
    };
    const out = findUnresolvedLocalImports(files);
    expect(out.map((o) => o.missing)).toEqual(['src/Real']); // the fake one is gone, the real one remains
  });
});

// ADMIN 2026-08-03 ("88 large images not imported — will the app break?"): large IMAGES used to be
// dropped, leaving imported apps with broken pictures. Two tiers now: small images persist durably;
// larger images (too big for the Firestore-backed store) are materialized in the SANDBOX for the
// preview but not persisted. Videos/other binaries are still dropped. Nothing crashes either way.
describe('extractZipProject — large images go to the sandbox tier, not dropped', () => {
  const img = (kb: number) => Buffer.alloc(kb * 1024, 0x41); // fake JPEG bytes, arbitrary size

  it('keeps a SMALL image durably (assets) and a MID image sandbox-only', async () => {
    const buf = await makeZipBinary({
      'package.json': '{"name":"x"}',
      'client/small.png': img(100),   // <= 640KB → durable asset
      'client/big.jpg': img(1200),    // > 640KB, <= 5MB → sandbox-only
    });
    const ex = await extractZipProject(buf);
    expect(Object.keys(ex.assets)).toContain('client/small.png');
    expect(Object.keys(ex.sandboxAssets)).toContain('client/big.jpg');
    expect(Object.keys(ex.assets)).not.toContain('client/big.jpg'); // not persisted durably
    expect(ex.dropped.binary).toBe(0);                              // nothing dropped
  });

  it('drops an image bigger than the sandbox cap (5MB) — memory bound holds', async () => {
    const buf = await makeZipBinary({ 'package.json': '{"name":"x"}', 'huge.png': img(6 * 1024) });
    const ex = await extractZipProject(buf);
    expect(Object.keys(ex.assets)).not.toContain('huge.png');
    expect(Object.keys(ex.sandboxAssets)).not.toContain('huge.png');
    expect(ex.dropped.binary).toBe(1);
  });

  it('still drops a NON-image binary (video) regardless of size', async () => {
    const buf = await makeZipBinary({ 'package.json': '{"name":"x"}', 'demo.mp4': img(300) });
    const ex = await extractZipProject(buf);
    expect(Object.keys(ex.sandboxAssets)).not.toContain('demo.mp4');
    expect(Object.keys(ex.assets)).not.toContain('demo.mp4');
    expect(ex.dropped.binary).toBe(1);
  });

  it('accounting reports sandbox-only large images as KEPT (preview only), not lost', () => {
    const line = importAccountingLine(extracted({
      files: { 'a.ts': 'x' },
      assets: { 'logo.png': 'data:image/png;base64,AA' },
      sandboxAssets: { 'hero.jpg': 'data:image/jpeg;base64,AA', 'banner.png': 'data:image/png;base64,AA' },
      totalEntries: 4,
    }));
    expect(line).toContain('2 large images (preview only)');
    expect(line).toContain('1 image/font asset');
    expect(line).toContain('nothing was dropped');
  });
});
