import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-express-api',
  version: '1.0.0',
  scripts: {
    dev: 'npx ts-node src/index.ts',
    start: 'npx ts-node src/index.ts',
    build: 'npx tsc --noEmit',
  },
  dependencies: { express: '^4.18.2', cors: '^2.8.5' },
  devDependencies: {
    '@types/express': '^4.17.21',
    '@types/cors': '^2.8.17',
    '@types/node': '^20.11.0',
    'ts-node': '^10.9.2',
    typescript: '^5.3.3',
  },
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
    forceConsistentCasingInFileNames: true,
  },
  include: ['src'],
  exclude: ['node_modules', 'dist'],
}, null, 2);

const INDEX_TS = `import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from Express API!', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server listening on port \${PORT}\`);
});
`;

export class NodeExpressProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'src/index.ts': INDEX_TS,
    };
  }
}
