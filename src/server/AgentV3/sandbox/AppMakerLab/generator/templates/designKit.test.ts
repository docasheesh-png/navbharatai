import { describe, it, expect } from 'vitest';
import { DESIGN_KIT_CSS } from './designKit';
import { indexCss } from './ViteReactProviderContents';
import { VueProvider } from './VueProvider';
import { SvelteProvider } from './SvelteProvider';
import { PreactProvider } from './PreactProvider';
import { SolidProvider } from './SolidProvider';
import { AlpineProvider } from './AlpineProvider';
import { VanillaProvider } from './VanillaProvider';
import { StaticProvider } from './StaticProvider';
import { NextjsProvider } from './NextjsProvider';
import { AngularProvider } from './AngularProvider';
import { SvelteKitProvider } from './SvelteKitProvider';
import { NuxtProvider } from './NuxtProvider';
import { RemixProvider } from './RemixProvider';

/**
 * ONE KIT, EVERY SCAFFOLD.
 *
 * Investigating the admin's "inner pages feel like plain HTML" report turned up something bigger than
 * the reported symptom: the design kit the architect prompt tells every build to reuse existed in
 * exactly ONE of the 24 scaffold providers. A Vue or Svelte app was told to reach for `.card` and
 * `.nb-empty` with nothing behind them — so those builds had no design language to be consistent WITH,
 * and started from zero every time. That is where output quality varies most.
 *
 * Two things have to hold for the kit to be real, and only the first is obvious:
 *   1. the stylesheet is EMITTED, and
 *   2. something actually LOADS it. A src/index.css that no entry file imports is dead weight — the
 *      exact defect ProjectIntegrityChecks calls an orphan stylesheet, and it renders as raw HTML.
 */
const PROVIDERS: Array<{ name: string; files: Record<string, string>; loadedBy: string }> = [
  { name: 'Vue', files: new VueProvider().getFiles([]), loadedBy: 'src/main.ts' },
  { name: 'Svelte', files: new SvelteProvider().getFiles([]), loadedBy: 'src/main.js' },
  { name: 'Preact', files: new PreactProvider().getFiles([]), loadedBy: 'src/main.tsx' },
  { name: 'Solid', files: new SolidProvider().getFiles([]), loadedBy: 'src/index.tsx' },
  { name: 'Alpine', files: new AlpineProvider().getFiles([]), loadedBy: 'src/main.ts' },
  { name: 'Vanilla', files: new VanillaProvider().getFiles([]), loadedBy: 'src/main.ts' },
];

describe('the kit is a single source of truth', () => {
  it('Vite+React re-exports it rather than holding a second copy', () => {
    // Four drifted copies of one thing is the failure rule 4 exists to prevent. A palette change must
    // reach every scaffold at once or the kit is worthless as a standard.
    expect(indexCss).toBe(DESIGN_KIT_CSS);
  });

  it('contains the classes the architect prompt actually tells builds to use', () => {
    // If the prompt and the kit disagreed, the model would write classes with no CSS behind them.
    for (const cls of [
      '.card', '.btn-primary', '.btn-ghost', '.badge', '.alert', '.container', '.stack', '.row',
      '.field', '.nb-table', '.nb-empty', '.nb-stats', '.nb-shell', '.nb-hero', '.nb-skeleton',
    ]) {
      expect(DESIGN_KIT_CSS, `${cls} missing from the kit`).toContain(cls);
    }
  });

  it('ships the palette variables the kit is built on', () => {
    for (const token of ['--accent', '--card', '--border', '--radius', '--muted']) {
      expect(DESIGN_KIT_CSS, `${token} missing`).toContain(token);
    }
  });

  it('is dark-mode aware and honours reduced motion', () => {
    expect(DESIGN_KIT_CSS).toContain('prefers-color-scheme');
    expect(DESIGN_KIT_CSS).toContain('prefers-reduced-motion');
  });
});

describe('every wired scaffold both SHIPS the kit and LOADS it', () => {
  for (const { name, files, loadedBy } of PROVIDERS) {
    it(`${name} emits src/index.css with the kit`, () => {
      expect(files['src/index.css']).toBe(DESIGN_KIT_CSS);
    });

    it(`${name} imports it from its entry file — an unimported stylesheet is dead weight`, () => {
      expect(files[loadedBy], `${name} has no ${loadedBy}`).toBeTruthy();
      expect(files[loadedBy]).toContain("import './index.css'");
    });

    it(`${name} keeps its original entry code intact`, () => {
      // The import is PREPENDED; wiping the entry would break the scaffold outright.
      expect(files[loadedBy].length).toBeGreaterThan("import './index.css';\n".length + 40);
    });
  }
});

/**
 * The frameworks whose global stylesheet is wired somewhere OTHER than an entry-file import. Each is a
 * different mechanism, and getting one wrong emits a stylesheet nothing loads — which looks exactly
 * like success until you open the app.
 */
describe('the SSR/framework scaffolds each load the kit their own way', () => {
  it('Next folds it into the globals.css that app/layout.tsx already imports', () => {
    const files = new NextjsProvider().getFiles([]);
    expect(files['app/globals.css']).toContain('.nb-empty');
    expect(files['app/globals.css'].startsWith(DESIGN_KIT_CSS)).toBe(true);
    expect(files['app/layout.tsx']).toContain("import './globals.css'");
  });

  it('Angular folds it into the styles.css that angular.json already declares', () => {
    const files = new AngularProvider().getFiles([]);
    expect(files['src/styles.css']).toContain('.nb-empty');
    expect(files['src/styles.css'].startsWith(DESIGN_KIT_CSS)).toBe(true);
    expect(files['angular.json']).toContain('src/styles.css');
  });

  it('SvelteKit imports it from the ROOT LAYOUT, which every route renders through', () => {
    const files = new SvelteKitProvider().getFiles([]);
    expect(files['src/app.css']).toBe(DESIGN_KIT_CSS);
    expect(files['src/routes/+layout.svelte']).toContain("import '../app.css'");
    // The layout must still render its children, or the kit arrives and the pages do not.
    expect(files['src/routes/+layout.svelte']).toContain('{@render children()}');
  });

  it('Nuxt registers it in the config css array — an emitted file alone is never loaded', () => {
    const files = new NuxtProvider().getFiles([]);
    expect(files['assets/css/main.css']).toBe(DESIGN_KIT_CSS);
    expect(files['nuxt.config.ts']).toContain("css: ['~/assets/css/main.css']");
  });

  it('each of them keeps whatever the scaffold already had', () => {
    // Prepending must not have replaced the scaffold's own rules.
    expect(new NextjsProvider().getFiles([])['app/globals.css'].length).toBeGreaterThan(DESIGN_KIT_CSS.length);
    expect(new AngularProvider().getFiles([])['src/styles.css'].length).toBeGreaterThan(DESIGN_KIT_CSS.length);
  });
});

describe('the scaffolds deliberately left alone', () => {
  it('Remix is NOT wired — its SSR stylesheet idiom cannot be verified here', () => {
    // Remix needs `import x from './app.css?url'` plus a links() export, and a wrong guess ships an
    // app that either fails to build or flashes unstyled on every navigation. Claiming the kit while
    // shipping something unverified would be worse than leaving it out honestly.
    const files = new RemixProvider().getFiles([]);
    expect(Object.keys(files).some((f) => f.endsWith('.css'))).toBe(false);
  });
});

describe('the static scaffold, which has no bundler', () => {
  const files = new StaticProvider().getFiles([]);

  it('folds the kit into the stylesheet its HTML already links', () => {
    // No <link> change needed, so there is no way for the page and the stylesheet to disagree.
    expect(files['style.css']).toContain('.nb-empty');
    expect(files['style.css'].startsWith(DESIGN_KIT_CSS)).toBe(true);
  });

  it("keeps the scaffold's own rules, and AFTER the kit so they win", () => {
    expect(files['style.css'].length).toBeGreaterThan(DESIGN_KIT_CSS.length);
  });

  it('and its index.html really links that stylesheet', () => {
    expect(files['index.html']).toMatch(/<link[^>]*style\.css/);
  });
});
