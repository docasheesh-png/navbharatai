import { describe, it, expect } from 'vitest';
import { prettierGateResult, prettierAdvisory } from './PrettierGate';

describe('prettierGateResult', () => {
  it('exit 0 = all formatted (ran, no advisory files)', () => {
    expect(prettierGateResult(0, 'Checking formatting...\nAll matched files use Prettier code style!', '')).toEqual({
      ran: true, formatted: true, count: 0, files: [],
    });
  });

  it('non-zero with [warn] lines = ran + lists the unformatted files', () => {
    const r = prettierGateResult(1, '[warn] src/App.tsx\n[warn] src/util/date.ts\n[warn] Code style issues found in 2 files. Run Prettier to fix.', '');
    expect(r.ran).toBe(true);
    expect(r.formatted).toBe(false);
    expect(r.files).toContain('src/App.tsx');
    expect(r.files).toContain('src/util/date.ts');
    expect(r.count).toBeGreaterThanOrEqual(2);
  });

  it('a missing-tool error → ran:false (never a false "needs formatting")', () => {
    expect(prettierGateResult(127, '', 'sh: prettier: command not found').ran).toBe(false);
    expect(prettierGateResult(1, '', 'npm error could not determine an executable to run').ran).toBe(false);
  });
});

describe('prettierAdvisory', () => {
  it('is empty when clean, could-not-run, or nothing to advise', () => {
    expect(prettierAdvisory({ ran: true, formatted: true, count: 0, files: [] })).toBe('');
    expect(prettierAdvisory({ ran: false, formatted: false, count: 0, files: [] })).toBe('');
    expect(prettierAdvisory({ ran: true, formatted: false, count: 0, files: [] })).toBe('');
  });

  it('renders a non-blocking advisory listing the unformatted files', () => {
    const out = prettierAdvisory({ ran: true, formatted: false, count: 2, files: ['src/App.tsx', 'src/util/date.ts'] });
    expect(out).toContain('Prettier: 2 file(s) are not formatted');
    expect(out).toContain('prettier --write');
    expect(out).toContain('does not block the build');
    expect(out).toContain('• src/App.tsx');
  });

  it('caps the file list and signals there are more', () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const out = prettierAdvisory({ ran: true, formatted: false, count: 12, files });
    expect(out).toContain('…and more');
    expect(out.split('•')).toHaveLength(9); // 8 files listed + the head segment
  });
});
