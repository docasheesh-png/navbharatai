import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-next-app',
  version: '1.0.0',
  private: true,
  scripts: { dev: 'next dev --hostname 0.0.0.0 --port 3000', build: 'next build', start: 'next start --hostname 0.0.0.0 --port 3000' },
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

const GLOBALS = `* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; }
`;

const LAYOUT = `import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with NavBharatAI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
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

// App Router loading UI — shown while a route segment's data is being fetched (Suspense boundary).
const LOADING = `export default function Loading() {
  return (
    <main style={{ padding: '2rem' }}>
      <p>Loading…</p>
    </main>
  );
}
`;

// App Router error boundary — MUST be a Client Component and receives \`reset\` to retry the segment.
const ERROR = `'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={{ padding: '2rem' }}>
      <h2>Something went wrong</h2>
      <button onClick={() => reset()}>Try again</button>
    </main>
  );
}
`;

// App Router 404 handler — rendered for unmatched routes and \`notFound()\` calls.
const NOT_FOUND = `import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ padding: '2rem' }}>
      <h2>404 — Page not found</h2>
      <p>Could not find the requested page.</p>
      <Link href="/">Return home</Link>
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
      'app/globals.css': DESIGN_KIT_CSS + '\n\n' + GLOBALS,
      'app/layout.tsx': LAYOUT,
      'app/page.tsx': PAGE,
      // App Router special files — a production-shaped scaffold, not just page+layout:
      'app/loading.tsx': LOADING,
      'app/error.tsx': ERROR,
      'app/not-found.tsx': NOT_FOUND,
    };
  }
}
