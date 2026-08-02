import { describe, it, expect } from 'vitest';
import { buildReactPreview, isReactProject } from '../src/server/runtime/ReactPreview';
import { renderPreview } from '../src/server/runtime/renderPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { scaffold } from '../src/server/project/Scaffold';

function reactVfs() {
  const vfs = VirtualFileSystem.fromRecord({});
  scaffold(vfs, 'vite-react');
  return vfs;
}

describe('isReactProject', () => {
  it('detects a react dependency in package.json', () => {
    expect(isReactProject(reactVfs())).toBe(true);
  });
  it('is false for a plain static project', () => {
    expect(isReactProject(VirtualFileSystem.fromRecord({ 'index.html': '<h1>x</h1>' }))).toBe(false);
  });
  it('detects jsx/tsx sources without package.json', () => {
    expect(isReactProject(VirtualFileSystem.fromRecord({ 'app.jsx': 'export default ()=>null' }))).toBe(true);
  });
});

describe('buildReactPreview', () => {
  it('produces a self-contained HTML doc that bundles the scaffold in-browser', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('<div id="root">');
    expect(html).toContain('@babel/standalone');     // transpiler present
    expect(html).toContain('react@18');               // react CDN present
    expect(html).toContain('transform-modules-commonjs');
    // entry + module sources embedded for the in-browser loader
    expect(html).toContain('src/main.jsx');
    expect(html).toContain('src/App.jsx');
  });

  it('loads the self-hosted compiler via an ABSOLUTE same-origin URL when an origin is given', () => {
    // Inside a sandboxed <iframe srcDoc> a root-relative "/vendor/babel.min.js" does not resolve to
    // the app origin → "Could not load the preview compiler". An absolute URL fixes it.
    const rel = buildReactPreview(reactVfs());
    expect(rel).toContain('src="/vendor/babel.min.js"'); // no origin → relative (back-compat)
    const abs = buildReactPreview(reactVfs(), 'https://navbharatai.com');
    expect(abs).toContain('src="https://navbharatai.com/vendor/babel.min.js"');
    // a trailing slash on the origin is normalised (no double slash)
    expect(buildReactPreview(reactVfs(), 'https://navbharatai.com/')).toContain('src="https://navbharatai.com/vendor/babel.min.js"');
  });

  it('embeds the entry from index.html script src', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('"entry":"src/main.jsx"');
  });

  it('wires arbitrary npm deps via an esm.sh importmap (complex apps)', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-router-dom': '^6.26.0', zustand: '^4.5.0' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "import { create } from 'zustand';\nimport { BrowserRouter } from 'react-router-dom';\n",
    });
    const html = buildReactPreview(vfs);
    expect(html).toContain('<script type="importmap">');
    // Non-react deps externalize ONLY react/react-dom (?external=…) so every package shares the
    // ONE React from the importmap (no "Invalid hook call" second copy) while esm.sh BUNDLES
    // their other internals (firebase's @firebase/app etc.) as absolute URLs — the old `*`
    // (external-ALL) flag left those as bare specifiers the browser could not resolve, killing
    // the preview for any app using such packages.
    expect(html).toContain('esm.sh/react-router-dom@6.26.0?external=react,react-dom');
    expect(html).toContain('esm.sh/zustand@4.5.0?external=react,react-dom');
    expect(html).not.toContain('esm.sh/*');
    // React itself stays plain — it IS the shared copy the others externalize to.
    expect(html).toMatch(/esm\.sh\/react@18\.3\.1/);
    expect(html).not.toContain('esm.sh/react@18.3.1?external');
  });

  it('uses the JSX automatic runtime (no React-in-scope requirement)', () => {
    expect(buildReactPreview(reactVfs())).toContain("runtime: 'automatic'");
  });

  it('loads the Tailwind Play CDN when the app uses Tailwind (so the no-build preview is STYLED)', () => {
    const tw = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1' } }),
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': "import './index.css';\nexport default ()=>null",
      'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
    });
    const html = buildReactPreview(tw);
    expect(html).toContain('https://cdn.tailwindcss.com');
    expect(html).toContain('type="text/tailwindcss"'); // so @tailwind/@apply get processed
    // A non-Tailwind app does NOT pull the CDN.
    const plain = buildReactPreview(VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      'src/main.jsx': 'export default ()=>null',
      'src/index.css': 'body{margin:0}',
    }));
    expect(plain).not.toContain('cdn.tailwindcss.com');
  });

  it('falls back to a clear notice when no entry module exists', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord({ 'foo.txt': 'x' }));
    expect(html).toContain('No React entry module found');
  });

  it('resiliently finds the entry by basename when the exact index.html path does not resolve', () => {
    // index.html points at /src/main.tsx but the file lives at a different path (e.g. the file map
    // reached the preview keyed under an unexpected prefix). It must STILL render, not fail with
    // "No React entry module found".
    const vfs = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      'source/main.tsx': 'export default function Main(){ return null }',
    });
    const html = buildReactPreview(vfs);
    expect(html).not.toContain('No React entry module found');
    expect(html).toContain('source/main.tsx');
  });

  it('finds a main/index entry anywhere as a last resort (prefers main.*, ignores test files)', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'app/index.tsx': 'export default ()=>null',
      'app/src/main.tsx': 'export default ()=>null',
      'app/src/components/Widget.test.tsx': 'test',   // test file — must NOT be chosen as entry
    });
    const html = buildReactPreview(vfs);
    expect(html).not.toContain('No React entry module found');
    expect(html).toContain('"entry":"app/src/main.tsx"'); // main.* is the conventional Vite entry → preferred
  });

  it('emits PRECISE module errors + is RESILIENT to a missing local file (stub, not a blank crash)', () => {
    const html = buildReactPreview(reactVfs());
    // A missing LOCAL file no longer crashes the whole preview — it is stubbed and a banner names it.
    expect(html).toContain('missingLocal');
    expect(html).toContain('stubbed so the preview still renders');
    expect(html).toContain('imported by');
    // A missing bare dep still names the package + importer (a hard error — can't stub React).
    expect(html).toContain('Missing dependency');
    // The error display surfaces the MESSAGE (iOS Safari's stack is frames-only) — message-first handling.
    expect(html).toContain('err.message');
    // Preview failures/notes are postMessage'd up to the host so they're captured into the build report.
    expect(html).toContain('__nbaiPreviewError');
  });
});

describe('buildReactPreview — Visual Editor (v1) wiring', () => {
  it('enables JSX source metadata (development:true) so a clicked element maps back to its real source', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain("development: true");
  });
  it('injects the edit-mode inspector script, toggled by the parent via postMessage', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('__nbaiSetEditMode');
    expect(html).toContain('__nbaiVisualEditCommit');
    expect(html).toContain('_debugSource');
  });
  it('inspector never activates itself — starts with editMode false, only flips on an explicit message', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('var editMode = false;');
  });
});

describe('renderPreview', () => {
  it('routes a react project to the react bundler', () => {
    expect(renderPreview(reactVfs())).toContain('@babel/standalone');
  });
  it('routes a plain static project to the static inliner', () => {
    const html = renderPreview(VirtualFileSystem.fromRecord({ 'index.html': '<h1>plain</h1>' }));
    expect(html).toContain('plain');
    expect(html).not.toContain('@babel/standalone');
  });
});

describe('buildReactPreview — CDN resilience (fallback when esm.sh flakes)', () => {
  it('embeds a fallback ESM CDN + retries a failed import once before surfacing an error', () => {
    const vfs = reactVfs();
    const html = buildReactPreview(vfs, 'https://navbharatai.com');
    // A second ESM CDN is wired in…
    expect(html).toContain('esm.run');
    expect(html).toContain('specUrlAlt');
    // …and the loader actually RETRIES on the alt CDN before recording a load error.
    expect(html).toMatch(/import\(specUrlAlt\(spec\)\)/);
    expect(html).toContain('from fallback CDN after esm.sh failed');
  });
});

// Fix 1 (2026-07-06): the exact Mitrify failure — `@/components/ui/toaster` (a shadcn path alias)
// was sent to esm.sh ("Could not load @/… from the CDN"). It must resolve to the LOCAL file instead.
import { buildAliasMap } from '../src/server/runtime/ReactPreview';

describe('buildAliasMap (path aliases for imported shadcn/Vite/Next/Lovable/Bolt apps)', () => {
  it('reads "@/*" -> "./client/src/*" from tsconfig (the Replit-export monorepo shape)', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./client/src/*'] } } }),
    });
    expect(buildAliasMap(vfs, 'client/src/main.tsx')).toEqual({ '@': '/client/src' });
  });

  it('reads a root-src alias "@/*" -> "./src/*" (Lovable/Bolt shape) and tolerates tsconfig comments', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'tsconfig.json': '{\n  // paths\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}',
    });
    expect(buildAliasMap(vfs, 'src/main.tsx')).toEqual({ '@': '/src' });
  });

  it('falls back to vite.config resolve.alias when tsconfig has none', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'vite.config.ts': "export default { resolve: { alias: { '@': path.resolve(__dirname, './client/src') } } }",
    });
    expect(buildAliasMap(vfs, 'client/src/main.tsx')).toEqual({ '@': '/client/src' });
  });

  it('heuristic: infers @ from the entry src root when the app USES @/ but no config declares it', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'client/src/main.tsx': "import App from '@/App'",
      'client/src/App.tsx': 'export default ()=>null',
    });
    expect(buildAliasMap(vfs, 'client/src/main.tsx')).toEqual({ '@': '/client/src' });
  });

  it('does NOT invent an alias when the app never imports @/ (no false positives)', () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/main.tsx': "import App from './App'" });
    expect(buildAliasMap(vfs, 'src/main.tsx')).toEqual({});
  });
});

describe('buildReactPreview — @/ alias resolves locally, not via the CDN (Fix 1 regression)', () => {
  it('embeds the ALIASES map and applyAlias so @/… is rewritten to the local src path', () => {
    const vfs = VirtualFileSystem.fromRecord({
      'index.html': '<div id="root"></div><script type="module" src="/client/src/main.tsx"></script>',
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./client/src/*'] } } }),
      'client/src/main.tsx': "import { Toaster } from '@/components/ui/toaster'; export default Toaster;",
      'client/src/components/ui/toaster.tsx': 'export function Toaster(){ return null; }',
    });
    const html = buildReactPreview(vfs);
    // The alias map is injected…
    expect(html).toContain('"@":"/client/src"');
    expect(html).toContain('function applyAlias');
    // …and the toaster source is bundled as a LOCAL module (so it never hits esm.sh).
    expect(html).toContain('client/src/components/ui/toaster.tsx');
  });
});

// Fix 33 (CoreUI report 2026-07-07) — the in-browser loader must handle a REAL Vite app's imports:
// root-local specs ('src/…'), npm CSS subpaths, node: builtins, and local image imports. These assert
// the loader machinery is present in the generated HTML (the loader itself runs in the browser).
describe('buildReactPreview — imported-app loader resilience (Fix 33)', () => {
  it('ships the root-local specifier machinery (src/… is LOCAL, never a CDN package)', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('ROOT_SEGS');
    expect(html).toContain('isLocalRootSpec');
  });
  it('ships the bare-CSS-as-<link> handling (npm package stylesheets are not ES modules)', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain("link.rel = 'stylesheet'");
  });
  it('ships the node: builtin stub + skips node: in bare collection', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('node builtin stubbed');
    expect(html).toContain("indexOf('node:') !== 0");
  });
  it('ships the local-image placeholder (an image import is a URL string, Vite semantics)', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('IMG_PLACEHOLDER');
    expect(html).toContain('data:image/gif;base64');
  });
  it('ships the Ashok Chakra boot overlay + the 45s stuck watchdog (bumped from 25s for large apps 2026-07-31)', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('__nbai_boot');
    expect(html).toContain('__nbai_spin');
    expect(html).toContain('did not start within 45 seconds');
  });
});

// Fix 34b (Conduit report 2026-07-07): legacy-interop fallback — a third bare-import rung WITHOUT
// react-externalization, and honest recording of every rung's failure.
describe('buildReactPreview — legacy react interop fallback (Fix 34b)', () => {
  it('ships the no-external last rung + multi-rung error recording', () => {
    const html = buildReactPreview(reactVfs());
    expect(html).toContain('WITHOUT react-externalization (legacy interop fallback)');
    expect(html).toContain('on all 3 rungs');
  });
});
