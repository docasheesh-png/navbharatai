import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cacheControlFor } from './staticCache';

describe('staticCache — CDN/edge cache policy (P3.4)', () => {
  describe('cacheControlFor', () => {
    it('content-hashed assets are immutable + public + 1 year', () => {
      for (const f of ['/assets/index-abc123.js', '/assets/x.mjs', '/assets/y.css', '/fonts/z.woff2', '/a.wasm']) {
        expect(cacheControlFor(f)).toBe('public, max-age=31536000, immutable');
      }
    });

    it('images are public + 1 week', () => {
      expect(cacheControlFor('/logo.png')).toBe('public, max-age=604800');
      expect(cacheControlFor('/a.webp')).toBe('public, max-age=604800');
    });

    it('HTML always revalidates', () => {
      expect(cacheControlFor('/index.html')).toBe('no-cache, no-store, must-revalidate');
    });

    it('the service worker is NEVER cached long (even though it ends in .js)', () => {
      expect(cacheControlFor('/sw.js')).toBe('no-cache, no-store, must-revalidate');
      // critical regression guard: sw.js must NOT get the immutable 1-year policy
      expect(cacheControlFor('/sw.js')).not.toContain('immutable');
    });

    it('the PWA manifest is never cached long (ends in .json)', () => {
      expect(cacheControlFor('/manifest.json')).toBe('no-cache, no-store, must-revalidate');
    });

    it('returns null for paths with no specific policy', () => {
      expect(cacheControlFor('/some/file.txt')).toBeNull();
      expect(cacheControlFor('/data.bin')).toBeNull();
    });
  });

  describe('firebase.json hosting headers mirror the same policy', () => {
    const fb = JSON.parse(readFileSync(join(process.cwd(), 'firebase.json'), 'utf-8'));
    const headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
      fb.hosting?.headers ?? [];

    function ccFor(source: string): string | undefined {
      const entry = headers.find((h) => h.source === source);
      return entry?.headers.find((h) => h.key === 'Cache-Control')?.value;
    }

    it('firebase.json is valid and defines a hosting.headers block', () => {
      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBeGreaterThanOrEqual(4);
    });

    it('hashed assets immutable; sw.js + manifest + html revalidate', () => {
      expect(ccFor('**/*.@(js|mjs|css|woff2|woff|ttf|otf|wasm)')).toBe('public, max-age=31536000, immutable');
      expect(ccFor('**/*.@(png|jpg|jpeg|svg|ico|webp|gif|avif)')).toBe('public, max-age=604800');
      expect(ccFor('**/*.html')).toBe('no-cache, no-store, must-revalidate');
      expect(ccFor('/@(sw.js|manifest.json)')).toBe('no-cache, no-store, must-revalidate');
    });
  });
});
