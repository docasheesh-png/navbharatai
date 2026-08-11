import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-svelte-app',
  version: '1.0.0',
  // ShopKhata-class guard 2026-07-17: @sveltejs/vite-plugin-svelte 3.x is ESM-only — without
  // type:module Vite require()s the bundled config and the dev server dies on boot.
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { svelte: '^4.2.0' },
  devDependencies: {
    '@sveltejs/vite-plugin-svelte': '^3.0.0',
    vite: '^5.0.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Svelte App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;

const MAIN_JS = `import App from './App.svelte';
const app = new App({ target: document.getElementById('app') });
export default app;
`;

const APP_SVELTE = `<script>
  let count = 0;
</script>

<main style="font-family: sans-serif; padding: 2rem">
  <h1>Hello from Svelte!</h1>
  <p>Count: {count}</p>
  <button on:click={() => count++}>Increment</button>
</main>
`;

export class SvelteProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.js': VITE_CONFIG,
      'index.html': INDEX_HTML,
      'src/index.css': DESIGN_KIT_CSS,
      'src/main.js': `import './index.css';\n` + MAIN_JS,
      'src/App.svelte': APP_SVELTE,
    };
  }
}
