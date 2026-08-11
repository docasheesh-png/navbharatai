import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-vanilla-app',
  version: '1.0.0',
  private: true,
  scripts: {
    dev: 'vite --host 0.0.0.0 --port 5173',
    start: 'vite --host 0.0.0.0 --port 5173',
    build: 'vite build',
    preview: 'vite preview --host 0.0.0.0 --port 4173',
  },
  devDependencies: { vite: '^5.2.0', typescript: '^5.3.3' },
  type: 'module',
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 4173, allowedHosts: true },
});
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    useDefineForClassFields: true,
    module: 'ESNext',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    skipLibCheck: true,
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    isolatedModules: true,
    moduleDetection: 'force',
    noEmit: true,
    strict: true,
  },
  include: ['src'],
}, null, 2);

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_TS = `const app = document.querySelector<HTMLDivElement>('#app')!;

let count = 0;

const render = () => {
  app.innerHTML = \`
    <div style="padding: 2rem; font-family: sans-serif;">
      <h1>Hello from Vanilla TS!</h1>
      <p>Count: \${count}</p>
      <button id="btn">Increment</button>
    </div>
  \`;
  document.querySelector<HTMLButtonElement>('#btn')?.addEventListener('click', () => {
    count++;
    render();
  });
};

render();
`;

const STYLES_CSS = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }
`;

export class VanillaProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/index.css': DESIGN_KIT_CSS,
      'src/main.ts': `import './index.css';\n` + MAIN_TS,
      'src/style.css': STYLES_CSS,
    };
  }
}
