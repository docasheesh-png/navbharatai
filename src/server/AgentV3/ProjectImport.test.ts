import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  isZipAttachment,
  safeImportPath,
  extractZipProject,
  detectImportedFramework,
  validateImportedProject,
  importSummaryLine,
  IMPORT_MAX_FILES,
} from './ProjectImport';

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
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

  it('drops node_modules/build dirs, live secrets, and binaries — with honest counts', async () => {
    const buf = await makeZip({
      'package.json': '{}',
      'node_modules/react/index.js': 'x',
      'dist/bundle.js': 'x',
      '.env': 'API_KEY=supersecret',
      '.env.example': 'API_KEY=',
      'certs/server.pem': 'x',
      'logo.png': 'x',
      'src/main.ts': 'console.log(1)',
    });
    const out = await extractZipProject(buf);
    expect(Object.keys(out.files).sort()).toEqual(['.env.example', 'package.json', 'src/main.ts']);
    expect(out.dropped.dir).toBe(2);
    expect(out.dropped.secret).toBe(2);
    expect(out.dropped.binary).toBe(1);
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

describe('importSummaryLine', () => {
  it('reports counts and skip reasons honestly', () => {
    const line = importSummaryLine(
      { files: { 'a.ts': 'x', 'b.ts': 'y' }, dropped: { dir: 3, secret: 1, binary: 2, tooLarge: 0, unsafe: 0, overCap: 0 }, totalEntries: 8, strippedRoot: 'app-main' },
      'vite-react',
    );
    expect(line).toContain('Imported 2 files');
    expect(line).toContain('vite-react');
    expect(line).toContain('3 from node_modules');
    expect(line).toContain('1 secret file');
    expect(line).toContain('2 binary assets');
  });
});
