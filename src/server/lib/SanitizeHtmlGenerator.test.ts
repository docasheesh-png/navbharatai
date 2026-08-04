import { describe, it, expect } from 'vitest';
import { generateSanitizeHtmlIntegration } from './SanitizeHtmlGenerator';

describe('generateSanitizeHtmlIntegration', () => {
  const c = generateSanitizeHtmlIntegration();
  const server = c.files['server/lib/sanitize.ts'];

  it('emits sanitizeHtml + sanitizeToText built on sanitize-html', () => {
    expect(server).toContain("import sanitizeHtmlLib from 'sanitize-html'");
    expect(server).toContain('export function sanitizeHtml(');
    expect(server).toContain('export function sanitizeToText(');
    expect(c.files['src/lib/sanitize.ts']).toBeUndefined(); // server-side
  });

  it('uses an allowlist (never a regex stripper) and discards disallowed tags', () => {
    expect(server).toContain('allowedTags:');
    expect(server).toContain("disallowedTagsMode: 'discard'");
    // script/iframe must NOT be in the allowed set
    expect(server).not.toContain("'script'");
    expect(server).not.toContain("'iframe'");
  });

  it('restricts URL schemes and hardens surviving links', () => {
    expect(server).toContain("allowedSchemes: ['http', 'https', 'mailto']");
    expect(server).toContain("rel: 'noopener noreferrer'");
  });

  it('sanitizeToText strips all markup', () => {
    expect(server).toContain('allowedTags: [], allowedAttributes: {}');
  });

  it('declares sanitize-html, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'sanitize-html', version: '^2.13.0' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/sanitize.ts']);
    expect(c.instructions.toLowerCase()).toContain('xss');
  });
});
