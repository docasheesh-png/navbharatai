import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-sveltekit-app',
  version: '1.0.0',
  private: true,
  scripts: { dev: 'vite dev --host 0.0.0.0 --port 5173', build: 'vite build', preview: 'vite preview --host 0.0.0.0 --port 4173' },
  dependencies: { '@sveltejs/kit': '^2.5.0', svelte: '^5.0.0' },
  // 🔒 @sveltejs/vite-plugin-svelte IS REQUIRED AND WAS MISSING (verified by a real install,
  // 2026-08-24). svelte.config.js below imports `vitePreprocess` from it on its very first lines, so
  // the package is not optional tooling — it is a direct import of the config the build loads first.
  // Without it `npm install` itself failed, which means NOT ONE SvelteKit app this scaffold produced
  // could ever start. SvelteKit's own `npm create svelte` has always included it; it was simply
  // omitted here, and nothing checked because no test ever ran a real install.
  devDependencies: {
    '@sveltejs/adapter-node': '^5.0.0',
    '@sveltejs/vite-plugin-svelte': '^3.1.1',
    vite: '^5.2.0',
  },
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

// SvelteKit root layout — wraps every route. Svelte 5 runes: children come in via $props().
const LAYOUT_SVELTE = `<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
`;

// SvelteKit's canonical error boundary — rendered for any load error / 404 with the status + message.
const ERROR_SVELTE = `<script lang="ts">
  import { page } from '$app/stores';
</script>

<main>
  <h1>{$page.status}</h1>
  <p>{$page.error?.message ?? 'Something went wrong'}</p>
  <a href="/">Go back home</a>
</main>

<style>
  main { padding: 2rem; font-family: sans-serif; }
</style>
`;

// App namespace type declarations SvelteKit expects — keeps \`svelte-check\`/tsc clean out of the box.
const APP_DTS = `declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};
`;

export class SvelteKitProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'svelte.config.js': SVELTE_CONFIG,
      'vite.config.ts': VITE_CONFIG,
      'src/app.html': APP_HTML,
      'src/app.d.ts': APP_DTS,
      'src/app.css': DESIGN_KIT_CSS,
      'src/routes/+layout.svelte': LAYOUT_SVELTE,
      'src/routes/+page.svelte': PAGE_SVELTE,
      'src/routes/+error.svelte': ERROR_SVELTE,
    };
  }
}
