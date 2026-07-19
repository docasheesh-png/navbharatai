import { describe, it, expect } from 'vitest';
import { generateErrorTrackingIntegration, isErrorTrackingProvider } from './ErrorTrackingGenerator';

describe('generateErrorTrackingIntegration — Sentry', () => {
  const c = generateErrorTrackingIntegration('sentry');

  it('wires BOTH a server and a client helper with init + captureError', () => {
    const server = c.files['server/lib/errorTracking.ts'];
    expect(server).toContain("import * as Sentry from '@sentry/node'");
    expect(server).toContain('Sentry.init({');
    expect(server).toContain('export function captureError(error: unknown)');
    expect(server).toContain('Sentry.captureException(error)');
    expect(server).toContain('SENTRY_DSN'); // server secret

    const client = c.files['src/lib/errorTracking.ts'];
    expect(client).toContain("import * as Sentry from '@sentry/react'");
    expect(client).toContain('export function initErrorTracking()');
    expect(client).toContain('VITE_SENTRY_DSN'); // public browser DSN
    expect(client).toContain('if (!dsn) return'); // no DSN → off, app unaffected
  });

  it('declares server+client env + both @sentry deps + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['SENTRY_DSN', 'VITE_SENTRY_DSN']);
    expect(c.dependencies).toEqual([
      { name: '@sentry/node', version: '^8' },
      { name: '@sentry/react', version: '^8' },
    ]);
    expect(c.files['.env.example']).toContain('SENTRY_DSN=\n');
    expect(c.files['.env.example']).toContain('VITE_SENTRY_DSN=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('FIRST'); // import order matters for Sentry instrumentation
  });

  it('.env.example carries NO real secret values (blank RHS only)', () => {
    for (const line of c.files['.env.example'].split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
  });
});

describe('generateErrorTrackingIntegration — Rollbar', () => {
  const c = generateErrorTrackingIntegration('rollbar');

  it('wires a server + client helper that capture uncaught errors', () => {
    const server = c.files['server/lib/errorTracking.ts'];
    expect(server).toContain("import Rollbar from 'rollbar'");
    expect(server).toContain('captureUncaught: true');
    expect(server).toContain('ROLLBAR_SERVER_TOKEN');
    const client = c.files['src/lib/errorTracking.ts'];
    expect(client).toContain('VITE_ROLLBAR_CLIENT_TOKEN');
    expect(client).toContain('rollbar?.error(error as Error)'); // no-ops if uninitialized
  });

  it('declares tokens + the single rollbar dependency', () => {
    expect(c.envKeys).toEqual(['ROLLBAR_SERVER_TOKEN', 'VITE_ROLLBAR_CLIENT_TOKEN']);
    expect(c.dependencies).toEqual([{ name: 'rollbar', version: '^2' }]);
  });
});

describe('isErrorTrackingProvider — guard', () => {
  it('accepts the two supported providers, rejects everything else', () => {
    expect(isErrorTrackingProvider('sentry')).toBe(true);
    expect(isErrorTrackingProvider('rollbar')).toBe(true);
    expect(isErrorTrackingProvider('bugsnag')).toBe(false);
    expect(isErrorTrackingProvider(undefined)).toBe(false);
  });
});
