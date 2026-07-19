import { describe, it, expect } from 'vitest';
import { generateMarkdownIntegration } from './MarkdownGenerator';

describe('generateMarkdownIntegration', () => {
  const c = generateMarkdownIntegration();
  const server = c.files['server/lib/markdown.ts'];

  it('emits renderMarkdown built on marked + sanitize-html, server-side', () => {
    expect(server).toContain("import { marked } from 'marked'");
    expect(server).toContain("import sanitizeHtmlLib from 'sanitize-html'");
    expect(server).toContain('export function renderMarkdown(');
    expect(c.files['src/lib/markdown.ts']).toBeUndefined();
  });

  it('is SAFE BY CONSTRUCTION — renders AND sanitizes in one call', () => {
    expect(server).toContain('marked.parse(');
    expect(server).toContain('return sanitizeHtmlLib(rawHtml');
    expect(server).toContain("disallowedTagsMode: 'discard'");
    expect(server).toContain("allowedSchemes: ['http', 'https', 'mailto']");
    // script/iframe are NOT in the allowlist
    expect(server).not.toContain("'script'");
    expect(server).not.toContain("'iframe'");
  });

  it('keeps a rich subset (tables, code) and hardens links', () => {
    expect(server).toContain("'table'");
    expect(server).toContain("'pre', 'code'");
    expect(server).toContain("rel: 'noopener noreferrer'");
  });

  it('declares both dependencies, no env keys, no .env.example', () => {
    expect(c.dependencies).toEqual([
      { name: 'marked', version: '^12.0.0' },
      { name: 'sanitize-html', version: '^2.13.0' },
    ]);
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/markdown.ts']);
    expect(c.instructions.toLowerCase()).toContain('sanitize');
  });
});
