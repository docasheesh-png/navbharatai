import { describe, it, expect } from 'vitest';
import { bundleForPreview } from '../src/server/routes/preview';

/**
 * The client-side per-file Babel bundler fails on large multi-file apps (it only
 * partially renders — e.g. shows just "App"). The server-side esbuild bundler must
 * follow the ENTIRE import graph from the entry and inline every module, so the
 * real app renders. These tests prove that.
 */

describe('bundleForPreview (server-side esbuild)', () => {
  it('bundles a simple JSX scaffold into self-contained ESM HTML', async () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'index.html': '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
      'src/main.jsx': `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);`,
      'src/App.jsx': `export default function App(){ return <h1>Hello World</h1>; }`,
    };
    const html = await bundleForPreview(files);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('type="importmap"');
    expect(html).toContain('esm.sh/react');
    expect(html).toContain('type="module"');
    // The App component's content must be inlined in the bundle (graph was followed).
    expect(html).toContain('Hello World');
    // No Babel CDN reference at all.
    expect(html).not.toContain('babel');
  });

  it('follows a DEEP multi-file import graph (the 324-file failure scenario)', async () => {
    // Build a chain: main → App → Layout → Sidebar → Nav → Button, plus a store + hook.
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
      'index.html': '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'src/main.tsx': `import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);`,
      'src/App.tsx': `import Layout from './components/Layout';\nexport default function App(){ return <Layout/>; }`,
      'src/components/Layout.tsx': `import Sidebar from './Sidebar';\nimport { useCounter } from '../hooks/useCounter';\nexport default function Layout(){ const n = useCounter(); return <div><Sidebar/><main>UNIQUE_LAYOUT_MARKER {n}</main></div>; }`,
      'src/components/Sidebar.tsx': `import Nav from './Nav';\nexport default function Sidebar(){ return <aside><Nav/></aside>; }`,
      'src/components/Nav.tsx': `import { Button } from '@/components/ui/Button';\nexport default function Nav(){ return <nav><Button>UNIQUE_NAV_BUTTON</Button></nav>; }`,
      'src/components/ui/Button.tsx': `export function Button({children}:{children:any}){ return <button className="btn">{children}</button>; }`,
      'src/hooks/useCounter.ts': `import { useState } from 'react';\nexport function useCounter(){ const [n] = useState(42); return n; }`,
      'src/index.css': `.btn{color:red}`,
    };
    const html = await bundleForPreview(files);
    // Every module in the graph must be inlined — proving esbuild followed the whole tree,
    // including the deep leaf component AND the @/ aliased component.
    expect(html).toContain('UNIQUE_LAYOUT_MARKER');
    expect(html).toContain('UNIQUE_NAV_BUTTON');
    expect(html).toContain('type="importmap"');
    expect(html).toContain('type="module"');
  });

  it('resolves @/ path aliases at build time', async () => {
    const files = {
      'index.html': '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>',
      'src/main.tsx': `import { createRoot } from 'react-dom/client';\nimport { Card } from '@/ui/Card';\ncreateRoot(document.getElementById('root')!).render(<Card/>);`,
      'src/ui/Card.tsx': `export function Card(){ return <div>ALIASED_CARD_CONTENT</div>; }`,
    };
    const html = await bundleForPreview(files);
    expect(html).toContain('ALIASED_CARD_CONTENT');
  });

  it('throws a clear error when there is no entry point', async () => {
    await expect(bundleForPreview({ 'readme.md': '# hi' })).rejects.toThrow(/entry/i);
  });
});
