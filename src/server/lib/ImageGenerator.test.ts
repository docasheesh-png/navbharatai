import { describe, it, expect } from 'vitest';
import { generateImageIntegration } from './ImageGenerator';

describe('generateImageIntegration', () => {
  const c = generateImageIntegration();
  const server = c.files['server/lib/image.ts'];

  it('emits resizeImage + makeThumbnail built on sharp', () => {
    expect(server).toContain("import sharp from 'sharp'");
    expect(server).toContain('export async function resizeImage(');
    expect(server).toContain('export async function makeThumbnail(');
    expect(server).toContain('.toBuffer()');
    expect(c.files['src/lib/image.ts']).toBeUndefined(); // server-side
  });

  it('resizes safely (never upscales, honours EXIF orientation, defaults to WebP)', () => {
    expect(server).toContain('withoutEnlargement: true'); // never upscale a small image
    expect(server).toContain('.rotate()'); // EXIF orientation so phone photos aren't sideways
    expect(server).toContain("opts.format ?? 'webp'");
    expect(server).toContain("fit: 'cover'"); // square thumbnail crop
  });

  it('declares sharp, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'sharp', version: '^0.33.0' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/image.ts']);
    expect(c.instructions.toLowerCase()).toContain('resize');
  });
});
