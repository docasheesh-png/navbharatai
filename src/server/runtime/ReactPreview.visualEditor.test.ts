import { describe, it, expect } from 'vitest';
import * as Babel from '@babel/standalone';
import { buildReactPreview } from './ReactPreview';
import { VirtualFileSystem } from '../project/ProjectModel';

// Visual Editor reliability (admin 2026-07-29): the inspector used to depend on React's `_debugSource`,
// which is null for library/nested elements (shadcn/lucide/etc.) and gone in React 19 — so "Edit" silently
// did nothing on most clicks. The fix stamps data-nbai-src="file:line:col" onto every HOST element of the
// user's code so the inspector maps ANY clicked element to real source via closest('[data-nbai-src]').
// This test replicates that plugin (kept in sync with the inline nbaiSrcPlugin in ReactPreview.ts) and
// proves the technique produces correct attributes, plus that the built preview HTML carries the mechanism.
function nbaiSrcPlugin(path: string) {
  return function (babel: { types: any }) {
    const t = babel.types;
    return {
      visitor: {
        JSXOpeningElement(p: any) {
          const nm = p.node.name;
          if (!nm || nm.type !== 'JSXIdentifier') return; // skip <Component/>
          const tag: string = nm.name;
          if (tag.charAt(0) !== tag.charAt(0).toLowerCase()) return; // host (lowercase) only
          if (!p.node.loc) return;
          for (const a of p.node.attributes) if (a.type === 'JSXAttribute' && a.name && a.name.name === 'data-nbai-src') return;
          const v = `${path}:${p.node.loc.start.line}:${p.node.loc.start.column + 1}`;
          p.node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-nbai-src'), t.stringLiteral(v)));
        },
      },
    };
  };
}

describe('Visual Editor — reliable data-nbai-src mapping', () => {
  it('stamps HOST JSX elements with data-nbai-src="file:line:col" (and not <Component/> tags)', () => {
    const code = [
      'export default function App() {',
      '  return (',
      '    <div>',          // line 3
      '      <h1>Hi</h1>',  // line 4
      '      <Button>Click</Button>', // line 5 — a COMPONENT, must NOT be stamped
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const out = (Babel as unknown as { transform: (c: string, o: unknown) => { code: string } }).transform(code, {
      filename: 'src/App.tsx',
      presets: [
        ['react', { runtime: 'automatic', development: true }],
        ['typescript', { isTSX: true, allExtensions: true, allowDeclareFields: true }],
      ],
      plugins: [nbaiSrcPlugin('src/App.tsx'), 'transform-modules-commonjs'],
      sourceType: 'module',
    }).code;
    expect(out).toContain('data-nbai-src');
    expect(out).toContain('src/App.tsx:3:'); // <div>
    expect(out).toContain('src/App.tsx:4:'); // <h1>
    // The component <Button> is not a host element — its line (5) must NOT be stamped as a data-nbai-src.
    expect(out).not.toContain('src/App.tsx:5:');
  });

  it('the built in-browser preview HTML carries the whole mechanism (plugin + closest lookup + feedback)', () => {
    const app = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'src/main.tsx': "import App from './App';\nexport default function boot(){ return App; }",
      'src/App.tsx': 'export default function App(){ return <div><h1>Hi</h1></div>; }',
    };
    const html = buildReactPreview(VirtualFileSystem.fromRecord(app));
    expect(html).toContain('nbaiSrcPlugin'); // the stamping plugin is emitted into the runtime
    expect(html).toContain('data-nbai-src'); // the attribute name
    expect(html).toContain("closest('[data-nbai-src]')"); // the reliable element→source lookup
    expect(html).toContain('flashNotEditable'); // honest feedback instead of a silent no-op
  });

  it('the preview HTML carries the Phase 2 selection + live-style mechanism', () => {
    const app = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'src/main.tsx': "import App from './App';\nexport default function boot(){ return App; }",
      'src/App.tsx': 'export default function App(){ return <div><h1>Hi</h1></div>; }',
    };
    const html = buildReactPreview(VirtualFileSystem.fromRecord(app));
    expect(html).toContain('__nbaiSelect');      // click reports the selected element + styles
    expect(html).toContain('__nbaiApplyStyle');   // parent live-applies a style change
    expect(html).toContain('__nbaiEditText');     // toolbar can start a text edit
    expect(html).toContain('selectEl');           // single click selects (double-click edits text)
    expect(html).toContain('dblclick');           // text edit is a deliberate double-click
  });

  it('the preview HTML carries the Phase 2 resize + reposition mechanism (Slice D/E)', () => {
    const app = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'src/main.tsx': "import App from './App';\nexport default function boot(){ return App; }",
      'src/App.tsx': 'export default function App(){ return <div><h1>Hi</h1></div>; }',
    };
    const html = buildReactPreview(VirtualFileSystem.fromRecord(app));
    expect(html).toContain('__nbaiStyleCommit');   // resize/move persist message
    expect(html).toContain('onHandleDown');         // the resize grip drag
    expect(html).toContain('translate(');           // layout-safe move via transform
    expect(html).toContain('data-nbai-ui');          // the grip is marked so it never self-selects
  });
});
