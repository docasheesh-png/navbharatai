import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HOW_IT_WORKS_PATH, renderHowItWorksPage, howItWorksFacts } from '../src/server/lib/howItWorksPage';
import { GUEST_DAILY_DEFAULT, SIGNED_IN_DAILY_DEFAULT } from '../src/server/lib/unifiedWallet/policy';
import { publicSitePaths, sitemapXml } from '../src/server/lib/siteIndex';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';

const VENDORS = /\b(OpenAI|ChatGPT|GPT-\d|Anthropic|Claude|Gemini|Qwen|DeepSeek|GLM|Z\.ai|Zhipu|Kimi|Mistral|Llama|Sarvam|Qubax|Mitrify|Surplus|CheaperInference|OpenRouter|Groq|Moonshot|Nemotron|NVIDIA)\b/;

describe('/how-it-works', () => {
  const html = renderHowItWorksPage('https://navbharatai.com');

  it('is bilingual, honest, and names no AI vendor', () => {
    expect(html).toContain('फाउंडेशन मॉडल');
    expect(html).toContain('has not trained a foundation model');
    expect(html).toContain('specially trained router');
    expect(html).toContain('same conversation');
    expect(html).toContain('NavBharatAI engine');
    expect(html).toContain(`${GUEST_DAILY_DEFAULT}`);
    expect(html).toContain(`${SIGNED_IN_DAILY_DEFAULT}`);
    expect(howItWorksFacts().guest).toBe(10);
    expect(howItWorksFacts().signedIn).toBe(50);
    expect(html).not.toMatch(VENDORS);
    expect(html).not.toMatch(/fine-tuned router|fine tuned verifier/i);
    expect(html).toContain('rel="canonical" href="https://navbharatai.com/how-it-works"');
    expect(html).toContain('hreflang="hi"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('<title>');
  });

  it('is a public page the crawler reaches, linked from the footer', () => {
    expect(publicSitePaths()).toContain(HOW_IT_WORKS_PATH);
    expect(sitemapXml('https://navbharatai.com')).toContain('https://navbharatai.com/how-it-works');
    expect(spaFallbackShouldDefer(HOW_IT_WORKS_PATH)).toBe(true);
    expect(readFileSync('src/server/lib/legalMarkdown.ts', 'utf8')).toContain("'/how-it-works'");
    expect(readFileSync('src/components/home/HomeView.tsx', 'utf8')).toContain("'/how-it-works'");
    expect(readFileSync('server.ts', 'utf8')).toContain('registerHowItWorksRoute(app)');
  });
});
