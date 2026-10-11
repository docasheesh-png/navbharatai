import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_ORIGINS } from '../src/server/lib/previewHost';

const html = readFileSync('public/preview-sandbox.html', 'utf8');
const docs = readFileSync('docs/ops/preview-origin.md', 'utf8');

describe('the preview sandbox host checks the sender', () => {
  it('ignores a message that is not from window.parent, or a parent with no isolation', () => {
    expect(html).toContain('e.source !== window.parent');
    expect(html).toContain('ALLOWED_PARENTS');
    expect(html).toContain('allowedParent === location.origin');
    // The ready ping stays targeted at the parent origin, never '*'.
    expect(html).toMatch(/__nbaiPreviewSandboxReady:\s*true\s*\},\s*allowedParent/);
  });

  it('allow-lists the same parent origins as APP_ORIGINS, including the Capacitor WebView', () => {
    for (const origin of APP_ORIGINS) expect(html).toContain(origin);
    expect(html).toContain('capacitor://localhost');
    expect(html).toMatch(/server\.url/);
  });

  it('the ops note says to update the allow-list and why capacitor://localhost is on it', () => {
    expect(docs).toContain('ALLOWED_PARENTS');
    expect(docs).toContain('capacitor://localhost');
    expect(docs).toContain('https://localhost');
    expect(docs).toContain('PREVIEW_ORIGIN');
    expect(docs).toMatch(/404/);
    expect(docs).toMatch(/no `?server\.url`?/);
  });
});
