import { describe, it, expect } from 'vitest';
import { scanCommentLanguage, scanProjectCommentLanguage, commentLanguageSummary } from './CommentLanguageAnalysis';

describe('scanCommentLanguage — flag Hindi/Devanagari in CODE COMMENTS only', () => {
  it('flags a `//` line comment written in Hindi', () => {
    const code = 'const x = 1; \n// यह एक टिप्पणी है\nconst y = 2;';
    const issues = scanCommentLanguage('src/a.ts', code);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'src/a.ts', line: 2, kind: 'non-english-comment', severity: 'low' });
  });

  it('flags a /* … */ block comment written in Hindi', () => {
    const code = '/*\n * यह ब्लॉक टिप्पणी है\n */\nexport const A = 1;';
    const issues = scanCommentLanguage('src/a.ts', code);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
  });

  it('flags an HTML <!-- … --> comment written in Hindi', () => {
    const code = '<div></div>\n<!-- यह HTML टिप्पणी है -->';
    expect(scanCommentLanguage('index.html', code)).toHaveLength(1);
  });

  // ⚠️ THE CRITICAL PRECISION CASES — Hindi UI is a feature and must NEVER be flagged.
  it('does NOT flag a Hindi string literal (a legitimate UI label)', () => {
    const code = 'const label = "नमस्ते दुनिया";\nconst title = `स्वागत है`;';
    expect(scanCommentLanguage('src/a.tsx', code)).toHaveLength(0);
  });

  it('does NOT flag Hindi JSX/HTML text content (visible UI)', () => {
    const code = 'export const H = () => <p>नमस्ते, आपका स्वागत है</p>;';
    expect(scanCommentLanguage('src/H.tsx', code)).toHaveLength(0);
  });

  it('does NOT flag Hindi in the HTML <body> text (only in <!-- --> comments)', () => {
    const code = '<h1>नमस्ते</h1><button>जमा करें</button>';
    expect(scanCommentLanguage('index.html', code)).toHaveLength(0);
  });

  it('does NOT flag an English comment', () => {
    const code = '// this is a normal English comment\nconst x = 1;';
    expect(scanCommentLanguage('src/a.ts', code)).toHaveLength(0);
  });

  it('does NOT treat a `//` inside a URL string as a comment', () => {
    const code = 'const u = "https://उदाहरण.com/पथ";'; // Hindi inside a string that also contains //
    expect(scanCommentLanguage('src/a.ts', code)).toHaveLength(0);
  });

  it('treats `#` as a comment only in hash-comment languages, not CSS', () => {
    const cssIdSelector = '#शीर्षक { color: red; }'; // `#` here is a CSS id selector, not a comment
    expect(scanCommentLanguage('styles.css', cssIdSelector)).toHaveLength(0);
    const pyComment = '# यह पायथन टिप्पणी है\nx = 1';
    expect(scanCommentLanguage('main.py', pyComment)).toHaveLength(1);
  });

  it('returns [] for empty / non-string input', () => {
    expect(scanCommentLanguage('a.ts', '')).toHaveLength(0);
    // @ts-expect-error — defensive: non-string input never throws
    expect(scanCommentLanguage('a.ts', null)).toHaveLength(0);
  });
});

describe('scanProjectCommentLanguage — scans code files, skips vendored/test trees', () => {
  it('scans app code and skips node_modules/dist/test files', () => {
    const files: Record<string, string> = {
      'src/a.ts': '// हिंदी टिप्पणी\nconst a = 1;',
      'node_modules/pkg/b.ts': '// हिंदी टिप्पणी\nconst b = 1;',
      'src/a.test.ts': '// हिंदी टिप्पणी\nconst c = 1;',
      'README.md': '# हिंदी शीर्षक', // markdown docs are not governed here
    };
    expect(scanProjectCommentLanguage(files).map((i) => i.file)).toEqual(['src/a.ts']);
  });

  it('returns [] for an all-English project', () => {
    expect(scanProjectCommentLanguage({ 'src/a.ts': '// english only\nconst a = 1;' })).toHaveLength(0);
  });
});

describe('commentLanguageSummary — honest agent-facing report', () => {
  it('reports a clean pass with no findings', () => {
    expect(commentLanguageSummary([])).toContain('✓ All code comments are in English');
  });

  it('explains the rule and that Hindi UI is fine', () => {
    const out = commentLanguageSummary(scanCommentLanguage('src/a.ts', '// यह टिप्पणी है\n'));
    expect(out).toContain('English');
    expect(out).toContain('Hindi UI text is fine');
  });
});
