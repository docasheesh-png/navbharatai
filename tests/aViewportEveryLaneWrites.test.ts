import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import {
  APP_VIEWPORT_META, APP_VIEWPORT_CONTENT, withViewportFitCover, nativeFeelStylesheet, nativeFeelBuildRule,
} from '../src/server/AgentV3/nativeFeel';

/**
 * 🧬 ROUND 1 FIXED THE READER AND LEFT THE SOURCE — native-feel round 3, 2026-10-12.
 *
 * `withViewportFitCover` PATCHES a user's `index.html` at build time, so an AgentV3 build gets
 * `viewport-fit=cover` and its `env(safe-area-inset-*)` values stop reading 0px. Measured afterwards,
 * **not one of the fourteen viewport tags in the scaffold templates carried the token**: thirteen
 * provider templates each hand-wrote their own string, so there was nowhere to add it once, and any lane
 * that does not pass through `appDefaults` shipped the exact defect round 1 was written for.
 *
 * 🔑 THE CLASS, in this repo's own words: *an instance fixed at one reader, the source left alone, and
 * the siblings never hunted.* The string now lives beside its reason in `nativeFeel.ts` and the templates
 * import it. `withViewportFitCover` stays as defence in depth — it returns a document untouched once the
 * token is present, so a correct template makes it a no-op instead of a rescue.
 *
 * 🔒 AND THE CENSUS IS THE POINT, not the thirteen edits. A fourteenth template that hand-writes its own
 * viewport is the defect returning, and it fails this file.
 */

const TEMPLATES = 'src/server/AgentV3/sandbox/AppMakerLab/generator/templates';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every framework whose provider ships an HTML document for the user's app. */
const HTML_FRAMEWORKS = [
  'vite-react', 'vue', 'svelte', 'sveltekit', 'solid', 'preact',
  'lit', 'alpine', 'astro', 'angular', 'vanilla', 'static', 'remix',
] as const;

const filesFor = (framework: string): Record<string, string> => {
  const provider = new TemplateRegistry().getProvider(framework);
  const out = (provider as unknown as { getFiles: (deps: string[]) => Record<string, string> }).getFiles([]);
  return out ?? {};
};

/**
 * The provider's own document, whatever file it lives in. Astro puts it in `.astro`, Remix in
 * `root.tsx`, SvelteKit in `app.html` — and my first version of this filter missed `.astro` entirely,
 * so the astro case failed on an empty string. A filter that can return nothing must be checked, which
 * is why every case below asserts the document is non-empty before asserting what is in it.
 */
const htmlOf = (files: Record<string, string>): string =>
  Object.entries(files)
    .filter(([p]) => /\.(html?|astro|svelte|vue)$/i.test(p) || /root\.tsx$/i.test(p))
    .map(([, c]) => c)
    .join('\n');

describe('the viewport every lane writes (native feel, round 3)', () => {
  describe('🔴 the apps NavBharatAI builds really carry the token now', () => {
    for (const framework of HTML_FRAMEWORKS) {
      it(`${framework}: its document has viewport-fit=cover`, () => {
        const html = htmlOf(filesFor(framework));
        expect(html.length, 'no document found — the filter above is wrong, not the template').toBeGreaterThan(0);
        expect(html).toContain('name="viewport"');
        expect(html).toContain('viewport-fit=cover');
      });

      it(`${framework}: and the interpolation really ran, not shipped as text`, () => {
        // The thirteen edits replaced a hand-written tag with an interpolation. Inside a plain quoted
        // string that would ship as TEXT, and the app would carry a broken meta tag that looks right in
        // the diff. Generating the files is the only check that catches it.
        //
        // ⚠️ It asserts the LITERAL is absent, not that no `${` appears anywhere: Remix's `root.tsx` is
        // generated code that legitimately contains its own template literals, and the blanket version
        // of this check failed on them — my assertion, not the template.
        const html = htmlOf(filesFor(framework));
        expect(html).not.toContain('APP_VIEWPORT_META');
        expect(html).toContain(APP_VIEWPORT_CONTENT);
      });
    }
  });

  describe('🔒 THE CENSUS — no template may hand-write its own viewport', () => {
    const sources = readdirSync(join(process.cwd(), TEMPLATES))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => ({ file: f, text: read(join(TEMPLATES, f)) }));

    it('every viewport in the template directory comes from the one constant', () => {
      const offenders = sources
        .filter(({ text }) => /content\s*=\s*["']width=device-width/.test(text))
        .map(({ file }) => file);
      expect(offenders).toEqual([]);
    });

    it('…and the files that reference it import it rather than re-typing the string', () => {
      const users = sources.filter(({ text }) => text.includes('APP_VIEWPORT_META'));
      expect(users.length).toBeGreaterThanOrEqual(13);
      for (const { file, text } of users) {
        expect(text, file).toMatch(/import \{[^}]*APP_VIEWPORT_META[^}]*\} from/);
      }
    });

    it('the constant allows pinch-zoom — an app that blocks it fails a store review', () => {
      expect(APP_VIEWPORT_META).toContain('viewport-fit=cover');
      expect(APP_VIEWPORT_CONTENT).not.toContain('maximum-scale');
      expect(APP_VIEWPORT_CONTENT).not.toContain('user-scalable');
    });
  });

  describe('🔒 what is DELIBERATELY out of scope, with the reason', () => {
    /**
     * These write a viewport too, and sweeping them would be the "fix A, create X" mistake. Listed so
     * the exclusion is a decision on the record rather than an oversight — and so a future reader does
     * not "finish the job" by adding the token to an email.
     */
    const OUT_OF_SCOPE: ReadonlyArray<readonly [string, string]> = [
      ['src/server/lib/EmailTemplateGenerator.ts', 'an email is not an app; mail clients ignore viewport-fit and some choke on unknown tokens'],
      ['src/server/runtime/ReactPreview.ts', 'renders a preview of the app, it does not ship one — changing it changes what we SHOW, not what the user gets'],
      ['src/server/runtime/StaticPreview.ts', 'same: a preview host, not the delivered document'],
      ['src/server/runtime/VuePreview.ts', 'same: a preview host, not the delivered document'],
    ];

    for (const [path, why] of OUT_OF_SCOPE) {
      it(`${path.split('/').pop()} is left alone — ${why}`, () => {
        const text = read(path);
        expect(text).toContain('width=device-width');
        expect(text).not.toContain('APP_VIEWPORT_META');
      });
    }
  });

  describe('defence in depth is kept, not replaced', () => {
    it('withViewportFitCover now finds nothing to do on a correct template — and says so', () => {
      const html = `<!doctype html><html><head>${APP_VIEWPORT_META}</head><body></body></html>`;
      expect(withViewportFitCover(html).changed).toBe(false);
    });

    it('…and still rescues a document that came from somewhere else', () => {
      const old = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head></html>';
      const out = withViewportFitCover(old);
      expect(out.changed).toBe(true);
      expect(out.html).toContain('viewport-fit=cover');
    });
  });

  describe('🔴 the other half: a full-height app ends where the SCREEN ends', () => {
    const css = nativeFeelStylesheet();

    it('--app-height is defined with a plain fallback first, then dvh', () => {
      // `100vh` on a phone is the LARGE viewport — it includes the collapsing address bar, so a
      // `height: 100vh` layout is cut off by exactly the toolbar height. The fallback order matters: a
      // browser without `dvh` must still get a full-height layout, not none.
      expect(css).toContain('--app-height: 100vh;');
      expect(css).toContain('@supports (height: 100dvh)');
      expect(css.indexOf('--app-height: 100vh;')).toBeLessThan(css.indexOf('@supports (height: 100dvh)'));
      expect(css).toContain('min-height: 100dvh;');
    });

    it('the build rule names the variable instead of just forbidding 100vh', () => {
      const rule = nativeFeelBuildRule({ AGENTV3_NATIVE_FEEL: 'on' } as unknown as NodeJS.ProcessEnv).join('\n');
      expect(rule).toContain('var(--app-height)');
      expect(rule).toContain('NEVER `100vh`');
    });

    it('the stylesheet still paints no colour of its own', () => {
      // Round 2's standing promise, re-checked because this round touched the same file.
      const values = [...css.matchAll(/(?:^|[^-\w])(?:background(?:-color)?|color|border-color)\s*:\s*([^;]+);/g)]
        .map((m) => m[1].trim());
      for (const v of values) expect(['currentColor', 'transparent', 'inherit']).toContain(v);
    });
  });
});
