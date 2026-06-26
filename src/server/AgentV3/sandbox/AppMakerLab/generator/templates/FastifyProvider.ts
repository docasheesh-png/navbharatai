import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-fastify-api',
  version: '1.0.0',
  scripts: {
    dev: 'ts-node src/index.ts',
    start: 'ts-node src/index.ts',
    build: 'esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js',
    'start:prod': 'node dist/index.js',
  },
  dependencies: {
    fastify: '^4.28.0',
    '@fastify/cors': '^9.0.1',
    '@fastify/swagger': '^8.14.0',
  },
  devDependencies: {
    '@types/node': '^20.11.0',
    'ts-node': '^10.9.2',
    typescript: '^5.3.3',
    esbuild: '^0.20.0',
  },
  type: 'commonjs',
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2020',
    module: 'commonjs',
    lib: ['ES2020'],
    outDir: './dist',
    rootDir: './src',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  include: ['src'],
  exclude: ['node_modules', 'dist'],
}, null, 2);

const INDEX_TS = `import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });

app.register(cors, { origin: true });

app.get('/', async (_request, _reply) => {
  return { message: 'Hello from Fastify!', timestamp: new Date().toISOString() };
});

app.get('/health', async () => ({ status: 'ok' }));

const start = async () => {
  try {
    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
`;

export class FastifyProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'src/index.ts': INDEX_TS,
    };
  }
}
