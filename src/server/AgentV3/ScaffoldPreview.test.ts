import { describe, it, expect } from 'vitest';
import { ViteReactProvider } from './sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { architectSystemPrompt } from './systemPrompt';

// Regression guard for the "Blocked request … is not allowed" preview failure: newer Vite blocks
// the sandbox proxy host (<port>-<id>.e2b.app) unless server.allowedHosts is set. Both the default
// scaffold AND the architect's guidance must carry allowedHosts so the preview always loads.
describe('preview host allow-listing (Vite)', () => {
  it('the default Vite scaffold sets allowedHosts on server AND preview', () => {
    const files = new ViteReactProvider().getFiles([]);
    const cfgKey = Object.keys(files).find((k) => /vite\.config\.(t|j)s$/.test(k));
    expect(cfgKey).toBeTruthy();
    const cfg = files[cfgKey as string];
    // Both blocks must allow the proxy host, or the preview shows "Blocked request".
    expect(cfg).toMatch(/server:\s*\{[^}]*allowedHosts:\s*true/);
    expect(cfg).toMatch(/preview:\s*\{[^}]*allowedHosts:\s*true/);
  });

  it('the architect prompt instructs setting allowedHosts for Vite previews', () => {
    const prompt = architectSystemPrompt();
    expect(prompt).toContain('allowedHosts');
    expect(prompt.toLowerCase()).toContain('blocked request');
  });
});
