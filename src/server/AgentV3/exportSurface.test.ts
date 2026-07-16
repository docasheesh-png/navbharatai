import { describe, it, expect, afterEach } from 'vitest';
import {
  scriptExportSurface,
  cssExportSurface,
  exportSurfaceOf,
  signatureDependencyContext,
  signatureContextEnabled,
} from './exportSurface';
import { dependencyContext } from './SimpleBuilder';

afterEach(() => { delete process.env.AGENTV3_SIGNATURE_CONTEXT; });

describe('scriptExportSurface — TS/TSX export extraction', () => {
  it('keeps a function EXPORT SIGNATURE and drops its implementation body', () => {
    const src = [
      'const secret = 42;',
      'export function formatCurrency(amount: number, locale?: string): string {',
      '  const SECRET_IMPL = amount * 1.18;',
      '  return `₹${SECRET_IMPL.toFixed(2)}`;',
      '}',
    ].join('\n');
    const out = scriptExportSurface(src)!;
    expect(out).toContain('export function formatCurrency(amount: number, locale?: string): string { … }');
    expect(out).not.toContain('SECRET_IMPL');
    expect(out).not.toContain('const secret');
  });

  it('keeps interfaces and enums IN FULL (consumers must copy shapes/members exactly)', () => {
    const src = [
      'export interface Expense {',
      '  id: string;',
      '  amount: number;',
      '  category: Category;',
      '}',
      'export enum Category {',
      '  Food = "Food",',
      '  Travel = "Travel",',
      '}',
    ].join('\n');
    const out = scriptExportSurface(src)!;
    expect(out).toContain('category: Category;');
    expect(out).toContain('Travel = "Travel",');
  });

  it('trims an exported const/arrow to its head', () => {
    const out = scriptExportSurface('export const useNotes = (initial: Note[]) => {\n  return useState(initial);\n};')!;
    expect(out).toContain('export const useNotes = …;');
    expect(out).not.toContain('useState');
  });

  it('keeps one-line type aliases, export lists and default exports', () => {
    const src = [
      "export type ID = string;",
      "export { helperA, helperB };",
      "export default App;",
    ].join('\n');
    const out = scriptExportSurface(src)!;
    expect(out).toContain('export type ID = string;');
    expect(out).toContain('export { helperA, helperB };');
    expect(out).toContain('export default App;');
  });

  it('returns null when a file has no exports (caller falls back to the body)', () => {
    expect(scriptExportSurface('const a = 1;\nconsole.log(a);')).toBeNull();
  });
});

describe('cssExportSurface — the vocabulary a consumer may reference', () => {
  it('extracts class names, ids, css vars and keyframes', () => {
    const css = ':root { --accent: #6366f1; }\n.card { padding: 1rem; }\n.card-title:hover { color: red; }\n#app { margin: 0; }\n@keyframes fadeIn { from { opacity: 0 } }';
    const out = cssExportSurface(css)!;
    expect(out).toContain('card');
    expect(out).toContain('card-title');
    expect(out).toContain('#app'.replace('#', '')); // ids listed by name
    expect(out).toContain('--accent');
    expect(out).toContain('fadeIn');
    expect(out).not.toContain('padding'); // rule bodies dropped
  });
});

describe('exportSurfaceOf — routing + fallback signal', () => {
  it('routes .css and .ts correctly and signals fallback (null) for unknown kinds', () => {
    expect(exportSurfaceOf('a.css', '.x{}')).toContain('x');
    expect(exportSurfaceOf('a.ts', 'export const A = 1;')).toContain('export const A');
    expect(exportSurfaceOf('index.html', '<html></html>')).toBeNull();
    expect(exportSurfaceOf('a.ts', '')).toBeNull();
  });
});

describe('signatureDependencyContext — the cheap, quality-preserving sibling context', () => {
  it('returns "" with no producers (same contract as dependencyContext)', () => {
    expect(signatureDependencyContext([])).toBe('');
  });

  it('renders EXPORTS blocks with exact names and omits implementation bodies', () => {
    const out = signatureDependencyContext([
      { path: 'src/utils/money.ts', content: 'export function inr(n: number): string {\n  return `₹${n.toFixed(2)}`;\n}' },
    ]);
    expect(out).toContain('<<<EXPORTS src/utils/money.ts>>>');
    expect(out).toContain('export function inr(n: number): string');
    expect(out).not.toContain('toFixed'); // body dropped
  });

  it('falls back to the capped BODY for files whose surface cannot be extracted (never worse)', () => {
    const out = signatureDependencyContext([{ path: 'index.html', content: '<div id="root"></div>' }]);
    expect(out).toContain('<div id="root"></div>');
  });

  it('QUALITY FIX — an export past the old 4000-char cap is VISIBLE here, hidden in the old dump', () => {
    const filler = `const pad = ${'"x"'.repeat(1)};\n${'// filler line\n'.repeat(300)}`; // > 4000 chars
    const src = `${filler}export function lateHelper(id: string): number { return 1; }`;
    expect(src.indexOf('lateHelper')).toBeGreaterThan(4000);
    const oldDump = dependencyContext([{ path: 'src/utils/big.ts', content: src }]);
    const surface = signatureDependencyContext([{ path: 'src/utils/big.ts', content: src }]);
    expect(oldDump).not.toContain('lateHelper'); // the old truncation defect
    expect(surface).toContain('lateHelper'); // the enhancement
  });

  it('is dramatically smaller than the full-body dump on realistic producers', () => {
    const body = `export interface Note { id: string; text: string }\nexport function useNotes() {\n${'  // impl\n'.repeat(150)}  return [];\n}`;
    const producers = Array.from({ length: 10 }, (_, i) => ({ path: `src/hooks/h${i}.ts`, content: body }));
    const full = dependencyContext(producers).length;
    const sig = signatureDependencyContext(producers).length;
    expect(sig).toBeLessThan(full * 0.4);
  });
});

describe('signatureContextEnabled — kill switch', () => {
  it('defaults ON; AGENTV3_SIGNATURE_CONTEXT=off disables', () => {
    expect(signatureContextEnabled()).toBe(true);
    process.env.AGENTV3_SIGNATURE_CONTEXT = 'off';
    expect(signatureContextEnabled()).toBe(false);
  });
});
