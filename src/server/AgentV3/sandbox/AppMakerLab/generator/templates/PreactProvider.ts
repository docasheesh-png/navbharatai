import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

// Preact + Vite scaffold. Preact is a ~3KB React-compatible UI library — same JSX + hooks API as React
// but a fraction of the size, ideal for lightweight/perf-sensitive apps. It runs on the SAME Vite/Node
// toolchain the default sandbox already has, so it builds out of the box (real, not a stub). Mirrors the
// Solid/Vue provider shape: a minimal, REAL, boot-clean app the LLM builder then extends.

const PKG = JSON.stringify({
  name: 'my-preact-app',
  version: '1.0.0',
  // @preact/preset-vite is ESM-only — without type:module Vite require()s the bundled config and the dev
  // server dies on boot (same load-bearing guard as the Solid/Vue scaffolds).
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { preact: '^10.19.0' },
  devDependencies: {
    '@preact/preset-vite': '^2.8.0',
    typescript: '^5.3.3',
    vite: '^5.0.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    skipLibCheck: true,
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: 'react-jsx',
    // Preact's JSX runtime — so `<App />` compiles against Preact, not React.
    jsxImportSource: 'preact',
    strict: true,
    types: ['vite/client'],
  },
  include: ['src'],
  exclude: ['node_modules'],
}, null, 2);

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Preact App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('app');
// Guard the mount so a missing #app logs a clear error instead of throwing on a null target.
if (root) {
  render(<App />, root);
} else {
  console.error('[app] #app element not found — cannot mount.');
}
`;

const APP_TSX = `import { useState } from 'preact/hooks';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Hello from Preact!</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}
`;

export class PreactProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/index.css': DESIGN_KIT_CSS,
      'src/main.tsx': `import './index.css';\n` + MAIN_TSX,
      'src/app.tsx': APP_TSX,
    };
  }
}
