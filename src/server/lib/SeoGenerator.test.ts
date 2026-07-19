import { describe, it, expect } from 'vitest';
import { generateSeoIntegration } from './SeoGenerator';

describe('generateSeoIntegration', () => {
  const c = generateSeoIntegration();
  const server = c.files['server/lib/seo.ts'];

  it('emits buildMetaTags + buildSitemap + buildRobotsTxt, dependency-free and server-side', () => {
    expect(server).toContain('export function buildMetaTags(');
    expect(server).toContain('export function buildSitemap(');
    expect(server).toContain('export function buildRobotsTxt(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/seo.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('escapes every value for its context (no broken tags / no markup injection)', () => {
    expect(server).toContain('const escapeHtml =');
    expect(server).toContain("replace(/&/g, '&amp;')");
    expect(server).toContain("replace(/</g, '&lt;')");
    expect(server).toContain('escapeHtml(m.title)');
    expect(server).toContain('escapeHtml(e.loc)'); // sitemap loc escaped too
  });

  it('renders OpenGraph + Twitter card so shared links get a preview', () => {
    expect(server).toContain('property="og:title"');
    expect(server).toContain('property="og:image"');
    expect(server).toContain('name="twitter:card"');
    expect(server).toContain("m.image ? 'summary_large_image' : 'summary'");
  });

  it('builds a valid sitemap (clamped priority) and a robots.txt with the sitemap ref', () => {
    expect(server).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(server).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(server).toContain('Math.min(Math.max(e.priority, 0), 1).toFixed(1)');
    expect(server).toContain("'Sitemap: '");
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/seo.ts']);
    expect(c.instructions.toLowerCase()).toContain('sitemap');
  });
});
