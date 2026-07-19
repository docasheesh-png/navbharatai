import { describe, it, expect } from 'vitest';
import { generateEmailTemplateIntegration } from './EmailTemplateGenerator';

describe('generateEmailTemplateIntegration', () => {
  const c = generateEmailTemplateIntegration();
  const server = c.files['server/lib/emailTemplate.ts'];

  it('emits renderEmail returning both html + text, dependency-free and server-side', () => {
    expect(server).toContain('export function renderEmail(');
    expect(server).toContain('): { html: string; text: string }');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/emailTemplate.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('uses table layout + inline styles (Outlook/Gmail-safe), not divs/flex', () => {
    expect(server).toContain('role="presentation"');
    expect(server).toContain('width="600"');
    expect(server).not.toContain('display:flex');
    // uses INLINE styles on elements (email clients strip <style> blocks) — no actual <style> block emitted
    expect(server).toContain('style="margin:0;padding:0;background:');
    expect(server).not.toContain('<style>');
  });

  it('escapes every interpolated value so a name/amount can never break the markup', () => {
    expect(server).toContain('const escapeHtml =');
    expect(server).toContain('escapeHtml(opts.heading)');
    expect(server).toContain('escapeHtml(p)'); // each body paragraph
    expect(server).toContain('escapeHtml(opts.button.url)');
  });

  it('produces a matching plain-text body (multipart — stays out of spam) and a hidden preheader', () => {
    expect(server).toContain('const text = [opts.heading');
    expect(server).toContain('display:none;max-height:0;overflow:hidden'); // preheader
    expect(server).toContain('button.text}: ${opts.button.url'); // button surfaced in text
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/emailTemplate.ts']);
    expect(c.instructions.toLowerCase()).toContain('renderemail');
  });
});
