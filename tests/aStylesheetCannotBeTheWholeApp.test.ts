/**
 * A stylesheet cannot be the whole app — autopsy `f152c1ab`, 2026-09-20.
 *
 * The reported build planned SEVEN files for a PDF-to-audio app. `generationTier` put `src/App.css`
 * alone in tier 0, the foundation wave that runs FIRST. That one file took **137 seconds of a 240
 * second budget**; the lane then bailed with *"2 stage(s) left would need about 468s"*, and the only
 * thing salvaged from a 3.7-minute build was a **10 KB stylesheet for an app that did not exist**.
 * The user pressed Stop 2.5 seconds later.
 *
 * Tier 0 exists so later tiers can be handed the REAL source of what they import. A stylesheet
 * exports nothing importable; what it actually needs is the class names the COMPONENTS chose. The
 * dependency ran backwards, and the budget paid for it.
 */
import { describe, it, expect } from 'vitest';
import { generationTier } from '../src/server/AgentV3/SimpleBuilder';

/** The manifest the reported build actually planned, in the order the plan call emitted it. */
const REPORTED_MANIFEST: readonly string[] = [
  'index.html',
  'package.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/components/PdfUploader.tsx',
  'src/components/AudioControls.tsx',
  'src/App.css',
];

/** How many distinct waves this manifest costs — the number the budget projection multiplies. */
const stageCount = (paths: readonly string[]): number =>
  new Set(paths.map((p) => generationTier(p))).size;

describe('a stylesheet is generated last', () => {
  it('every stylesheet syntax lands in the last tier, not the first', () => {
    for (const path of [
      'src/App.css',
      'src/index.css',
      'src/styles/App.css',
      'src/Card.module.css',
      'src/theme.scss',
      'src/theme.sass',
      'src/theme.less',
      'src/theme.styl',
    ]) {
      expect(generationTier(path), path).toBe(2);
    }
  });

  it('real foundation files are untouched — they DO export what later tiers import', () => {
    expect(generationTier('src/types/media.ts')).toBe(0);
    expect(generationTier('src/utils/extractEmbedUrl.ts')).toBe(0);
    expect(generationTier('src/hooks/useMediaUrl.ts')).toBe(0);
    expect(generationTier('src/constants.ts')).toBe(0);
    expect(generationTier('src/context/AuthContext.tsx')).toBe(0);
    expect(generationTier('src/global.d.ts')).toBe(0);
  });

  it('the shell and the components keep their tiers', () => {
    expect(generationTier('src/main.tsx')).toBe(2);
    expect(generationTier('src/App.tsx')).toBe(2);
    expect(generationTier('src/components/PdfUploader.tsx')).toBe(1);
    expect(generationTier('index.html')).toBe(1);
  });
});

describe('the reported manifest, before and after', () => {
  /**
   * 🔑 THE MEASURABLE WIN. The stylesheet was the ONLY member of tier 0, so removing it from that
   * wave removes a whole STAGE — and stages are what the budget projection multiplies
   * (`canFinishAfterPreamble`). Three stages at the measured tier cost did not fit in 240 s; two do.
   */
  it('costs one stage fewer than it did', () => {
    expect(stageCount(REPORTED_MANIFEST)).toBe(2);
  });

  it('the first wave now produces real app files instead of a stylesheet', () => {
    const firstWave = Math.min(...REPORTED_MANIFEST.map((p) => generationTier(p)));
    const inFirstWave = REPORTED_MANIFEST.filter((p) => generationTier(p) === firstWave);
    // Was exactly ['src/App.css'] — a 3.7-minute build whose entire salvage was a stylesheet.
    expect(inFirstWave).not.toEqual(['src/App.css']);
    expect(inFirstWave).toContain('src/components/PdfUploader.tsx');
    expect(inFirstWave).toContain('src/components/AudioControls.tsx');
    expect(inFirstWave).not.toContain('src/App.css');
  });

  it('the stylesheet is written after the components whose class names it must match', () => {
    const css = generationTier('src/App.css');
    for (const component of ['src/components/PdfUploader.tsx', 'src/components/AudioControls.tsx']) {
      expect(generationTier(component), component).toBeLessThan(css);
    }
  });
});
