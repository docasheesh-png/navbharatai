import { describe, it, expect } from 'vitest';
import { scanGracefulShutdown, gracefulShutdownSummary } from './GracefulShutdownAnalysis';

describe('scanGracefulShutdown — long-lived server without SIGTERM handling', () => {
  it('a static front-end SPA (no server) reports zero gaps', () => {
    const files = {
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }',
      'src/main.tsx': 'import App from "./App"; render(<App/>);',
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('an empty project reports nothing', () => {
    expect(scanGracefulShutdown({})).toEqual([]);
  });

  it('an Express server that binds a port but never handles SIGTERM → one medium finding', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.get('/', (_req, res) => res.send('ok'));
        app.listen(process.env.PORT || 3000);
      `,
    };
    const issues = scanGracefulShutdown(files);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missing-graceful-shutdown');
    expect(issues[0].severity).toBe('medium');
    expect(issues[0].file).toBe('server/index.ts');
  });

  it('a hand-rolled SIGTERM handler that closes the server → clean', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        const server = app.listen(3000);
        process.on('SIGTERM', () => {
          server.close(() => process.exit(0));
        });
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('the SIGTERM handler and server.close may live in SEPARATE files (project-level aggregation)', () => {
    const files = {
      'server/app.ts': `
        import express from 'express';
        export const server = express().listen(process.env.PORT);
      `,
      'server/lifecycle.ts': `
        import { server } from './app';
        process.once('SIGTERM', () => server.close());
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a shutdown library (http-terminator) counts as graceful → clean', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        import { createHttpTerminator } from 'http-terminator';
        const app = express();
        const server = app.listen(3000);
        const terminator = createHttpTerminator({ server });
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a serverless handler export is NOT flagged (platform owns the lifecycle)', () => {
    const files = {
      'api/index.ts': `
        import serverless from 'serverless-http';
        import express from 'express';
        const app = express();
        app.get('/', (_req, res) => res.send('ok'));
        export const handler = serverless(app);
        app.listen(3000); // local dev only
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a Next.js app is NOT flagged (framework-managed runtime)', () => {
    const files = {
      'server.ts': `
        import next from 'next';
        const app = next({ dev: false });
        app.prepare().then(() => { createServer(handler).listen(3000); });
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a NestJS app is NOT flagged (its shutdown hooks manage lifecycle)', () => {
    const files = {
      'src/main.ts': `
        import { NestFactory } from '@nestjs/core';
        const app = await NestFactory.create(AppModule);
        app.enableShutdownHooks();
        await app.listen(3000);
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a raw http.createServer with .listen and no shutdown → one finding', () => {
    const files = {
      'server/index.js': `
        const http = require('http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(8080);
      `,
    };
    const issues = scanGracefulShutdown(files);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missing-graceful-shutdown');
  });

  it('ignores node_modules / dist / test files when detecting the server', () => {
    const files = {
      'node_modules/express/index.js': 'function listen(){} module.exports.listen = listen;',
      'dist/server.js': 'app.listen(3000);',
      'server/index.test.ts': "app.listen(3000);",
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });

  it('a client that merely calls socket.close() (no port bind) is not treated as a server', () => {
    const files = {
      'src/ws.ts': `
        const socket = new WebSocket('wss://x');
        socket.close();
      `,
    };
    expect(scanGracefulShutdown(files)).toEqual([]);
  });
});

describe('gracefulShutdownSummary — honest report string', () => {
  it('reports a clean pass when there are no gaps', () => {
    expect(gracefulShutdownSummary([])).toContain('✓');
    expect(gracefulShutdownSummary([])).toContain('No graceful-shutdown gaps');
  });

  it('summarizes the finding with its file and kind', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        express().listen(3000);
      `,
    };
    const summary = gracefulShutdownSummary(scanGracefulShutdown(files));
    expect(summary).toContain('1 gap(s)');
    expect(summary).toContain('[medium]');
    expect(summary).toContain('missing-graceful-shutdown');
    expect(summary).toContain('server/index.ts');
  });
});
