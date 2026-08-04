import { describe, it, expect } from 'vitest';
import { scanSri, scanProjectSri, sriSummary } from './SriAnalysis';

describe('scanSri — flag third-party <script> without an integrity hash', () => {
  it('flags an absolute cross-origin script with no integrity', () => {
    const html = '<html><head><script src="https://cdn.example.com/lib.js"></script></head></html>';
    const issues = scanSri('index.html', html);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'index.html', url: 'https://cdn.example.com/lib.js', kind: 'missing-sri', severity: 'medium' });
  });

  it('does NOT flag a script that already has an integrity attribute', () => {
    const html = '<script src="https://cdn.example.com/lib.js" integrity="sha384-abc" crossorigin="anonymous"></script>';
    expect(scanSri('index.html', html)).toHaveLength(0);
  });

  it('does NOT flag first-party scripts (relative, root-absolute, or module) — no third-party tamper risk', () => {
    const html = [
      '<script src="/assets/main.js"></script>',
      '<script src="./bundle.js"></script>',
      '<script type="module" src="/src/main.tsx"></script>',
      '<script>console.log("inline")</script>',
    ].join('\n');
    expect(scanSri('index.html', html)).toHaveLength(0);
  });

  it('does NOT flag data:/blob: script srcs', () => {
    const html = '<script src="data:text/javascript,alert(1)"></script><script src="blob:https://x/abc"></script>';
    expect(scanSri('index.html', html)).toHaveLength(0);
  });

  it('flags multiple unprotected external scripts and ignores a protected one among them', () => {
    const html = [
      '<script src="https://a.cdn/one.js"></script>',
      '<script src="https://b.cdn/two.js" integrity="sha384-xyz"></script>',
      "<script src='http://c.cdn/three.js'></script>",
    ].join('\n');
    const issues = scanSri('public/index.html', html);
    expect(issues.map((i) => i.url)).toEqual(['https://a.cdn/one.js', 'http://c.cdn/three.js']);
  });

  it('returns [] for empty / non-string input', () => {
    expect(scanSri('index.html', '')).toHaveLength(0);
    // @ts-expect-error — defensive: non-string input never throws
    expect(scanSri('index.html', null)).toHaveLength(0);
  });
});

describe('scanProjectSri — scans HTML files only, skips vendored/test trees', () => {
  it('scans app HTML and skips node_modules/dist/test HTML', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="https://cdn.example.com/a.js"></script>',
      'public/app.html': '<script src="https://cdn.example.com/b.js"></script>',
      'node_modules/pkg/demo.html': '<script src="https://cdn.example.com/skip.js"></script>',
      'dist/index.html': '<script src="https://cdn.example.com/skip2.js"></script>',
      'src/App.tsx': '<script src="https://cdn.example.com/not-html.js"></script>', // not an HTML file
    };
    const issues = scanProjectSri(files);
    expect(issues.map((i) => i.file).sort()).toEqual(['index.html', 'public/app.html']);
  });

  it('returns [] for a clean project (all first-party or hash-pinned)', () => {
    expect(scanProjectSri({ 'index.html': '<script src="/main.js"></script>' })).toHaveLength(0);
  });
});

describe('sriSummary — honest agent-facing report', () => {
  it('reports a clean pass when there are no findings', () => {
    expect(sriSummary([])).toContain('✓ No unprotected third-party scripts');
  });

  it('names each unprotected script and how to fix it', () => {
    const out = sriSummary(scanSri('index.html', '<script src="https://cdn.example.com/lib.js"></script>'));
    expect(out).toContain('https://cdn.example.com/lib.js');
    expect(out).toContain('integrity');
  });
});
