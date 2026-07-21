import { describe, it, expect } from 'vitest';
import { scanCsp, scanProjectCsp, cspSummary } from './CspMetaAnalysis';

describe('scanCsp — flag a page loading third-party scripts with no CSP meta', () => {
  it('flags an HTML with an absolute cross-origin script and no CSP meta', () => {
    const html = '<html><head><script src="https://cdn.example.com/lib.js"></script></head></html>';
    const issues = scanCsp('index.html', html);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'index.html', externalScriptCount: 1, kind: 'missing-csp-meta', severity: 'low' });
  });

  it('does NOT flag when a CSP meta is already present', () => {
    const html = [
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
      '<script src="https://cdn.example.com/lib.js"></script>',
    ].join('\n');
    expect(scanCsp('index.html', html)).toHaveLength(0);
  });

  it('does NOT flag when only first-party scripts load (no external origin to fence)', () => {
    const html = [
      '<script src="/assets/main.js"></script>',
      '<script src="./bundle.js"></script>',
      '<script>console.log("inline")</script>',
    ].join('\n');
    expect(scanCsp('index.html', html)).toHaveLength(0);
  });

  it('counts every external script but reports one issue per file', () => {
    const html = [
      '<script src="https://a.cdn/one.js"></script>',
      "<script src='http://b.cdn/two.js'></script>",
      '<script src="/local.js"></script>',
    ].join('\n');
    const issues = scanCsp('public/index.html', html);
    expect(issues).toHaveLength(1);
    expect(issues[0].externalScriptCount).toBe(2);
  });

  it('returns [] for empty / non-string input', () => {
    expect(scanCsp('index.html', '')).toHaveLength(0);
    // @ts-expect-error — defensive: non-string input never throws
    expect(scanCsp('index.html', null)).toHaveLength(0);
  });
});

describe('scanProjectCsp — static SPA only, skips vendored/test trees', () => {
  it('flags a static SPA page with an unfenced third-party script', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="https://cdn.example.com/a.js"></script>',
      'src/App.tsx': 'export const App = () => null;',
    };
    const issues = scanProjectCsp(files);
    expect(issues.map((i) => i.file)).toEqual(['index.html']);
  });

  it('does NOT flag when the build has a backend (server should use a CSP header instead)', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="https://cdn.example.com/a.js"></script>',
      'server.ts': 'import express from "express"; const app = express();',
    };
    // A server exists → CSP belongs in an HTTP header (SecurityHeadersAnalysis owns that), so this pass stays silent.
    expect(scanProjectCsp(files)).toHaveLength(0);
  });

  it('skips node_modules / dist / test HTML', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="https://cdn.example.com/a.js"></script>',
      'node_modules/pkg/demo.html': '<script src="https://cdn.example.com/skip.js"></script>',
      'dist/index.html': '<script src="https://cdn.example.com/skip2.js"></script>',
    };
    expect(scanProjectCsp(files).map((i) => i.file)).toEqual(['index.html']);
  });

  it('returns [] for a clean static SPA (all first-party scripts)', () => {
    expect(scanProjectCsp({ 'index.html': '<script src="/main.js"></script>' })).toHaveLength(0);
  });
});

describe('cspSummary — honest agent-facing report', () => {
  it('reports a clean pass when there are no findings', () => {
    expect(cspSummary([])).toContain('✓ No unfenced static-SPA script origins');
  });

  it('explains the gap and how to fix it', () => {
    const out = cspSummary(scanCsp('index.html', '<script src="https://cdn.example.com/lib.js"></script>'));
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain('script-src');
  });
});
