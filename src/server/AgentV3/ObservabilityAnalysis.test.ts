import { describe, it, expect } from 'vitest';
import { scanObservability, observabilitySummary } from './ObservabilityAnalysis';

describe('scanObservability — backend observability gaps (Cap-4 advisory)', () => {
  it('a static front-end SPA (no server) reports zero gaps', () => {
    const files = {
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }',
      'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
      'src/main.tsx': 'import App from "./App"; render(<App/>);',
    };
    expect(scanObservability(files)).toEqual([]);
  });

  it('an empty project reports nothing', () => {
    expect(scanObservability({})).toEqual([]);
  });

  it('a fully-observable Express backend reports zero gaps', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        import morgan from 'morgan';
        const app = express();
        app.use(morgan('combined'));
        app.get('/health', (_req, res) => res.json({ ok: true }));
        app.get('/', (_req, res) => res.send('home'));
        app.use((err: Error, _req: any, res: any, _next: any) => { res.status(500).json({ error: err.message }); });
        app.listen(process.env.PORT);
      `,
    };
    expect(scanObservability(files)).toEqual([]);
  });

  it('an Express backend missing ALL three flags reports health(high) + error-handler(medium) + logging(low)', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.get('/', (_req, res) => res.send('home'));
        app.listen(3000);
      `,
    };
    const issues = scanObservability(files);
    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['missing-error-handler', 'missing-health-endpoint', 'missing-request-logging']);
    const health = issues.find((i) => i.kind === 'missing-health-endpoint');
    expect(health?.severity).toBe('high');
    expect(issues.find((i) => i.kind === 'missing-error-handler')?.severity).toBe('medium');
    expect(issues.find((i) => i.kind === 'missing-request-logging')?.severity).toBe('low');
    // reported against a real server-entry file
    expect(health?.file).toBe('server/index.ts');
  });

  it('a health route in a SEPARATE routes file still counts (project-level aggregation)', () => {
    const files = {
      'server/app.ts': `
        import express from 'express';
        import morgan from 'morgan';
        const app = express();
        app.use(morgan('tiny'));
        app.use((err, req, res, next) => res.status(500).end());
        app.listen(process.env.PORT);
      `,
      'server/routes/health.ts': `
        import { Router } from 'express';
        export const health = Router();
        health.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
      `,
    };
    // health present in a separate file, logger + error handler present → clean.
    expect(scanObservability(files)).toEqual([]);
  });

  it('Fastify is NOT false-flagged for the Express-only error-handler/logging gaps (only health checked)', () => {
    const files = {
      'server/index.ts': `
        import Fastify from 'fastify';
        const app = Fastify();
        app.get('/', async () => ({ hello: 'world' }));
        app.listen({ port: 3000 });
      `,
    };
    const issues = scanObservability(files);
    // Fastify has its own error/logging idioms → we only flag the missing health route.
    expect(issues.map((i) => i.kind)).toEqual(['missing-health-endpoint']);
  });

  it('a NestJS Terminus health controller counts as present (no false health gap)', () => {
    const files = {
      'src/main.ts': `
        import { NestFactory } from '@nestjs/core';
        const app = await NestFactory.create(AppModule);
        await app.listen(3000);
      `,
      'src/health.controller.ts': `
        import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
        @Controller('health')
        export class HealthController { @Get() @HealthCheck() check() { return this.health.check([]); } }
      `,
    };
    // Nest health present, and Nest is not Express-like → zero findings.
    expect(scanObservability(files)).toEqual([]);
  });

  it('ignores node_modules / dist / test files when detecting a backend', () => {
    const files = {
      'node_modules/express/index.js': 'module.exports = function express() {};',
      'dist/server.js': 'const app = express(); app.listen(3000);',
      'server/index.test.ts': 'const app = express(); app.listen(3000);',
    };
    // the only "server" signals live in skipped paths → no backend detected.
    expect(scanObservability(files)).toEqual([]);
  });

  it('a health route present but no error-handler/logging → exactly the two Express gaps', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.get('/ping', (_req, res) => res.send('pong'));
        app.listen(process.env.PORT);
      `,
    };
    const kinds = scanObservability(files).map((i) => i.kind).sort();
    expect(kinds).toEqual(['missing-error-handler', 'missing-request-logging']);
  });
});

describe('observabilitySummary — honest report string', () => {
  it('reports a clean pass when there are no gaps', () => {
    expect(observabilitySummary([])).toContain('✓');
    expect(observabilitySummary([])).toContain('No backend observability gaps');
  });

  it('summarizes counts by severity, highest first', () => {
    const files = {
      'server/index.ts': `
        import express from 'express';
        const app = express();
        app.get('/', (_req, res) => res.send('home'));
        app.listen(3000);
      `,
    };
    const summary = observabilitySummary(scanObservability(files));
    expect(summary).toContain('3 gap(s)');
    expect(summary).toContain('1 high');
    expect(summary).toContain('1 medium');
    expect(summary).toContain('1 low');
    // high line appears before the low line
    expect(summary.indexOf('[high]')).toBeLessThan(summary.indexOf('[low]'));
  });
});
