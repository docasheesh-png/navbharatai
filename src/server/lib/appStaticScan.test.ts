import { describe, it, expect } from 'vitest';
import { scanFileStatic, scanFilesStatic, type StaticFinding } from './appStaticScan';

const cats = (fs: StaticFinding[]) => fs.map((f) => f.category);
const has = (fs: StaticFinding[], category: string) => fs.some((f) => f.category === category);

describe('appStaticScan — deterministic, precise file:line findings', () => {
  it('flags an empty catch block with the exact line', () => {
    const src = 'function f() {\n  try { risky(); } catch (e) {}\n}\n';
    const fs = scanFileStatic('src/a.ts', src);
    const ec = fs.find((f) => f.category === 'error-handling');
    expect(ec).toBeTruthy();
    expect(ec!.line).toBe(2);
    expect(ec!.source).toBe('static');
  });

  it('flags eval() as a high-severity security issue', () => {
    const fs = scanFileStatic('src/a.js', 'const x = eval(userInput);\n');
    const ev = fs.find((f) => f.category === 'security' && /eval/i.test(f.problem));
    expect(ev).toBeTruthy();
    expect(ev!.severity).toBe('high');
  });

  it('flags leftover debugger and console.log but not in comments', () => {
    const src = [
      'debugger;',            // 1 → flagged
      'console.log("hi");',   // 2 → flagged
      '// console.log("x");', // 3 → comment, not flagged
      '// debugger;',         // 4 → comment, not flagged
    ].join('\n');
    const fs = scanFileStatic('src/a.ts', src);
    expect(fs.filter((f) => f.category === 'cleanup' && f.line === 1)).toHaveLength(1);
    expect(fs.filter((f) => f.category === 'cleanup' && f.line === 2)).toHaveLength(1);
    expect(fs.some((f) => f.line === 3 || f.line === 4)).toBe(false);
  });

  it('does not flag console.log inside test files', () => {
    const fs = scanFileStatic('src/a.test.ts', 'console.log("debug");\n');
    expect(has(fs, 'cleanup')).toBe(false);
  });

  it('flags TODO / FIXME markers', () => {
    const fs = scanFileStatic('src/a.ts', 'const x = 1; // TODO: handle the null case\n');
    expect(has(fs, 'incomplete')).toBe(true);
  });

  it('detects a real hardcoded key but ignores env indirection and placeholders', () => {
    const real = scanFileStatic('src/cfg.ts', 'const key = "AKIAIOSFODNN7EXAMPLE1";\n');
    // AKIA + 16 uppercase/digits → matches the AWS shape
    const leaked = scanFileStatic('src/cfg.ts', 'const k = "AKIA1234567890ABCDEF";\n');
    expect(leaked.some((f) => f.category === 'security')).toBe(true);

    // env indirection is NOT a leak
    const env = scanFileStatic('src/cfg.ts', 'const apiKey = process.env.API_KEY;\n');
    expect(env.some((f) => f.category === 'security')).toBe(false);

    // obvious placeholder is NOT a leak
    const ph = scanFileStatic('src/cfg.ts', 'const password = "your-password-here";\n');
    expect(ph.some((f) => f.category === 'security')).toBe(false);
    expect(real).toBeDefined();
  });

  it('flags a generic password literal that looks real', () => {
    const fs = scanFileStatic('src/cfg.ts', 'const password = "Pa55w0rd!Xy9Qz";\n');
    const s = fs.find((f) => f.category === 'security');
    expect(s).toBeTruthy();
    expect(s!.severity).toBe('high');
  });

  it('flags `as any` type escapes but not in comments', () => {
    const fs = scanFileStatic('src/a.ts', 'const x = foo as any;\n// cast as any here\n');
    const anyHits = fs.filter((f) => f.category === 'type-safety');
    expect(anyHits).toHaveLength(1);
    expect(anyHits[0].line).toBe(1);
  });

  it('skips minified / very long lines (no regex blowup, no noise)', () => {
    const long = 'a'.repeat(3000) + ' eval( ' + 'b'.repeat(3000);
    const fs = scanFileStatic('src/min.js', long + '\n');
    expect(fs).toHaveLength(0);
  });

  it('flags an oversized file once, at line 1', () => {
    const big = Array.from({ length: 1300 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const fs = scanFileStatic('src/big.ts', big);
    const large = fs.filter((f) => f.category === 'maintainability');
    expect(large).toHaveLength(1);
    expect(large[0].line).toBe(1);
  });

  it('caps repeated hits per rule per file so one file cannot flood the report', () => {
    const many = Array.from({ length: 60 }, () => 'console.log(1);').join('\n');
    const fs = scanFileStatic('src/spammy.ts', many);
    expect(fs.filter((f) => f.category === 'cleanup').length).toBeLessThanOrEqual(20);
  });

  it('scanFilesStatic walks a whole file map in stable order', () => {
    const fs = scanFilesStatic({
      'src/a.ts': 'debugger;\n',
      'src/b.ts': 'eval(x);\n',
    });
    expect(fs.length).toBeGreaterThanOrEqual(2);
    expect(cats(fs)).toContain('cleanup');
    expect(cats(fs)).toContain('security');
  });

  it('ignores non-code files for code rules (but still checks secrets)', () => {
    const md = scanFileStatic('README.md', 'debugger;\nconsole.log("x");\n');
    expect(md.some((f) => f.category === 'cleanup')).toBe(false);
    const mdSecret = scanFileStatic('README.md', 'token = "ghp_ABCDEFGHIJ1234567890abcdefghij"\n');
    expect(mdSecret.some((f) => f.category === 'security')).toBe(true);
  });
});
