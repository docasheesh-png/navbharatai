import { describe, it, expect } from 'vitest';
import { injectHealthEndpoint } from './ObservabilityInjector';
import { scanObservability } from './ObservabilityAnalysis';

describe('injectHealthEndpoint — deterministic /health injection (Cap-4 injection half)', () => {
  it('injects a /health route before app.listen on a standard Express entry', () => {
    const files = {
      'server/index.ts': [
        "import express from 'express';",
        'const app = express();',
        "app.get('/', (_req, res) => res.send('home'));",
        'app.listen(3000);',
      ].join('\n'),
    };
    const result = injectHealthEndpoint(files);
    expect(result).not.toBeNull();
    expect(result!.path).toBe('server/index.ts');
    expect(result!.appVar).toBe('app');
    expect(result!.newContent).toContain("app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));");
    // route registered BEFORE listen
    expect(result!.newContent.indexOf("'/health'")).toBeLessThan(result!.newContent.indexOf('app.listen'));
    // the original route + listen are preserved
    expect(result!.newContent).toContain("app.get('/', (_req, res) => res.send('home'));");
    expect(result!.newContent).toContain('app.listen(3000);');
  });

  it('the injected file now PASSES the observability health check (round-trip with the analyzer)', () => {
    const files = {
      'server/index.ts': "import express from 'express';\nconst app = express();\napp.listen(process.env.PORT);",
    };
    // before: health gap present
    expect(scanObservability(files).some((i) => i.kind === 'missing-health-endpoint')).toBe(true);
    const result = injectHealthEndpoint(files)!;
    expect(result).not.toBeNull();
    // after: re-scan the injected file → no missing-health finding
    const after = scanObservability({ 'server/index.ts': result.newContent });
    expect(after.some((i) => i.kind === 'missing-health-endpoint')).toBe(false);
  });

  it('uses the REAL app variable name (not a hardcoded "app")', () => {
    const files = {
      'server/main.js': "const api = require('express')();\napi.listen(8080);",
    };
    const result = injectHealthEndpoint(files)!;
    expect(result.appVar).toBe('api');
    expect(result.newContent).toContain("api.get('/health',");
  });

  it('preserves the indentation of the listen line', () => {
    const files = {
      'server/index.ts': [
        "import express from 'express';",
        'function start() {',
        '  const app = express();',
        '  app.listen(3000);',
        '}',
      ].join('\n'),
    };
    const result = injectHealthEndpoint(files)!;
    expect(result.newContent).toContain("  app.get('/health',");
  });

  it('handles `const server = app.listen(...)` (injects before that line)', () => {
    const files = {
      'server/index.ts': "import express from 'express';\nconst app = express();\nconst server = app.listen(process.env.PORT, () => console.log('up'));",
    };
    const result = injectHealthEndpoint(files)!;
    expect(result.newContent.indexOf("'/health'")).toBeLessThan(result.newContent.indexOf('const server = app.listen'));
  });

  it('returns null when a health route already exists (no duplicate)', () => {
    const files = {
      'server/index.ts': "import express from 'express';\nconst app = express();\napp.get('/healthz', (_r, s) => s.end());\napp.listen(3000);",
    };
    expect(injectHealthEndpoint(files)).toBeNull();
  });

  it('returns null when there is no Express app', () => {
    expect(injectHealthEndpoint({ 'src/App.tsx': 'export const A = () => null;' })).toBeNull();
  });

  it('returns null when the app is never .listen()-ed in the same file (ambiguous placement)', () => {
    const files = {
      'server/app.ts': "import express from 'express';\nexport const app = express();",
      'server/boot.ts': "import { app } from './app';\napp.listen(3000);",
    };
    expect(injectHealthEndpoint(files)).toBeNull();
  });

  it('returns null when MORE THAN ONE backend file declares an Express app (ambiguous entry)', () => {
    const files = {
      'server/a.ts': "import express from 'express';\nconst app = express();\napp.listen(3000);",
      'server/b.ts': "import express from 'express';\nconst app2 = express();\napp2.listen(3001);",
    };
    expect(injectHealthEndpoint(files)).toBeNull();
  });

  it('ignores node_modules / dist / test files when locating the Express app', () => {
    const files = {
      'node_modules/x/index.js': 'const app = express(); app.listen(3000);',
      'dist/server.js': 'const app = express(); app.listen(3000);',
      'server/index.test.ts': 'const app = express(); app.listen(3000);',
    };
    expect(injectHealthEndpoint(files)).toBeNull();
  });

  it('is idempotent: injecting twice does not add a second route', () => {
    const files = {
      'server/index.ts': "import express from 'express';\nconst app = express();\napp.listen(3000);",
    };
    const once = injectHealthEndpoint(files)!;
    const twice = injectHealthEndpoint({ 'server/index.ts': once.newContent });
    expect(twice).toBeNull();
  });
});
