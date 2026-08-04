import { describe, it, expect } from 'vitest';
import * as Babel from '@babel/standalone';
import { buildReactPreview } from './ReactPreview';
import { buildSourceAppPreview } from '../../lib/previewUtils';
import { VirtualFileSystem } from '../project/ProjectModel';

// Autopsy 2026-07-22 (RHOTKI-clinic CRM, buildId 91694679): a build fixed a class ErrorBoundary by
// silencing tsc with `declare state`/`declare props`/`declare setState` class fields. tsc --noEmit
// passed (exit 0), the E2B/vite preview rendered, and the engine reported "✅ Preview verified — Done!"
// — but when the user opened the IN-BROWSER Babel preview it white-screened:
//   "Compile src/ErrorBoundary.tsx: The 'declare' modifier is only allowed when the 'allowDeclareFields'
//    option of @babel/plugin-transform-typescript or @babel/preset-typescript is enabled."
// Root cause: our in-browser preview's Babel preset-typescript omitted allowDeclareFields, so it rejected
// a `declare` class field that tsc + vite/esbuild accept — a compiler divergence that shipped a broken
// preview as verified. Fix: allowDeclareFields:true in BOTH the server builder (ReactPreview.ts) and the
// client builder (previewUtils.ts). These tests lock the exact failure so the class can never return.

// The exact code from the report — a class component with `declare` type-only fields.
const ERROR_BOUNDARY_TSX = `import React from 'react';
interface Props { children: React.ReactNode; }
interface State { error: Error | null; }
class ErrorBoundary extends React.Component<Props, State> {
  declare state: State;
  declare props: Props;
  declare setState: React.Component<Props, State>['setState'];
  constructor(props: Props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error): State { return { error }; }
  render() { return this.state.error ? <div>err</div> : this.props.children; }
}
export default ErrorBoundary;`;

// The precise preset shape each builder feeds to Babel (typescript preset with allowDeclareFields).
const TS_PRESET_WITH_FLAG = ['typescript', { isTSX: true, allExtensions: true, allowDeclareFields: true }];
const TS_PRESET_WITHOUT_FLAG = ['typescript', { isTSX: true, allExtensions: true }];

describe('in-browser preview — Babel tolerates `declare` class fields (allowDeclareFields)', () => {
  it('the EXACT reported code compiles cleanly WITH allowDeclareFields, erasing the type-only fields', () => {
    let code = '';
    expect(() => {
      code = (Babel as any).transform(ERROR_BOUNDARY_TSX, {
        filename: 'src/ErrorBoundary.tsx',
        presets: [['react', { runtime: 'automatic' }], TS_PRESET_WITH_FLAG],
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module',
      }).code;
    }).not.toThrow();
    // declare fields are type-only → erased, not emitted as runtime assignments
    expect(code).not.toContain('declare');
  });

  it('WITHOUT the flag Babel throws the exact error the user saw (encodes the failure)', () => {
    expect(() => {
      (Babel as any).transform(ERROR_BOUNDARY_TSX, {
        filename: 'src/ErrorBoundary.tsx',
        presets: [['react', { runtime: 'automatic' }], TS_PRESET_WITHOUT_FLAG],
        plugins: ['transform-modules-commonjs'],
        sourceType: 'module',
      });
    }).toThrow(/allowDeclareFields/);
  });
});

const DECLARE_FIELD_APP = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/ErrorBoundary.tsx': ERROR_BOUNDARY_TSX,
  'src/App.tsx': "export default function App(){ return <div>Hi</div>; }",
  'src/main.tsx':
    "import ErrorBoundary from './ErrorBoundary';\nimport App from './App';\nexport default function boot(){ return App; }",
};

describe('both preview builders emit allowDeclareFields in the typescript preset', () => {
  it('server builder (buildReactPreview) sets allowDeclareFields:true', () => {
    const html = buildReactPreview(VirtualFileSystem.fromRecord(DECLARE_FIELD_APP));
    expect(html).toContain('allowDeclareFields');
  });

  it('client builder (buildSourceAppPreview) sets allowDeclareFields:true', () => {
    const html = buildSourceAppPreview(DECLARE_FIELD_APP);
    expect(html).toContain('allowDeclareFields');
  });
});
