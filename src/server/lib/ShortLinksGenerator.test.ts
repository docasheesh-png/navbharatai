import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateShortLinksIntegration, SHORTLINKS_SERVICE_SOURCE } from './ShortLinksGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateShortLinksIntegration (wiring)', () => {
  it('emits the short-link service, routes and README', () => {
    const out = generateShortLinksIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/shortlinks/shortLinkService.ts');
    expect(paths).toContain('server/shortlinks/routes.ts');
    expect(paths).toContain('server/shortlinks/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/shortlinks/routes.ts']).toContain('export const shortLinkRouter');
    expect(out.files['server/shortlinks/routes.ts']).toContain('302');
  });
});

// Materialize + execute the emitted domain logic — the uniqueness + click-count + expiry rules are real
// business rules, verified against the actual emitted code.
describe('emitted ShortLinkService — unique codes + click counts + expiry (real logic)', () => {
  const artifact = join(here, `._shortlink_emitted_${process.pid}.ts`);
  writeFileSync(artifact, SHORTLINKS_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface ShortLink { code: string; url: string; clicks: number; active: boolean; expiresAt: string | null }
  interface Service {
    shorten(url: string, opts?: { alias?: string; expiresAt?: string | null }, now?: Date): ShortLink;
    get(code: string): ShortLink | undefined;
    resolve(code: string, now?: Date): string | null;
    peek(code: string, now?: Date): string | null;
    setActive(code: string, active: boolean, now?: Date): ShortLink;
    remove(code: string): boolean;
    list(): ShortLink[];
  }
  interface Emitted { ShortLinkService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('generates unique codes and only accepts http(s) URLs', async () => {
    const { ShortLinkService } = await load();
    const svc = new ShortLinkService();
    const a = svc.shorten('https://example.com/a');
    const b = svc.shorten('https://example.com/b');
    expect(a.code).not.toBe(b.code);
    expect(a.code.length).toBeGreaterThanOrEqual(7);
    expect(() => svc.shorten('ftp://example.com')).toThrow(/valid http/);
    expect(() => svc.shorten('not a url')).toThrow(/valid http/);
  });

  it('resolve returns the target and counts EXACT clicks; peek does not count', async () => {
    const { ShortLinkService } = await load();
    const svc = new ShortLinkService();
    const l = svc.shorten('https://example.com/x');
    expect(svc.peek(l.code)).toBe('https://example.com/x');
    expect(svc.get(l.code)?.clicks).toBe(0); // peek did not count
    expect(svc.resolve(l.code)).toBe('https://example.com/x');
    expect(svc.resolve(l.code)).toBe('https://example.com/x');
    expect(svc.get(l.code)?.clicks).toBe(2); // two resolves counted
    expect(svc.resolve('nope')).toBeNull(); // unknown code
  });

  it('custom aliases are unique and validated', async () => {
    const { ShortLinkService } = await load();
    const svc = new ShortLinkService();
    const l = svc.shorten('https://example.com/promo', { alias: 'summer-sale' });
    expect(l.code).toBe('summer-sale');
    expect(() => svc.shorten('https://example.com/other', { alias: 'summer-sale' })).toThrow(/already taken/);
    expect(() => svc.shorten('https://example.com/x', { alias: 'bad alias!' })).toThrow(/only letters/);
  });

  it('an EXPIRED link stops resolving (returns null)', async () => {
    const { ShortLinkService } = await load();
    const svc = new ShortLinkService();
    const T0 = new Date('2026-01-01T00:00:00.000Z');
    const l = svc.shorten('https://example.com/e', { expiresAt: '2026-02-01T00:00:00.000Z' }, T0);
    // before expiry it resolves
    expect(svc.resolve(l.code, new Date('2026-01-15T00:00:00.000Z'))).toBe('https://example.com/e');
    // after expiry → null (route would 404), and no extra click counted
    expect(svc.resolve(l.code, new Date('2026-03-01T00:00:00.000Z'))).toBeNull();
    expect(svc.get(l.code)?.clicks).toBe(1);
  });

  it('a disabled link stops resolving; remove works', async () => {
    const { ShortLinkService } = await load();
    const svc = new ShortLinkService();
    const l = svc.shorten('https://example.com/d');
    svc.setActive(l.code, false);
    expect(svc.resolve(l.code)).toBeNull();
    svc.setActive(l.code, true);
    expect(svc.resolve(l.code)).toBe('https://example.com/d');
    expect(svc.remove(l.code)).toBe(true);
    expect(svc.remove(l.code)).toBe(false);
    expect(() => svc.setActive('nope', false)).toThrow(/link not found/);
  });
});
