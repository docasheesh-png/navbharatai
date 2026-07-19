import { describe, it, expect } from 'vitest';
import { generateSlugIntegration } from './SlugGenerator';

describe('generateSlugIntegration', () => {
  const c = generateSlugIntegration();
  const server = c.files['server/lib/slug.ts'];

  it('emits slugify + uniqueSlug, dependency-free and server-side', () => {
    expect(server).toContain('export function slugify(');
    expect(server).toContain('export function uniqueSlug(');
    expect(server).not.toContain("import ");
    expect(c.files['src/lib/slug.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('is Unicode-aware (keeps any-script letters/numbers, not just a-z0-9)', () => {
    expect(server).toContain('\\p{L}');
    expect(server).toContain('\\p{N}');
    expect(server).toContain("normalize('NFKD')");
    // must NOT be the naive Latin-only stripper
    expect(server).not.toContain('[^a-z0-9]');
  });

  it('preserves Indic combining marks (matras/viramas) so Hindi slugs are not shattered', () => {
    // \\p{M} MUST be in the allow-set: Devanagari matras are Marks, not Letters — dropping them
    // would turn "नमस्ते" into "नमस-त". Regression guard for the real Devanagari fix.
    expect(server).toContain('\\p{M}');
    expect(server).toContain('[^\\p{L}\\p{N}\\p{M}]+');
  });

  it('collapses separators and trims edge hyphens', () => {
    expect(server).toContain('/-+/g');
    expect(server).toContain('/^-+|-+$/g');
  });

  it('uniqueSlug appends a numeric suffix on collision', () => {
    expect(server).toContain("base + '-' + n");
    expect(server).toContain('used.has(base)');
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/slug.ts']);
    expect(c.instructions.toLowerCase()).toContain('slug');
  });
});
