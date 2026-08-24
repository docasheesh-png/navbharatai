import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FRAMEWORK_CAPABILITIES, frameworkCapability, apkRefusal, apkCapableFrameworkIds, apkRefusalForProject,
} from '../src/server/lib/frameworkCapability';
import { needsLegacyPeerDeps } from '../src/server/AgentV3/npmInstallFallback';
import { detectWebDir } from '../src/server/lib/mobileProjectAssembler';
import { FRAMEWORK_OPTION_IDS } from '../src/components/agentv3/frameworkOptions';

/**
 * THE 24-FRAMEWORK SWEEP (admin 2026-08-24: "ek ek framework pakad ke 0 to 100 check karo … 2 test:
 * 1. app ban rahi hai ya nahi, 2. capacitor apk ban raha hai ya nahi").
 *
 * Every expectation below was MEASURED — each scaffold was dumped from TemplateRegistry, installed and
 * built for real, and the output folder read off disk. Four could not produce an app at all:
 *
 *   vite-react  BUILD FAIL   @types/react + @types/react-dom absent      -> fixed, builds clean
 *   angular     BUILD FAIL   (click)="count++" is not valid Angular       -> fixed, builds clean
 *   sveltekit   INSTALL FAIL @sveltejs/vite-plugin-svelte absent          -> fixed, installs clean
 *   nuxt        INSTALL FAIL npm resolver crash, fallback never fired     -> fixed, installs clean
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const pkg = (o: unknown) => ({ 'package.json': JSON.stringify(o) });

describe('the capability table covers the picker exactly', () => {
  it('🔒 every framework offered in the picker has a measured verdict', () => {
    // A picker option with no verdict silently falls back to "ready/dist", which for a backend
    // framework would mean cheerfully building an APK that opens to a blank page.
    const known = new Set(FRAMEWORK_CAPABILITIES.map((c) => c.id));
    const missing = FRAMEWORK_OPTION_IDS.filter((id) => !known.has(id));
    expect(missing, `no capability recorded for: ${missing.join(', ')}`).toEqual([]);
  });

  it('and records nothing that is not offered', () => {
    const offered = new Set(FRAMEWORK_OPTION_IDS);
    expect(FRAMEWORK_CAPABILITIES.filter((c) => !offered.has(c.id)).map((c) => c.id)).toEqual([]);
  });

  it('the split is 15 with a UI and 9 without — the honest headline', () => {
    expect(FRAMEWORK_OPTION_IDS.length).toBe(24);
    expect(apkCapableFrameworkIds().length).toBe(15);
    expect(FRAMEWORK_CAPABILITIES.filter((c) => c.apk === 'no-ui').length).toBe(9);
  });

  it('🔒 every APK-capable framework names a real output folder; every no-ui one names none', () => {
    for (const c of FRAMEWORK_CAPABILITIES) {
      if (c.apk === 'no-ui') expect(c.webDir, c.id).toBe('');
      else expect(c.webDir, c.id).not.toBe('');
    }
  });

  it('🔒 every needs-static-export framework carries the exact change required', () => {
    // A refusal with no next step is the dead end this codebase keeps deleting.
    for (const c of FRAMEWORK_CAPABILITIES.filter((x) => x.apk === 'needs-static-export')) {
      expect(c.staticExportHint, c.id).toBeTruthy();
      expect(c.staticExportHint!.length, c.id).toBeGreaterThan(40);
    }
  });
});

describe('frameworkCapability', () => {
  it('returns the measured folders for the four that were being guessed wrong', () => {
    expect(frameworkCapability('angular').webDir).toBe('dist/app/browser');
    expect(frameworkCapability('nuxt').webDir).toBe('.output/public');
    expect(frameworkCapability('sveltekit').webDir).toBe('build');
    expect(frameworkCapability('remix').webDir).toBe('build/client');
  });

  it('🔒 an unknown id is ready/dist — the behaviour every caller had before this table existed', () => {
    // Guessing 'no-ui' would refuse APKs for working apps, which is the worse error by a distance.
    expect(frameworkCapability('some-new-thing')).toMatchObject({ apk: 'ready', webDir: 'dist' });
    expect(frameworkCapability('')).toMatchObject({ apk: 'ready' });
    expect(frameworkCapability(null)).toMatchObject({ apk: 'ready' });
  });

  it('is case- and whitespace-tolerant, because ids arrive from a UI', () => {
    expect(frameworkCapability('  Angular  ').webDir).toBe('dist/app/browser');
  });
});

describe('apkRefusal — honest, never blaming, always with a next step', () => {
  it('says nothing at all for a framework that is ready', () => {
    expect(apkRefusal(frameworkCapability('vue'), 'Vue')).toBe('');
  });

  it('🔒 a backend framework is told plainly there are no screens', () => {
    const msg = apkRefusal(frameworkCapability('node-express'), 'Express.js');
    expect(msg).toContain('no screens');
    expect(msg).toContain('blank');          // says what the user WOULD have got
    expect(msg).toContain('backend');        // and what to do instead
  });

  it('an SSR framework gets the exact one-line change', () => {
    expect(apkRefusal(frameworkCapability('nextjs'), 'Next.js')).toContain("output: 'export'");
    expect(apkRefusal(frameworkCapability('nuxt'), 'Nuxt 3')).toContain('nuxt generate');
    expect(apkRefusal(frameworkCapability('sveltekit'), 'SvelteKit')).toContain('adapter-static');
  });
});

describe('detectWebDir — the four folders it was silently guessing wrong', () => {
  it('🔒 Angular: dist/app/browser, NOT dist (measured — dist/ exists and holds no index.html)', () => {
    // The nastiest of the four: a wrong guess finds a REAL folder, full of server bundles.
    expect(detectWebDir(pkg({ dependencies: { '@angular/core': '^18' }, scripts: { build: 'ng build' } }), 'built'))
      .toBe('dist/app/browser');
  });

  it('Angular reads its real outputPath from angular.json when present', () => {
    const files = {
      ...pkg({ dependencies: { '@angular/core': '^18' } }),
      'angular.json': JSON.stringify({ projects: { x: { architect: { build: { options: { outputPath: 'dist/shop' } } } } } }),
    };
    expect(detectWebDir(files, 'built')).toBe('dist/shop/browser');
  });

  it('and does not double up when the path already ends in /browser', () => {
    const files = {
      ...pkg({ dependencies: { '@angular/core': '^18' } }),
      'angular.json': JSON.stringify({ options: { outputPath: 'dist/shop/browser' } }),
    };
    expect(detectWebDir(files, 'built')).toBe('dist/shop/browser');
  });

  it('SvelteKit -> build, Nuxt -> .output/public, Remix -> build/client (all measured)', () => {
    expect(detectWebDir(pkg({ dependencies: { '@sveltejs/kit': '^2' } }), 'built')).toBe('build');
    expect(detectWebDir(pkg({ devDependencies: { nuxt: '^3' } }), 'built')).toBe('.output/public');
    expect(detectWebDir(pkg({ dependencies: { '@remix-run/react': '^2' } }), 'built')).toBe('build/client');
  });

  it('🔒 these are checked BEFORE Vite — all three build THROUGH Vite and would be caught by it', () => {
    // The exact ordering bug this replaces: `deps.vite` matched first and answered `dist`.
    const sveltekit = pkg({ dependencies: { '@sveltejs/kit': '^2' }, devDependencies: { vite: '^5' } });
    expect(detectWebDir(sveltekit, 'built')).toBe('build');
    const nuxt = pkg({ devDependencies: { nuxt: '^3', vite: '^5' } });
    expect(detectWebDir(nuxt, 'built')).toBe('.output/public');
  });

  it('the answers that already worked are unchanged', () => {
    expect(detectWebDir(pkg({ devDependencies: { vite: '^5' } }), 'built')).toBe('dist');
    expect(detectWebDir(pkg({ dependencies: { astro: '^4' } }), 'built')).toBe('dist');
    expect(detectWebDir(pkg({ dependencies: { next: '^14' } }), 'built')).toBe('out');
    expect(detectWebDir(pkg({ dependencies: { 'react-scripts': '^5' } }), 'built')).toBe('build');
    expect(detectWebDir({}, 'static')).toBe('www');
    expect(detectWebDir({}, 'built')).toBe('dist');
  });

  it('an explicit Vite outDir still wins over every framework default', () => {
    const files = { ...pkg({ devDependencies: { vite: '^5' } }), 'vite.config.ts': "export default { build: { outDir: 'public_html' } }" };
    expect(detectWebDir(files, 'built')).toBe('public_html');
  });
});

describe('needsLegacyPeerDeps — the trigger that never fired for Nuxt', () => {
  it('🔒 npm resolver CRASH counts, not just its polite diagnosis', () => {
    // The measured Nuxt failure. It contains neither "ERESOLVE" nor "peer dep", so the old regex
    // missed it and no Nuxt app could install, ever.
    expect(needsLegacyPeerDeps("npm error Cannot read properties of null (reading 'edgesOut')")).toBe(true);
    expect(needsLegacyPeerDeps("Cannot read properties of null (reading 'edgesIn')")).toBe(true);
    expect(needsLegacyPeerDeps('RangeError: Maximum call stack size exceeded')).toBe(true);
  });

  it('the original signatures still match', () => {
    expect(needsLegacyPeerDeps('npm ERR! code ERESOLVE')).toBe(true);
    expect(needsLegacyPeerDeps('could not resolve peer dependency')).toBe(true);
    expect(needsLegacyPeerDeps('conflicting peer dep')).toBe(true);
  });

  it('🔒 does NOT retry failures a retry cannot fix', () => {
    // --legacy-peer-deps stops npm enforcing peer ranges: right for a conflict, wrong as a blanket
    // retry. These fail identically the second time, costing a minute and teaching nothing.
    for (const log of [
      'npm ERR! 404 Not Found - GET https://registry.npmjs.org/no-such-pkg',
      'npm ERR! code EINTEGRITY',
      'npm ERR! network request to registry failed',
      'ENOSPC: no space left on device',
      '',
    ]) expect(needsLegacyPeerDeps(log), log || '(empty)').toBe(false);
  });
});

describe('🔒 the four scaffold fixes are really in the templates', () => {
  it('vite-react ships React’s types — without them a correct ErrorBoundary cannot compile', () => {
    const contents = src('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents.ts');
    expect(contents).toContain('"@types/react"');
    expect(contents).toContain('"@types/react-dom"');
  });

  it('angular calls a method instead of using ++ in a template', () => {
    const provider = src('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/AngularProvider.ts');
    // Matched on the rendered BUTTON, not the bare expression: the file's comment quotes `count++`
    // deliberately, to explain why it cannot be there — a whole-file check would fail on the
    // explanation of the fix, which is the sort of test that teaches people to delete comments.
    expect(provider).not.toContain('<button (click)="count++">');
    expect(provider).toContain('<button (click)="increment()">');
    expect(provider).toContain('increment(): void { this.count++; }');
  });

  it('sveltekit ships the plugin its own svelte.config.js imports', () => {
    const provider = src('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/SvelteKitProvider.ts');
    expect(provider).toContain("'@sveltejs/vite-plugin-svelte'");
  });

  it('the installer uses the shared matcher, not an inline regex', () => {
    const actuator = src('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(actuator).toContain('needsLegacyPeerDeps(installLog)');
  });
});

describe('apkRefusalForProject — asked of the real files, never of a stored id', () => {
  it('🔒 a bare Express API is refused, before any repo is created', () => {
    const msg = apkRefusalForProject({
      'package.json': JSON.stringify({ dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }),
      'server.js': 'require("express")()',
    });
    expect(msg).toContain('no screens');
    expect(msg).toContain('backend');
  });

  it('a Python server too', () => {
    expect(apkRefusalForProject({ 'requirements.txt': 'fastapi\nuvicorn', 'main.py': 'x' })).not.toBe('');
  });

  it('🔒 ANY real screen wins — a fullstack app with a front end is never refused', () => {
    // An app that began as an API and grew a React front end must still be packageable. A stored
    // framework id could not tell you that; the files can.
    expect(apkRefusalForProject({
      'package.json': JSON.stringify({ dependencies: { express: '^4', react: '^18' } }),
      'src/App.tsx': 'export default () => <div/>;',
    })).toBe('');
  });

  it('index.html alone is enough', () => {
    expect(apkRefusalForProject({ 'index.html': '<h1>hi</h1>' })).toBe('');
  });

  it('🔒 every uncertain case builds, exactly as it does today', () => {
    // Refusing a working app is far worse than packaging an odd one.
    expect(apkRefusalForProject({})).toBe('');
    expect(apkRefusalForProject({ 'README.md': '# hi' })).toBe('');
    expect(apkRefusalForProject(null as never)).toBe('');
  });

  it('is wired into the ship route BEFORE the GitHub repo is created', () => {
    const route = src('src/server/routes/mobileSetup.ts');
    expect(route).toContain('const noUi = apkRefusalForProject(appFiles);');
    const at = route.indexOf('apkRefusalForProject(appFiles)');
    expect(at).toBeLessThan(route.indexOf('await ensureRepo('));
  });
});
