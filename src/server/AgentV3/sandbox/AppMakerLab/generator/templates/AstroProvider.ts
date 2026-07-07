import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-astro-app',
  version: '1.0.0',
  private: true,
  scripts: {
    dev: 'astro dev --host 0.0.0.0 --port 4321',
    start: 'astro dev --host 0.0.0.0 --port 4321',
    build: 'astro build',
    preview: 'astro preview --host 0.0.0.0 --port 4321',
  },
  dependencies: { astro: '^4.11.0' },
  devDependencies: {},
}, null, 2);

const ASTRO_CONFIG = `import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { host: true, port: 4321, allowedHosts: true },
});
`;

const INDEX_ASTRO = `---
const title = 'Hello from Astro!';
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
  </head>
  <body style="padding: 2rem; font-family: sans-serif;">
    <h1>{title}</h1>
    <p>Edit <code>src/pages/index.astro</code> to get started.</p>
  </body>
</html>
`;

// Astro's canonical custom 404 page — served for any unmatched route instead of a bare server 404.
const NOT_FOUND_ASTRO = `---
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>404 — Not Found</title>
  </head>
  <body style="padding: 2rem; font-family: sans-serif;">
    <h1>404 — Page not found</h1>
    <p>The page you're looking for doesn't exist. <a href="/">Go home</a>.</p>
  </body>
</html>
`;

export class AstroProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'astro.config.mjs': ASTRO_CONFIG,
      'src/pages/index.astro': INDEX_ASTRO,
      'src/pages/404.astro': NOT_FOUND_ASTRO,
    };
  }
}
