import { ITemplateProvider } from './ViteReactProvider';

// Lit + Vite scaffold. Lit is Google's small, standards-based library for building fast Web Components
// (reactive properties + declarative templates, no virtual DOM). It compiles with Vite's built-in esbuild
// (no framework plugin needed — just the decorator tsconfig), so it builds on the SAME sandbox toolchain
// out of the box (real, not a stub). Mirrors the Solid/Preact provider shape: a minimal, boot-clean app.

const PKG = JSON.stringify({
  name: 'my-lit-app',
  version: '1.0.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { lit: '^3.1.0' },
  devDependencies: {
    typescript: '^5.3.3',
    vite: '^5.0.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';

// Lit needs no Vite plugin — Vite's esbuild handles the TypeScript + decorators from tsconfig.
export default defineConfig({
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2021',
    module: 'ESNext',
    lib: ['ES2021', 'DOM', 'DOM.Iterable'],
    moduleResolution: 'bundler',
    // Lit's @customElement / @state decorators require the legacy decorator semantics + fields NOT
    // define-initialized (else reactive properties don't upgrade). This is the documented Lit tsconfig.
    experimentalDecorators: true,
    useDefineForClassFields: false,
    skipLibCheck: true,
    isolatedModules: true,
    noEmit: true,
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
    <title>My Lit App</title>
  </head>
  <body>
    <my-app></my-app>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_TS = `// Import the component module so its @customElement registration runs and <my-app> upgrades.
import './my-app';
`;

const MY_APP_TS = `import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('my-app')
export class MyApp extends LitElement {
  static styles = css\`
    :host { display: block; font-family: sans-serif; padding: 2rem; }
    button { cursor: pointer; }
  \`;

  @state() private count = 0;

  render() {
    return html\`
      <h1>Hello from Lit!</h1>
      <p>Count: \${this.count}</p>
      <button @click=\${() => this.count++}>Increment</button>
    \`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'my-app': MyApp;
  }
}
`;

export class LitProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/main.ts': MAIN_TS,
      'src/my-app.ts': MY_APP_TS,
    };
  }
}
