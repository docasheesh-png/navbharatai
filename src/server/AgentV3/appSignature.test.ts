import { describe, it, expect } from 'vitest';
import {
  injectAppSignature,
  hasAppSignature,
  appSignatureHtml,
  APP_SIGNATURE_MARKER,
  APP_SIGNATURE_URL,
  APP_SIGNATURE_LABEL,
} from './appSignature';

const DOC = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

describe('appSignatureHtml — the badge markup', () => {
  it('links to navbharatai.com, opens a new tab safely, and shows the label', () => {
    const b = appSignatureHtml();
    expect(b).toContain(`href="${APP_SIGNATURE_URL}"`);
    expect(b).toContain('target="_blank"');
    expect(b).toContain('rel="noopener noreferrer"');
    expect(b).toContain(APP_SIGNATURE_LABEL);
    expect(b).toContain(APP_SIGNATURE_MARKER);
  });
  it('is fixed to the bottom-right corner with fully inline styles (no external deps)', () => {
    const b = appSignatureHtml();
    expect(b).toContain('position:fixed');
    expect(b).toContain('right:12px');
    expect(b).toContain('bottom:12px');
    expect(b).not.toMatch(/<link|<script|src=(?!"https:\/\/navbharatai)/); // no external resources
  });
});

describe('injectAppSignature — inserts the badge before </body>', () => {
  it('injects the badge just before the closing body tag', () => {
    const out = injectAppSignature(DOC);
    expect(hasAppSignature(out)).toBe(true);
    // Badge appears before </body>, and the original app content is untouched.
    expect(out.indexOf(APP_SIGNATURE_MARKER)).toBeLessThan(out.toLowerCase().lastIndexOf('</body>'));
    expect(out).toContain('<div id="root"></div>');
    expect(out).toContain('src="/src/main.tsx"');
  });

  it('is idempotent — running it twice never adds a second badge', () => {
    const once = injectAppSignature(DOC);
    const twice = injectAppSignature(once);
    expect(twice).toBe(once);
    const occurrences = twice.split(APP_SIGNATURE_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it('appends the badge when the document has no </body> (never silently dropped)', () => {
    const frag = `<main><h1>Hi</h1></main>`;
    const out = injectAppSignature(frag);
    expect(out.startsWith(frag)).toBe(true);
    expect(hasAppSignature(out)).toBe(true);
  });

  it('handles case-insensitive </BODY>', () => {
    const upper = `<html><BODY><p>x</p></BODY></html>`;
    const out = injectAppSignature(upper);
    expect(hasAppSignature(out)).toBe(true);
    expect(out.indexOf(APP_SIGNATURE_MARKER)).toBeLessThan(out.toLowerCase().lastIndexOf('</body>'));
  });

  it('leaves a blank/whitespace-only string unchanged (no document to sign)', () => {
    expect(injectAppSignature('')).toBe('');
    expect(injectAppSignature('   \n ')).toBe('   \n ');
  });

  it('uses the LAST </body> when several appear (nested/escaped)', () => {
    const doc = `<body>a</body><!-- note: </body> in comment --><body>real</body>`;
    const out = injectAppSignature(doc);
    // Injected before the final </body>, exactly once.
    expect(out.split(APP_SIGNATURE_MARKER).length - 1).toBe(1);
    expect(out.lastIndexOf(APP_SIGNATURE_MARKER)).toBeLessThan(out.toLowerCase().lastIndexOf('</body>'));
  });
});

describe('hasAppSignature', () => {
  it('detects a present badge and rejects a plain doc', () => {
    expect(hasAppSignature(injectAppSignature(DOC))).toBe(true);
    expect(hasAppSignature(DOC)).toBe(false);
    expect(hasAppSignature('')).toBe(false);
  });
});
