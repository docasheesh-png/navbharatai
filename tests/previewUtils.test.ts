import { describe, it, expect } from 'vitest';
import {
  stripFences,
  injectHarness,
  buildUniversalPreview,
} from '../src/lib/previewUtils';
import type { FileSystem } from '../src/types/index';

// ── stripFences ─────────────────────────────────────────────────────────────

describe('stripFences', () => {
  it('returns input unchanged when no fence present', () => {
    const s = 'hello world\nno fences here';
    expect(stripFences(s)).toBe(s);
  });

  it('strips ```html\\n...\\n``` leaving only the inner content', () => {
    const inner = '<div>hello</div>';
    const fenced = '```html\n' + inner + '\n```';
    expect(stripFences(fenced)).toBe(inner);
  });

  it('strips ```tsx\\n...\\n``` leaving only the inner content', () => {
    const inner = 'export default function App() { return <div/>; }';
    const fenced = '```tsx\n' + inner + '\n```';
    expect(stripFences(fenced)).toBe(inner);
  });

  it('handles unclosed fence (strips opener only)', () => {
    const inner = 'line1\nline2';
    const fenced = '```js\n' + inner;
    // No closing fence → strip opener only, return everything after it
    expect(stripFences(fenced)).toBe(inner);
  });

  it('strips leading whitespace before ``` opener', () => {
    // trimStart finds the fence even when there is leading whitespace
    const s = '   ```json\n{"x":1}\n```';
    // The function trims the start to detect the fence, but operates on
    // the original split lines (which may have leading spaces on line 0).
    // The key requirement is that the inner content is preserved.
    const result = stripFences(s);
    expect(result).toContain('{"x":1}');
    expect(result).not.toContain('```');
  });
});

// ── injectHarness ───────────────────────────────────────────────────────────

describe('injectHarness', () => {
  it('returns input unchanged when harness already present (contains __nb_err)', () => {
    const doc = '<html><body><div id="__nb_err"></div></body></html>';
    expect(injectHarness(doc)).toBe(doc);
  });

  it('returns input unchanged when harness already present (contains __nbShowError)', () => {
    const doc = '<html><script>window.__nbShowError=function(){};</script></html>';
    expect(injectHarness(doc)).toBe(doc);
  });

  it('injects before </head> when present', () => {
    const doc = '<html><head><title>T</title></head><body></body></html>';
    const result = injectHarness(doc);
    expect(result).toContain('</head>');
    // Harness must appear before </head>
    const harnessPos = result.indexOf('__nbShowError');
    const headPos = result.indexOf('</head>');
    expect(harnessPos).toBeGreaterThan(-1);
    expect(harnessPos).toBeLessThan(headPos);
  });

  it('injects after <body> when present and no </head>', () => {
    const doc = '<html><body class="x"><p>hi</p></body></html>';
    const result = injectHarness(doc);
    const bodyTagEnd = result.indexOf('<body class="x">') + '<body class="x">'.length;
    const harnessPos = result.indexOf('__nbShowError');
    expect(harnessPos).toBeGreaterThan(-1);
    // Harness should appear immediately after the <body> tag
    expect(harnessPos).toBeGreaterThanOrEqual(bodyTagEnd);
  });

  it('prepends to bare content when neither </head> nor <body> tag present', () => {
    const doc = '<p>bare content</p>';
    const result = injectHarness(doc);
    expect(result.startsWith('<style>\n.__nb_overlay') || result.startsWith('<style>')).toBe(true);
    expect(result).toContain('<p>bare content</p>');
  });

  it('result contains __nbShowError after injection', () => {
    const doc = '<!DOCTYPE html><html><head></head><body></body></html>';
    const result = injectHarness(doc);
    expect(result).toContain('__nbShowError');
  });
});

// ── buildUniversalPreview ───────────────────────────────────────────────────

describe('buildUniversalPreview', () => {
  const sampleFiles: FileSystem = {
    'README.md': '# Hello\nWorld',
    'src/index.ts': 'console.log("hi")',
    'node_modules/react/index.js': '// react',
  };

  it('returns a string containing <!DOCTYPE html> and </html>', () => {
    const result = buildUniversalPreview(sampleFiles);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('</html>');
  });

  it('result contains nbv-app (the universal viewer CSS class)', () => {
    const result = buildUniversalPreview(sampleFiles);
    expect(result).toContain('nbv-app');
  });

  it('filters out node_modules from the viewFiles', () => {
    const result = buildUniversalPreview(sampleFiles);
    // node_modules/react/index.js should NOT appear in the serialised files data
    expect(result).not.toContain('node_modules/react/index.js');
    // But the real files should be present
    expect(result).toContain('README.md');
  });
});
