import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-next-app',
  version: '1.0.0',
  private: true,
  scripts: { dev: 'next dev --port 3000', build: 'next build', start: 'next start' },
  dependencies: { next: '14', react: '^18', 'react-dom': '^18' },
  devDependencies: {
    typescript: '^5',
    '@types/node': '^20',
    '@types/react': '^18',
    '@types/react-dom': '^18',
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'preserve',
    incremental: true,
    plugins: [{ name: 'next' }],
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
  exclude: ['node_modules'],
}, null, 2);

const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
`;

const LAYOUT = `import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with Engineer AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'sans-serif' }}>{children}</body>
    </html>
  );
}
`;

const PAGE = `export default function Home() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Hello from Next.js!</h1>
      <p>Edit <code>app/page.tsx</code> to get started.</p>
    </main>
  );
}
`;

export class NextjsProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'next.config.js': NEXT_CONFIG,
      'app/layout.tsx': LAYOUT,
      'app/page.tsx': PAGE,
    };
  }
}
