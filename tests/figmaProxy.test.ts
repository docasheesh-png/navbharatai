import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Figma Import + Multi-Page real path (admin autopsy 2026-07-21). Figma called api.figma.com directly
 * (CORS-blocked) and both tools had dead /api/generate calls. These tests lock the real wiring: the
 * server proxy exists, the client uses it, and no dead-route call survives.
 */
const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('Figma proxy route', () => {
  it('is registered on the server', () => {
    expect(read('../src/server/routes/figmaProxy.ts')).toContain("app.post('/api/figma/proxy'");
    expect(read('../server.ts')).toContain('registerFigmaProxyRoutes(app)');
  });
  it('only fetches the fixed Figma host (no SSRF surface) and validates the file key', () => {
    const src = read('../src/server/routes/figmaProxy.ts');
    expect(src).toContain('https://api.figma.com/v1/files/');
    expect(src).toMatch(/A-Za-z0-9_-/); // fileKey format guard
  });
});

describe('FigmaImporter — real proxy + Pro v5 handoff', () => {
  it('calls the proxy, not api.figma.com directly, and refine hands off to Pro v5', () => {
    const src = read('../src/components/ide/FigmaImporter.tsx');
    expect(src).toContain('/api/figma/proxy');
    expect(src).not.toMatch(/fetch\(`\$\{FIGMA_API\}/);
    expect(src).not.toContain("fetch('/api/generate'");
    expect(src).toContain('onBuildViaV5');
  });
});

describe('MultiPageBuilder — dead AI button now builds via Pro v5', () => {
  it('no longer calls the dead /api/generate; the button hands off to Pro v5', () => {
    const src = read('../src/components/ide/MultiPageBuilder.tsx');
    expect(src).not.toContain("fetch('/api/generate'");
    expect(src).toContain('onBuildViaV5');
  });
});
