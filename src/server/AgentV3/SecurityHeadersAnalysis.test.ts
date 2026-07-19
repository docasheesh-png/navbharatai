import { describe, it, expect } from 'vitest';
import { scanSecurityHeaders, securityHeadersSummary } from './SecurityHeadersAnalysis';

describe('scanSecurityHeaders — Express/Koa server without security headers', () => {
  it('a static front-end SPA (no server) reports zero gaps', () => {
    const files = {
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }',
      'src/main.tsx': 'import App from "./App";',
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('an empty project reports nothing', () => {
    expect(scanSecurityHeaders({})).toEqual([]);
  });

  it('an Express server with no helmet and no manual headers → one medium finding', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.get('/', (_req, res) => res.send('<h1>home</h1>'));
        app.listen(3000);
      `,
    };
    const issues = scanSecurityHeaders(files);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missing-security-headers');
    expect(issues[0].severity).toBe('medium');
    expect(issues[0].file).toBe('server/index.ts');
  });

  it('an Express server that uses helmet() → clean', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        import helmet from 'helmet';
        const app = express();
        app.use(helmet());
        app.listen(3000);
      `,
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('helmet applied in a SEPARATE middleware file still counts (project-level aggregation)', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        import { securityMiddleware } from './middleware';
        const app = express();
        app.use(securityMiddleware);
        app.listen(process.env.PORT);
      `,
      'server/middleware.ts': `
        import helmet from 'helmet';
        export const securityMiddleware = helmet();
      `,
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('a hand-rolled set of security headers → clean (do not nag a manual setup)', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.use((_req, res, next) => {
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('Content-Security-Policy', "default-src 'self'");
          res.setHeader('X-Content-Type-Options', 'nosniff');
          next();
        });
        app.listen(3000);
      `,
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('a Fastify server is NOT flagged (its own @fastify/helmet convention)', () => {
    const files = {
      'server/index.ts': `
        import Fastify from 'fastify';
        const app = Fastify();
        app.get('/', async () => ({ ok: true }));
        app.listen({ port: 3000 });
      `,
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('a static front-end that merely imports express types but stands up no server is not flagged', () => {
    const files = {
      'src/types.ts': 'import type { Request } from "express"; export type R = Request;',
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });

  it('a Koa server without helmet → one finding', () => {
    const files = {
      'server/app.js': `
        const Koa = require('koa');
        const app = new Koa();
        app.listen(3000);
      `,
    };
    // Koa is express-like for our purposes, but only when a real 'koa' import/new Koa is present.
    const issues = scanSecurityHeaders(files);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missing-security-headers');
  });

  it('ignores node_modules / dist / test files when detecting the server', () => {
    const files = {
      'node_modules/express/index.js': 'module.exports = function express(){};',
      'dist/server.js': 'const app = express(); app.listen(3000);',
      'server/index.test.ts': 'const app = express(); app.listen(3000);',
    };
    expect(scanSecurityHeaders(files)).toEqual([]);
  });
});

describe('securityHeadersSummary — honest report string', () => {
  it('reports a clean pass when there are no gaps', () => {
    expect(securityHeadersSummary([])).toContain('✓');
    expect(securityHeadersSummary([])).toContain('No security-header gaps');
  });

  it('summarizes the finding with its file and kind', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        express().listen(3000);
      `,
    };
    const summary = securityHeadersSummary(scanSecurityHeaders(files));
    expect(summary).toContain('1 gap(s)');
    expect(summary).toContain('[medium]');
    expect(summary).toContain('missing-security-headers');
    expect(summary).toContain('server/index.ts');
  });
});
