import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-nuxt-app',
  version: '1.0.0',
  private: true,
  scripts: {
    dev: 'nuxt dev --host 0.0.0.0 --port 3000',
    build: 'nuxt build',
    generate: 'nuxt generate',
    preview: 'nuxt preview --host 0.0.0.0 --port 3000',
    start: 'nuxt dev --host 0.0.0.0 --port 3000',
  },
  devDependencies: { nuxt: '^3.12.0', vue: '^3.4.0', 'vue-router': '^4.3.0' },
}, null, 2);

const NUXT_CONFIG = `export default defineNuxtConfig({
  // Nuxt loads global CSS from this array — without it the stylesheet is emitted and never loaded.
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  devServer: { host: '0.0.0.0', port: 3000 },
});
`;

const APP_VUE = `<template>
  <div style="padding: 2rem; font-family: sans-serif;">
    <h1>Hello from Nuxt!</h1>
    <p>Count: {{ count }}</p>
    <button @click="count++">Increment</button>
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
const count = ref(0);
</script>
`;

const INDEX_VUE = `<template>
  <div>
    <p>Welcome to Nuxt 3. Edit <code>app/pages/index.vue</code> to get started.</p>
  </div>
</template>
`;

// Nuxt's canonical top-level error page — rendered for any unhandled error / 404 instead of the
// default Nuxt error screen. Receives the `error` prop; `clearError` returns to a working route.
const ERROR_VUE = `<template>
  <div style="padding: 2rem; font-family: sans-serif;">
    <h1>{{ error.statusCode }}</h1>
    <p>{{ error.statusMessage || 'Something went wrong' }}</p>
    <button @click="handleError">Go back home</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ error: { statusCode: number; statusMessage?: string } }>();
const handleError = () => clearError({ redirect: '/' });
</script>
`;

export class NuxtProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'nuxt.config.ts': NUXT_CONFIG,
      'assets/css/main.css': DESIGN_KIT_CSS,
      'app.vue': APP_VUE,
      'pages/index.vue': INDEX_VUE,
      'error.vue': ERROR_VUE,
    };
  }
}
