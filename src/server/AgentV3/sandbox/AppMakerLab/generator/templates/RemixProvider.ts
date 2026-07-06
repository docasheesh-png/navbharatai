import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-remix-app',
  version: '1.0.0',
  private: true,
  scripts: {
    dev: 'remix vite:dev --host',
    start: 'remix vite:dev --host',
    build: 'remix vite:build',
    'start:prod': 'remix-serve ./build/server/index.js',
  },
  dependencies: {
    '@remix-run/node': '^2.10.0',
    '@remix-run/react': '^2.10.0',
    '@remix-run/serve': '^2.10.0',
    '@remix-run/dev': '^2.10.0',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    isbot: '^4.1.0',
  },
  devDependencies: {
    '@types/react': '^18.2.0',
    '@types/react-dom': '^18.2.0',
    typescript: '^5.3.3',
    vite: '^5.2.0',
    '@vitejs/plugin-react': '^4.2.0',
  },
  type: 'module',
}, null, 2);

const TSCONFIG = JSON.stringify({
  include: ['env.d.ts', '**/*.ts', '**/*.tsx'],
  compilerOptions: {
    lib: ['DOM', 'DOM.Iterable', 'ES2022'],
    isolatedModules: true,
    esModuleInterop: true,
    jsx: 'react-jsx',
    moduleResolution: 'Bundler',
    resolveJsonModule: true,
    target: 'ES2022',
    strict: true,
    allowJs: true,
    forceConsistentCasingInFileNames: true,
    baseUrl: '.',
    paths: { '~/*': ['./app/*'] },
  },
}, null, 2);

const VITE_CONFIG = `import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [remix({ future: { v3_fetcherPersist: true } })],
  server: { host: true, port: 5173, allowedHosts: true },
});
`;

const ROOT_TSX = `import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from '@remix-run/react';

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: 'sans-serif', padding: 0, margin: 0 }}>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Remix's canonical error boundary — catches thrown errors / route error responses (incl. 404s)
// anywhere in the tree and renders a real page instead of a blank white screen.
export function ErrorBoundary() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? \`\${error.status} \${error.statusText}\`
    : 'Something went wrong';
  const message = isRouteErrorResponse(error)
    ? error.data
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <html lang="en">
      <head>
        <title>Oops!</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
        <h1>{title}</h1>
        <p>{message}</p>
        <Scripts />
      </body>
    </html>
  );
}
`;

const INDEX_TSX = `export default function Index() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Hello from Remix!</h1>
      <p>Edit <code>app/routes/_index.tsx</code> to get started.</p>
    </main>
  );
}
`;

export class RemixProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'vite.config.ts': VITE_CONFIG,
      'app/root.tsx': ROOT_TSX,
      'app/routes/_index.tsx': INDEX_TSX,
    };
  }
}
