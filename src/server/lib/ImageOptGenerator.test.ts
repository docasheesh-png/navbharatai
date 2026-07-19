import { describe, it, expect } from 'vitest';
import { generateImageOptimization } from './ImageOptGenerator';

describe('generateImageOptimization', () => {
  it('emits a sharp server helper + a CLS-safe lazy image, and declares sharp', () => {
    const out = generateImageOptimization();
    expect(Object.keys(out.files).sort()).toEqual([
      'server/lib/optimizeImage.ts',
      'src/components/ui/LazyImage.tsx',
    ]);
    expect(out.dependencies).toEqual([{ name: 'sharp', version: '^0.33' }]);
  });

  it('the server helper resizes without upscaling, honours EXIF, and defaults to WebP', () => {
    const s = generateImageOptimization().files['server/lib/optimizeImage.ts'];
    expect(s).toContain("import sharp from 'sharp'");
    expect(s).toContain('withoutEnlargement: true');
    expect(s).toContain('.rotate()'); // EXIF orientation
    expect(s).toContain("const format = opts.format ?? 'webp'");
  });

  it('the lazy image reserves space (width/height + aspect-ratio) and lazy-loads', () => {
    const c = generateImageOptimization().files['src/components/ui/LazyImage.tsx'];
    expect(c).toContain('loading="lazy"');
    expect(c).toContain('decoding="async"');
    expect(c).toContain('aspectRatio:');
    expect(c).toContain('width: number;'); // width/height required (CLS-safe)
  });
});
