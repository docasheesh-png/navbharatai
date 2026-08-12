import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

// SolidJS + Vite scaffold. Solid is a popular fine-grained-reactive UI library (no virtual DOM, JSX like
// React but signals instead of hooks) — a genuinely-requested framework that builds on the SAME Vite/Node
// toolchain the default sandbox already has, so it runs out of the box. Mirrors the Vue/Svelte provider
// shape: a minimal, REAL, boot-clean app the LLM builder then extends.

const PKG = JSON.stringify({
  name: 'my-solid-app',
  version: '1.0.0',
  // vite-plugin-solid 2.x is ESM-only — without type:module Vite require()s the bundled config and the
  // dev server dies on boot (same load-bearing guard as the Vue/Svelte scaffolds).
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { 'solid-js': '^1.8.0' },
  devDependencies: {
    typescript: '^5.3.3',
    vite: '^5.0.0',
    'vite-plugin-solid': '^2.10.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
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
    jsx: 'preserve',
    // Solid's JSX runtime — required so `<App />` compiles to Solid's reactive DOM, not React.
    jsxImportSource: 'solid-js',
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
    <title>My Solid App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
`;

const INDEX_TSX = `import { render } from 'solid-js/web';
import App from './App';

const root = document.getElementById('root');
// Guard the mount so a missing #root logs a clear error instead of throwing on a null target.
if (root) {
  render(() => <App />, root);
} else {
  console.error('[app] #root element not found — cannot mount.');
}
`;

const APP_TSX = `import { createSignal } from 'solid-js';

export default function App() {
  const [count, setCount] = createSignal(0);
  return (
    <div style={{ 'font-family': 'sans-serif', padding: '2rem' }}>
      <h1>Hello from SolidJS!</h1>
      <p>Count: {count()}</p>
      <button onClick={() => setCount(count() + 1)}>Increment</button>
    </div>
  );
}
`;

export class SolidProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/index.css': DESIGN_KIT_CSS,
      'src/index.tsx': `import './index.css';\n` + INDEX_TSX,
      'src/App.tsx': APP_TSX,
    };
  }
}
