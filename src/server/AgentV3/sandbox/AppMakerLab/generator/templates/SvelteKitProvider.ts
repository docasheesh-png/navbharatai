import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-sveltekit-app',
  version: '1.0.0',
  private: true,
  scripts: { dev: 'vite dev --host 0.0.0.0 --port 5173', build: 'vite build', preview: 'vite preview --host 0.0.0.0 --port 4173' },
  dependencies: { '@sveltejs/kit': '^2.5.0', svelte: '^5.0.0' },
  devDependencies: { '@sveltejs/adapter-node': '^5.0.0', vite: '^5.2.0' },
  type: 'module',
}, null, 2);

const SVELTE_CONFIG = `import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};
export default config;
`;

const VITE_CONFIG = `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 4173, allowedHosts: true },
});
`;

const APP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`;

const PAGE_SVELTE = `<script lang="ts">
  let count = 0;
</script>

<main>
  <h1>Hello from SvelteKit!</h1>
  <p>Count: {count}</p>
  <button on:click={() => count++}>Increment</button>
</main>

<style>
  main { padding: 2rem; font-family: sans-serif; }
</style>
`;

export class SvelteKitProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'svelte.config.js': SVELTE_CONFIG,
      'vite.config.ts': VITE_CONFIG,
      'src/app.html': APP_HTML,
      'src/routes/+page.svelte': PAGE_SVELTE,
    };
  }
}
