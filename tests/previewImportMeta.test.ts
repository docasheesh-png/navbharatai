import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IMPORT_META_IDENT, IMPORT_META_ENV_SOURCE, importMetaObjectSource, importMetaPlugin,
  viteEnvVarsUsed, usesImportMetaGlob,
} from '../src/server/runtime/previewImportMeta';
import { precompileModules } from '../src/server/runtime/PreviewPrecompile';
import { proveBrowserRunnable } from '../src/server/AgentV3/previewCapability';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

/**
 * PHASE 1b — the bug that was hiding behind "imported apps don't preview well".
 *
 * REPRODUCED, not theorised. The preview compiles each module with Babel and runs it with
 * `new Function('require','module','exports', code)`. Babel's commonjs transform does not touch
 * `import.meta`, so it survives verbatim into a Function body — where it is a SYNTAX ERROR:
 *
 *     new Function('const u = import.meta.env.VITE_API_URL;')
 *     → SyntaxError: Cannot use 'import.meta' outside a module
 *
 * That is not one bad value in one component. It kills the module, and with it the whole preview. And
 * `import.meta.env` is how every Vite project reads its configuration — so this single line is a large
 * share of why an IMPORTED app showed nothing, while GENERATED apps rarely tripped it because the
 * scaffold does not use it. Exactly the people the admin asked us to look after.
 */

const run = (code: string): { exports: Record<string, unknown> } => {
  const mod = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', code)(() => ({}), mod, mod.exports);
  return mod;
};

describe('the SyntaxError, and that it is gone', () => {
  it('the raw shape really does throw — the bug this fixes is real', () => {
    expect(() => new Function('const u = import.meta.env.VITE_API_URL;')).toThrow(SyntaxError);
  });

  it('a precompiled module no longer contains import.meta at all', () => {
    const out = precompileModules({ 'src/x.ts': 'const u = import.meta.env.VITE_API_URL; export default u;' });
    expect(out).not.toBeNull();
    expect(out!['src/x.ts']).not.toContain('import.meta');
  });

  it('…and it EXECUTES in the same wrapper the loader uses', () => {
    // The real proof. Compiling without `import.meta` in the text is not the same as running.
    const out = precompileModules({ 'src/x.ts': 'const u = import.meta.env.VITE_API_URL; export default u;' })!;
    expect(() => run(out['src/x.ts'])).not.toThrow();
  });
});

describe('the values are Vite\'s real ones, and the gaps are honest', () => {
  it('an undefined VITE_ var reads undefined — which is what Vite itself gives', () => {
    /**
     * NOT a fake. Live .env files are excluded at the import boundary on purpose (SECRET_FILE_RE — we
     * never import somebody's secrets), so there is nothing honest to put here. The app behaves as it
     * would under Vite with an empty env, instead of dying.
     */
    const out = precompileModules({ 'src/x.ts': 'export default import.meta.env.VITE_API_URL;' })!;
    expect(run(out['src/x.ts']).exports.default).toBeUndefined();
  });

  it('MODE / DEV / PROD / BASE_URL are the real dev-mode values', () => {
    const out = precompileModules({
      'src/x.ts': 'export default [import.meta.env.MODE, import.meta.env.DEV, import.meta.env.PROD, import.meta.env.BASE_URL];',
    })!;
    expect(run(out['src/x.ts']).exports.default).toEqual(['development', true, false, '/']);
  });

  it('import.meta.url names the module\'s OWN file', () => {
    // Declared per module rather than once globally, so two modules do not claim the same url.
    const out = precompileModules({ 'src/a/b.ts': 'export default import.meta.url;', 'src/c.ts': 'export default import.meta.url;' })!;
    expect(run(out['src/a/b.ts']).exports.default).toBe('file:///src/a/b.ts');
    expect(run(out['src/c.ts']).exports.default).toBe('file:///src/c.ts');
  });

  it('import.meta.hot is undefined, so an HMR guard takes the FALSE branch', () => {
    // There is no HMR in a static render. Handing back a truthy object would have the app register
    // callbacks that never fire — working-looking and wrong.
    const out = precompileModules({ 'src/x.ts': 'export default import.meta.hot ? "hmr" : "static";' })!;
    expect(run(out['src/x.ts']).exports.default).toBe('static');
  });

  it('a string that merely CONTAINS "import.meta" is untouched', () => {
    // Why this is an AST plugin and not a text replacement: a regex cannot tell code from a literal,
    // and corrupting one library string would be a blank preview with no obvious cause.
    const out = precompileModules({ 'src/x.ts': 'export default "see import.meta.env docs";' })!;
    expect(run(out['src/x.ts']).exports.default).toBe('see import.meta.env docs');
  });
});

describe('the two paths cannot drift', () => {
  const react = readFileSync(join(process.cwd(), 'src/server/runtime/ReactPreview.ts'), 'utf8');

  it('the browser loader interpolates the SAME env constant, never its own copy', () => {
    /**
     * The browser fallback builds a script as a template string and cannot import a module, so it
     * carries a hand-written twin of the plugin — the same situation `srcStampPlugin` is already in.
     * What stops the two disagreeing about what an app SEES is that the values come from one exported
     * constant, interpolated into both.
     */
    expect(react).toContain('IMPORT_META_ENV_SOURCE');
    expect(react).toContain('env: ${IMPORT_META_ENV_SOURCE}');
    expect(IMPORT_META_ENV_SOURCE).toContain('MODE:"development"');
  });

  it('both paths use the same substituted identifier', () => {
    expect(react).toContain('IMPORT_META_IDENT');
    expect(importMetaObjectSource('src/x.ts')).toContain(IMPORT_META_ENV_SOURCE);
    expect(IMPORT_META_IDENT).toBe('__nbaiImportMeta');
  });

  it('the browser plugin visits the same node type as the server one', () => {
    expect(react).toMatch(/MetaProperty: function \(p\) \{ p\.replaceWithSourceString\(/);
    expect(Object.keys(importMetaPlugin().visitor)).toEqual(['MetaProperty']);
  });

  it('the browser twin PRODUCES the same object the server path does', () => {
    /**
     * Stronger than reading the source for a matching constant: this pulls the real function out of a
     * real generated page, runs it, and compares it to the server's literal.
     *
     * It exists because the first version of that function shipped broken and no assertion about the
     * constants would have caught it — written inside a template literal, `/^\/+/` had its backslash
     * consumed before the browser saw it and became the un-parseable `/^/+/`. Only executing it finds
     * that class of bug.
     */
    const html = buildReactPreview(VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1' } }),
      'index.html': '<div id="root"></div>',
      'src/main.tsx': "export default function A() { return <b>hi</b>; }",
    }));
    const m = html.match(/function nbaiImportMeta\(p\) \{[\s\S]*?\n {2}\}/);
    expect(m, 'the browser twin must be present in the generated page').toBeTruthy();
    const browserFn = new Function(`${m![0]}; return nbaiImportMeta;`)() as (p: string) => unknown;

    for (const path of ['src/a/b.ts', '/src/leading.ts', '///many.ts', 'plain.js']) {
      const fromServer = new Function(`return ${importMetaObjectSource(path)};`)();
      expect(browserFn(path), `paths must agree for ${path}`).toEqual(fromServer);
    }
  });

  it('the browser wrapper binds the identifier as a real argument', () => {
    // A precompiled module carries its own `var` declaration which shadows this; a browser-compiled
    // one depends on it. One wrapper serves both.
    expect(react).toContain("new Function('require', 'module', 'exports', ${JSON.stringify(IMPORT_META_IDENT)}, transformed)");
  });
});

describe('import.meta.glob is refused, not answered with a wrong value', () => {
  it('an app using it is not browser-runnable', () => {
    /**
     * The one part of import.meta a value cannot fix. It is a BUILD-TIME directory expansion; with no
     * `glob` on the object, an app that builds its routes from one renders with NO routes — which
     * looks like it worked. An honest refusal is strictly better.
     */
    const app = {
      'package.json': JSON.stringify({ dependencies: { react: '18' } }),
      'index.html': '<div id=root></div>',
      'src/routes.ts': 'const pages = import.meta.glob("./pages/*.tsx");',
      'src/App.tsx': 'export default () => null;',
    };
    const c = proveBrowserRunnable(app);
    expect(c.blockers).toContain('import-meta-glob');
    expect(c.browserRunnable).toBe(false);
  });

  it('the detector sees the typed form too', () => {
    expect(usesImportMetaGlob({ 'a.ts': 'import.meta.glob<Page>("./x/*")' })).toBe(true);
    expect(usesImportMetaGlob({ 'a.ts': 'import.meta.env.VITE_X' })).toBe(false);
  });
});

describe('naming the settings we do not hold', () => {
  it('collects VITE_, REACT_APP_ and NEXT_PUBLIC_ names the app reads', () => {
    const found = viteEnvVarsUsed({
      'src/a.ts': 'const u = import.meta.env.VITE_API_URL; const k = import.meta.env.VITE_KEY;',
      'src/b.jsx': 'process.env.REACT_APP_TITLE',
      'src/c.tsx': 'process.env.NEXT_PUBLIC_URL',
    });
    expect(found).toEqual(['NEXT_PUBLIC_URL', 'REACT_APP_TITLE', 'VITE_API_URL', 'VITE_KEY']);
  });

  it('deduplicates and sorts, so the message is stable between renders', () => {
    expect(viteEnvVarsUsed({ 'a.ts': 'import.meta.env.VITE_B', 'b.ts': 'import.meta.env.VITE_B import.meta.env.VITE_A' }))
      .toEqual(['VITE_A', 'VITE_B']);
  });

  it('ignores non-source files and non-public variables', () => {
    // NODE_ENV is supplied, not missing — listing it would report a gap that does not exist.
    expect(viteEnvVarsUsed({ 'README.md': 'import.meta.env.VITE_X', 'a.ts': 'process.env.NODE_ENV' })).toEqual([]);
  });

  it('the UI says it out loud, and says WHY it is missing', () => {
    const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');
    expect(surface).toContain('envVarsUsed.length > 0');
    // The reason matters as much as the fact: it is a deliberate privacy decision, not a bug.
    expect(surface).toContain('your .env is never uploaded');
  });
});
