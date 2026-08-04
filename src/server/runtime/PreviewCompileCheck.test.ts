import { describe, it, expect } from 'vitest';
import {
  checkPreviewCompiles,
  previewBabelPresets,
  previewCompileRepairInstruction,
  previewDivergenceBlocksDelivery,
  previewCompileUnresolvedSummary,
} from './PreviewCompileCheck';

// Autopsy 2026-07-22 (buildId 91694679): the in-browser Babel preview can reject code that tsc + the
// E2B/vite preview accept, so "✅ Preview verified" shipped a white-screen. checkPreviewCompiles is the
// faithful server-side mirror of that in-browser transform — a throw here == a real in-browser failure.

const CLEAN_APP = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }),
  'src/main.tsx': "import App from './App';\nexport default function boot(){ return App; }",
  'src/App.tsx': "export default function App(){ return <div className='x'>Hi</div>; }",
  'src/util.ts': 'export const add = (a: number, b: number): number => a + b;',
};

describe('checkPreviewCompiles — faithful in-browser Babel dry-compile', () => {
  it('a clean React+TS app compiles with no errors', () => {
    const res = checkPreviewCompiles(CLEAN_APP);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.checked).toBe(3); // main.tsx, App.tsx, util.ts (package.json is not compilable)
  });

  it('a `declare` class field COMPILES here — mirrors the allowDeclareFields fix, no longer a divergence', () => {
    // This is the EXACT shape that white-screened the reported build. With allowDeclareFields it must now
    // pass here just as it does in the fixed in-browser preview — proving the mirror tracks the fix.
    const withDeclare = {
      ...CLEAN_APP,
      'src/ErrorBoundary.tsx':
        "import React from 'react';\n" +
        'interface Props { children: React.ReactNode; }\n' +
        'interface State { error: Error | null; }\n' +
        'class ErrorBoundary extends React.Component<Props, State> {\n' +
        '  declare state: State;\n' +
        '  declare props: Props;\n' +
        '  constructor(props: Props){ super(props); this.state = { error: null }; }\n' +
        '  render(){ return this.state.error ? <div>err</div> : this.props.children; }\n' +
        '}\n' +
        'export default ErrorBoundary;',
    };
    expect(checkPreviewCompiles(withDeclare).ok).toBe(true);
  });

  it('catches a genuinely Babel-incompatible file and reports {file, message}', () => {
    // Experimental decorators: tsc accepts them (experimentalDecorators), but the preview's Babel config
    // has no decorators plugin, so it throws — the exact kind of tsc-ok / preview-broken divergence this
    // check exists to catch.
    const broken = {
      ...CLEAN_APP,
      'src/legacy.ts': 'function d(t: unknown){ return t; }\n@d\nexport class Svc {}',
    };
    const res = checkPreviewCompiles(broken);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].file).toBe('src/legacy.ts');
    expect(res.errors[0].message.length).toBeGreaterThan(0);
  });

  it('a plain syntax error is caught', () => {
    const res = checkPreviewCompiles({ ...CLEAN_APP, 'src/bad.tsx': 'export const = 5;' });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.file === 'src/bad.tsx')).toBe(true);
  });

  it('ignores non-source files and node_modules', () => {
    const res = checkPreviewCompiles({
      'README.md': '# hi',
      'src/app.css': '.x{color:red}',
      'node_modules/pkg/index.js': 'syntax ) error (',
      'data.json': '{"a":1}',
    });
    expect(res.ok).toBe(true);
    expect(res.checked).toBe(0);
  });

  it('respects maxFiles cap', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 20; i++) many[`src/f${i}.ts`] = 'export const x = 1;';
    expect(checkPreviewCompiles(many, { maxFiles: 5 }).checked).toBe(5);
  });
});

describe('previewBabelPresets — matches the in-browser transform config', () => {
  it('a .tsx file gets the typescript preset with allowDeclareFields + isTSX', () => {
    const presets = previewBabelPresets('src/App.tsx') as Array<[string, Record<string, unknown>]>;
    const ts = presets.find((p) => p[0] === 'typescript');
    expect(ts).toBeTruthy();
    expect(ts![1].allowDeclareFields).toBe(true);
    expect(ts![1].isTSX).toBe(true);
    expect(ts![1].allExtensions).toBe(true);
  });

  it('a .jsx file gets only the react preset (no typescript preset)', () => {
    const presets = previewBabelPresets('src/App.jsx') as Array<[string, Record<string, unknown>]>;
    expect(presets.some((p) => p[0] === 'typescript')).toBe(false);
    expect(presets.some((p) => p[0] === 'react')).toBe(true);
  });
});

describe('previewCompileRepairInstruction', () => {
  it('lists the failing files + messages and steers away from config edits', () => {
    const instr = previewCompileRepairInstruction([
      { file: 'src/ErrorBoundary.tsx', message: "The 'declare' modifier is only allowed when …" },
    ]);
    expect(instr).toContain('src/ErrorBoundary.tsx');
    expect(instr).toContain('smallest possible edits');
    expect(instr).toContain('Do NOT add or edit tsconfig/babel config');
  });
});

// Billing honesty (autopsy 2026-08-01, buildId 1047276c — charged ₹88.82 for a preview that would not
// compile): an UNHEALED divergence in a guaranteed-reachable ENTRY file makes the build free + not-ok.
describe('previewDivergenceBlocksDelivery — only entry-file divergences block delivery', () => {
  it('BLOCKS when the failing file is an entry (src/App.tsx / src/main.tsx / index)', () => {
    expect(previewDivergenceBlocksDelivery([{ file: 'src/App.tsx', message: 'Duplicate declaration "Team"' }])).toBe(true);
    expect(previewDivergenceBlocksDelivery([{ file: 'src/main.tsx', message: 'Duplicate declaration "ErrorBoundary"' }])).toBe(true);
    expect(previewDivergenceBlocksDelivery([{ file: 'index.tsx', message: 'x' }])).toBe(true);
  });

  it('does NOT block a divergence only in a non-entry (possibly-unimported) file — respects the reachability limit', () => {
    expect(previewDivergenceBlocksDelivery([{ file: 'src/components/Widget.tsx', message: 'x' }])).toBe(false);
    expect(previewDivergenceBlocksDelivery([{ file: 'src/types/index.ts', message: 'x' }])).toBe(false); // nested barrel, not an entry
    expect(previewDivergenceBlocksDelivery([])).toBe(false);
    expect(previewDivergenceBlocksDelivery(undefined as never)).toBe(false);
  });

  it('blocks when ANY error is an entry file (mixed set)', () => {
    expect(previewDivergenceBlocksDelivery([
      { file: 'src/components/Widget.tsx', message: 'x' },
      { file: 'src/App.tsx', message: 'Duplicate declaration' },
    ])).toBe(true);
  });

  it('the free summary is honest — not charged + actionable', () => {
    const s = previewCompileUnresolvedSummary();
    expect(s).toMatch(/not been charged/i);
    expect(s).toMatch(/preview does not compile/i);
  });
});
