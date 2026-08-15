/**
 * A CHECK WE CANNOT PERFORM MUST SAY NOTHING — not "missing".
 *
 * Found while root-causing the admin's blocked APK (2026-08-14). The reported specifier was
 * `@assets/…png`, which was being mistaken for an npm package — fixed separately. Hunting the siblings
 * turned up the much wider face of the SAME root cause:
 *
 *   import logo from './logo.png';
 *
 * …the most ordinary line in any app with a logo, was reported as
 *   `imports "./logo.png", but no such file exists in the app`
 * and the ship was REFUSED.
 *
 * 🔒 ROOT CAUSE — the durable workspace store is TEXT ONLY. `saveWorkspaceFiles` keeps only entries
 * whose content is a string, so a `.png` is never in the file map these checks run against. Reading
 * "not in the map" as "does not exist in the app" therefore returned MISSING for every image in every
 * app, whether the image was there or not. A verdict that is wrong 100% of the time carries no
 * information — removing it loses nothing and unblocks real builds.
 *
 * ⚠️ `.svg` and `.css` are TEXT, they ARE persisted, and they are still checked. The line between the
 * two is exactly `isBinaryAsset`, reused rather than re-listed, so the two can never drift.
 */

import { describe, it, expect } from 'vitest';
import { preflightVerify } from '../src/server/lib/mobileShipPreflight';
import { isBinaryAssetSpecifier } from '../src/server/AgentV3/fileClassification';
import { analyzeArchitecture } from '../src/server/AgentV3/ArchitectureAnalysis';

const PKG = JSON.stringify({
  name: 'app',
  dependencies: { react: '18' },
  devDependencies: { vite: '5' },
  scripts: { build: 'vite build' },   // a 'built' project — the shape these checks run on
});

const app = (body: string): Record<string, string> => ({
  'package.json': PKG,
  'src/App.tsx': `${body}\nexport default function App(){ return null; }\n`,
});

describe('🔒 an image import never blocks the ship', () => {
  it('the plain relative form — the one that actually blocked an APK build', async () => {
    const r = await preflightVerify(app(`import logo from './logo.png';`));
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('every shape a generated app uses to reach an image', async () => {
    for (const spec of [
      './logo.png', '../assets/hero.jpg', '@/assets/logo.png', '~/img/bg.webp',
      '@assets/IMG_1_1773842365564.png', './video.mp4', './tune.mp3', '../fonts/Inter.woff2',
    ]) {
      const r = await preflightVerify(app(`import a from '${spec}';`));
      expect(r.problems, spec).toEqual([]);
    }
  });

  it('handles the query suffix bundlers add', async () => {
    const r = await preflightVerify(app(`import u from './logo.png?url';\nimport f from './i.woff2#iefix';`));
    expect(r.problems).toEqual([]);
  });

  it('🔒 a missing CODE file is STILL caught — this must not go blind', async () => {
    const r = await preflightVerify(app(`import { Button } from './components/Button';`));
    expect(r.ok).toBe(false);
    expect(r.problems[0].kind).toBe('unresolved-import');
    expect(r.problems[0].spec).toBe('./components/Button');
  });

  it('🔒 and a missing .svg / .css is still caught — they are TEXT and really are persisted', async () => {
    for (const spec of ['./icon.svg', './styles.css']) {
      const r = await preflightVerify(app(`import x from '${spec}';`));
      expect(r.ok, spec).toBe(false);
      expect(r.problems[0].spec, spec).toBe(spec);
    }
  });

  it('a code file that DOES exist still resolves normally', async () => {
    const files = { ...app(`import { Button } from './components/Button';`), 'src/components/Button.tsx': 'export const Button = () => null;' };
    expect((await preflightVerify(files)).ok).toBe(true);
  });
});

describe('the specifier predicate', () => {
  it('names binaries, and only binaries', () => {
    for (const s of ['./a.png', '@assets/b.JPEG', '../c.mp4', 'x/d.woff2', './e.pdf', './f.zip']) {
      expect(isBinaryAssetSpecifier(s), s).toBe(true);
    }
    for (const s of ['./a.svg', './b.css', './Button', 'react', '@dnd-kit/core', './x.ts', '', null as never]) {
      expect(isBinaryAssetSpecifier(s as string), String(s)).toBe(false);
    }
  });

  it('strips a query or hash before deciding', () => {
    expect(isBinaryAssetSpecifier('./a.png?w=800')).toBe(true);
    expect(isBinaryAssetSpecifier('./a.woff2#iefix')).toBe(true);
    expect(isBinaryAssetSpecifier('./a.ts?raw')).toBe(false);
  });
});

describe('🔒 the readiness score stops counting phantom defects too', () => {
  it('an image import is not an "unresolved import" in the architecture report', () => {
    const graph = {
      files: ['src/App.tsx'],
      imports: { 'src/App.tsx': ['./logo.png', './hero.jpg', './Missing'] },
      symbols: [],
    } as never;
    const report = analyzeArchitecture(graph);
    // Only the real one survives — the two images are invisible to us, so we say nothing about them.
    expect(report.unresolvedImports).toEqual(['src/App.tsx -> ./Missing']);
  });
});
