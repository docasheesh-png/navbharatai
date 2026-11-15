import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  USE_CASES, USE_CASE_INDEX_PATH, assertUseCaseCatalog, useCaseBySlug, useCasePath,
} from '../src/server/lib/useCaseCatalog';
import { renderUseCaseIndex, renderUseCaseMissing, renderUseCasePage } from '../src/server/lib/useCasePages';
import { publicSitePaths, robotsTxt, sitemapXml } from '../src/server/lib/siteIndex';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { escapeHtml } from '../src/server/lib/legalMarkdown';
import { readUseCaseRequest, useCasePromptUrl } from '../src/lib/useCaseEntry';

const ORIGIN = 'https://navbharatai.com';
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const VENDORS = /\b(OpenAI|ChatGPT|GPT-\d|Anthropic|Claude|Gemini|Qwen|DeepSeek|GLM|Z\.ai|Zhipu|Kimi|Mistral|Llama|Sarvam|Qubax|Mitrify|Surplus|CheaperInference|OpenRouter|Groq|Moonshot|Nemotron|NVIDIA)\b/;

describe('curated use-case pages', () => {
  it('has at least 20 unique, non-thin ideas and no catalog problems', () => {
    expect(assertUseCaseCatalog()).toEqual([]);
    expect(USE_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('renders Hindi-first HTML a crawler can read, with one CTA into the builder', () => {
    for (const page of USE_CASES) {
      const html = renderUseCasePage(page, ORIGIN);
      const url = `${ORIGIN}${useCasePath(page.slug)}`;
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain(`content="${escapeHtml(page.description)}"`);
      expect(html).toContain(`rel="canonical" href="${url}"`);
      expect(html).toContain('hreflang="hi"');
      expect(html).toContain('hreflang="en"');
      expect(html).toContain('og:title');
      expect(html).toContain('SoftwareApplication');
      expect(html).toContain('FAQPage');
      expect(html).toContain(`/?usecase=${page.slug}&amp;source=seo`);
      expect(html).toContain('अपने लिए यह app 2 मिनट में बनाओ');
      expect(html).toContain('Build this app for yourself');
      expect(html).toContain('काल्पनिक');
      expect(html).toContain('NavBharatAI engine');
      expect(text(html).split(/\s+/).length).toBeGreaterThan(250);
      expect(html).not.toMatch(VENDORS);
      expect(html).not.toContain('/store/app/');
    }
  });

  it('the index lists every idea and does not publish a user app', () => {
    const html = renderUseCaseIndex(ORIGIN);
    for (const page of USE_CASES) expect(html).toContain(`href="${useCasePath(page.slug)}"`);
    expect(html).not.toMatch(VENDORS);
    expect(text(html)).toMatch(/not a public directory/);
  });

  it('an unknown slug is a 404 page, not a soft copy of the homepage, and is not in the sitemap', () => {
    const html = renderUseCaseMissing(ORIGIN);
    expect(html).toContain('noindex');
    expect(sitemapXml(ORIGIN)).not.toContain('/app/not-a-real-shop');
    expect(useCaseBySlug('not-a-real-shop')).toBeNull();
    expect(useCaseBySlug('../admin')).toBeNull();
  });

  it('sitemap and robots include the ideas and hide admin and private routes', () => {
    const paths = publicSitePaths();
    expect(paths).toContain(USE_CASE_INDEX_PATH);
    expect(paths).toContain('/ai-app-builder');
    for (const page of USE_CASES) {
      expect(paths).toContain(useCasePath(page.slug));
      expect(spaFallbackShouldDefer(useCasePath(page.slug))).toBe(true);
    }
    expect(spaFallbackShouldDefer(USE_CASE_INDEX_PATH)).toBe(true);
    expect(spaFallbackShouldDefer('/app/not-a-real-shop')).toBe(true);
    const xml = sitemapXml(ORIGIN);
    const robots = robotsTxt(ORIGIN);
    expect(xml).toContain(`${ORIGIN}/apps`);
    expect(xml).toContain(`${ORIGIN}/app/kirana-billing-app`);
    expect(xml).toContain(`${ORIGIN}/ai-app-builder`);
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/api/');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(xml + robots).not.toMatch(VENDORS);
  });

  it('the builder request is a slug, and the prompt is loaded from our API', () => {
    expect(readUseCaseRequest('?usecase=kirana-billing-app&source=seo')).toEqual({ slug: 'kirana-billing-app', source: 'seo' });
    expect(readUseCaseRequest('?usecase=../admin&source=seo')).toBeNull();
    expect(readUseCaseRequest('')).toBeNull();
    expect(useCasePromptUrl('kirana-billing-app')).toBe('/api/use-cases/kirana-billing-app');
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(app).toContain('useUseCaseEntry');
    expect(panel).toContain('USE_CASE_PROMPT_KEY');
    expect(readFileSync(join(process.cwd(), 'server.ts'), 'utf8')).toContain('registerUseCaseRoutes(app)');
  });
});
