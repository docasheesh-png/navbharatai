import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-vue-app',
  version: '1.0.0',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: { vue: '^3.4.0' },
  devDependencies: {
    '@vitejs/plugin-vue': '^5.0.0',
    typescript: '^5.3.3',
    vite: '^5.0.0',
    'vue-tsc': '^2.0.0',
  },
}, null, 2);

const VITE_CONFIG = `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
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
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: 'preserve',
    strict: true,
  },
  include: ['src/**/*.ts', 'src/**/*.vue'],
  exclude: ['node_modules'],
}, null, 2);

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Vue App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const MAIN_TS = `import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);

// Global error handler — catches uncaught errors in components/lifecycle so one failure never
// silently blanks the whole app. Wire this to a real error reporter in production.
app.config.errorHandler = (err, _instance, info) => {
  console.error('[app error]', info, err);
};

app.mount('#app');
`;

const APP_VUE = `<template>
  <div style="font-family: sans-serif; padding: 2rem">
    <h1>Hello from Vue 3!</h1>
    <p>Count: {{ count }}</p>
    <button @click="count++">Increment</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
</script>
`;

export class VueProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'vite.config.ts': VITE_CONFIG,
      'tsconfig.json': TSCONFIG,
      'index.html': INDEX_HTML,
      'src/main.ts': MAIN_TS,
      'src/App.vue': APP_VUE,
    };
  }
}
