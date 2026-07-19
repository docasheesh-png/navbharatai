import { ITemplateProvider } from './ViteReactProvider';

// Hono + Node backend scaffold. Hono is a small, ultrafast, modern web framework (Web-standard Request/
// Response, huge ecosystem, runs on Node/Bun/Deno/edge) that has become a leading choice for new TypeScript
// APIs. On the sandbox it runs on Node via @hono/node-server, so it boots out of the box (real, not a stub).
// Mirrors the NodeExpress backend provider: a minimal, boot-clean API listening on 0.0.0.0:$PORT.

const PKG = JSON.stringify({
  name: 'my-hono-api',
  version: '1.0.0',
  // Hono + @hono/node-server are ESM — type:module keeps tsx/esbuild in ESM mode.
  type: 'module',
  scripts: {
    dev: 'npx tsx watch src/index.ts',
    start: 'npx tsx src/index.ts',
    build: 'npx esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js',
    'start:prod': 'node dist/index.js',
  },
  dependencies: { hono: '^4.0.0', '@hono/node-server': '^1.8.0' },
  devDependencies: {
    '@types/node': '^20.11.0',
    tsx: '^4.7.0',
    typescript: '^5.3.3',
    esbuild: '^0.20.0',
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
  },
  include: ['src'],
  exclude: ['node_modules', 'dist'],
}, null, 2);

const INDEX_TS = `import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();
const PORT = Number(process.env.PORT) || 3000;

app.get('/', (c) => c.json({ message: 'Hello from Hono!', timestamp: new Date().toISOString() }));

app.get('/health', (c) => c.json({ status: 'ok' }));

// Bind 0.0.0.0 so the sandbox preview can reach it.
serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(\`Server listening on port \${info.port}\`);
});
`;

export class HonoProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'src/index.ts': INDEX_TS,
    };
  }
}
