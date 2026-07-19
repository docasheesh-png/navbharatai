// U-4 (verified recipe modules) — error/exception-tracking generator (Sentry + Rollbar).
//
// Real, working crash + exception reporting generated into the app, Bring-Your-Own-keys (the user pastes
// their project DSN/token into .env; NavBharatAI never stores it). Error tracking is what turns "a user hit
// a bug" into an alert with a stack trace, release and breadcrumbs — the difference between fixing a crash
// and never hearing about it. Each recipe wires BOTH sides: a SERVER helper (init + captureError) and a
// CLIENT helper (init + captureError), because a real app crashes in both places. PURE builders; the
// generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.
//
// Keys: the SERVER DSN/token is a secret (server-only); the CLIENT DSN/token is a public browser value by
// design (exposed as VITE_* so a Vite app reads it in the browser; Next: rename to NEXT_PUBLIC_*).

export type ErrorTrackingProvider = 'sentry' | 'rollbar';

export interface ErrorTrackingConfig {
  provider: ErrorTrackingProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Sentry ───────────────────────────────────────────────────────────────────────────────────────────────
const SENTRY_SERVER = `import * as Sentry from '@sentry/node';

// Bring-Your-Own Sentry DSN — Sentry → Project → Settings → Client Keys (DSN). Pasted into .env as a server
// secret. IMPORTANT: import this file BEFORE anything else in your server entry so Sentry can instrument the
// app (e.g. \`import './lib/errorTracking';\` as the very first line of server/index.ts).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

// After your routes are mounted, register Sentry's Express error handler: Sentry.setupExpressErrorHandler(app).
export function captureError(error: unknown): void {
  Sentry.captureException(error);
}

export { Sentry };
`;

const SENTRY_CLIENT = `import * as Sentry from '@sentry/react';

// Call ONCE at app start (before rendering). The DSN is the PUBLIC browser DSN — safe to ship. In Vite expose
// it as VITE_SENTRY_DSN; in Next as NEXT_PUBLIC_SENTRY_DSN.
export function initErrorTracking(): void {
  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn) return; // no DSN configured → error tracking stays off, the app is unaffected
  Sentry.init({ dsn, tracesSampleRate: 1.0 });
}

export function captureError(error: unknown): void {
  Sentry.captureException(error);
}
`;

// ── Rollbar ──────────────────────────────────────────────────────────────────────────────────────────────
const ROLLBAR_SERVER = `import Rollbar from 'rollbar';

// Bring-Your-Own Rollbar server access token — Rollbar → Project Settings → Project Access Tokens
// (post_server_item). Pasted into .env as a server secret.
const rollbar = new Rollbar({
  accessToken: process.env.ROLLBAR_SERVER_TOKEN,
  environment: process.env.NODE_ENV || 'development',
  captureUncaught: true,
  captureUnhandledRejections: true,
});

export function captureError(error: unknown): void {
  rollbar.error(error as Error);
}

export { rollbar };
`;

const ROLLBAR_CLIENT = `import Rollbar from 'rollbar';

// The CLIENT token is the public post_client_item token (safe to ship). In Vite expose it as
// VITE_ROLLBAR_CLIENT_TOKEN; in Next as NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN.
let rollbar: Rollbar | null = null;

export function initErrorTracking(): void {
  const accessToken = import.meta.env?.VITE_ROLLBAR_CLIENT_TOKEN;
  if (!accessToken || rollbar) return; // no token → stays off, the app is unaffected
  rollbar = new Rollbar({ accessToken, captureUncaught: true, captureUnhandledRejections: true });
}

export function captureError(error: unknown): void {
  rollbar?.error(error as Error);
}
`;

const SENTRY_INSTRUCTIONS =
  'Sentry error tracking wired. Paste your Sentry DSN into .env (server as SENTRY_DSN, browser as ' +
  'VITE_SENTRY_DSN) — NavBharatAI never stores it. Import server/lib/errorTracking FIRST in your server entry ' +
  '(so Sentry instruments the app) and add Sentry.setupExpressErrorHandler(app) after your routes; on the ' +
  'client call initErrorTracking() once at startup. Both captureError(err) helpers report to the same project.';

const ROLLBAR_INSTRUCTIONS =
  'Rollbar error tracking wired. Paste your Rollbar tokens into .env (server post_server_item as ' +
  'ROLLBAR_SERVER_TOKEN, browser post_client_item as VITE_ROLLBAR_CLIENT_TOKEN) — NavBharatAI never stores ' +
  'them. On the client call initErrorTracking() once at startup; on the server the recipe captures uncaught ' +
  'errors automatically, and captureError(err) reports one explicitly.';

export function generateErrorTrackingIntegration(provider: ErrorTrackingProvider): ErrorTrackingConfig {
  if (provider === 'sentry') {
    return {
      provider,
      files: {
        'server/lib/errorTracking.ts': SENTRY_SERVER,
        'src/lib/errorTracking.ts': SENTRY_CLIENT,
        [ENV_EXAMPLE]: 'SENTRY_DSN=\nVITE_SENTRY_DSN=\n',
      },
      envKeys: ['SENTRY_DSN', 'VITE_SENTRY_DSN'],
      dependencies: [
        { name: '@sentry/node', version: '^8' },
        { name: '@sentry/react', version: '^8' },
      ],
      instructions: SENTRY_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/errorTracking.ts': ROLLBAR_SERVER,
      'src/lib/errorTracking.ts': ROLLBAR_CLIENT,
      [ENV_EXAMPLE]: 'ROLLBAR_SERVER_TOKEN=\nVITE_ROLLBAR_CLIENT_TOKEN=\n',
    },
    envKeys: ['ROLLBAR_SERVER_TOKEN', 'VITE_ROLLBAR_CLIENT_TOKEN'],
    dependencies: [{ name: 'rollbar', version: '^2' }],
    instructions: ROLLBAR_INSTRUCTIONS,
  };
}

export function isErrorTrackingProvider(v: unknown): v is ErrorTrackingProvider {
  return v === 'sentry' || v === 'rollbar';
}
