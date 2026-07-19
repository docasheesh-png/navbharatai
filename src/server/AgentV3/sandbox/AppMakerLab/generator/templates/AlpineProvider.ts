import { ITemplateProvider } from './ViteReactProvider';

// Alpine.js + Vite scaffold. Alpine is a tiny (~15KB) library for sprinkling reactive behaviour directly
// into HTML via attributes (x-data, x-text, @click) — "jQuery for the modern web", hugely popular in the
// Laravel/Livewire world and for content sites that need light interactivity without a full SPA framework.
// It bundles with plain Vite (no plugin), so it builds on the existing sandbox out of the box. Mirrors the
// other providers: a minimal, REAL, boot-clean app the LLM builder then extends.

const PKG = JSON.stringify({
  name: 'my-alpine-app',
  version: '1.0.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { alpinejs: '^3.13.0' },
  devDependencies: {
    '@types/alpinejs': '^3.13.0',
    typescript: '^5.3.3',
    vite: '^5.0.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';

// Alpine needs no Vite plugin — it's imported and started in a plain module.
export default defineConfig({
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    moduleResolution: 'bundler',
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
    <title>My Alpine App</title>
  </head>
  <body>
    <!-- Alpine drives the UI declaratively from these attributes. -->
    <div x-data="{ count: 0 }" style="font-family: sans-serif; padding: 2rem">
      <h1>Hello from Alpine.js!</h1>
      <p>Count: <span x-text="count"></span></p>
      <button @click="count++">Increment</button>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_TS = `import Alpine from 'alpinejs';

// Expose Alpine on window (handy for debugging + x-data helpers) and start it so the x-* directives
// in index.html become reactive.
declare global {
  interface Window {
    Alpine: typeof Alpine;
  }
}
window.Alpine = Alpine;
Alpine.start();
`;

export class AlpineProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/main.ts': MAIN_TS,
    };
  }
}
