// U-4 (verified recipe modules) — product-analytics generator (PostHog + Mixpanel).
//
// Real, working product-analytics wiring generated into the app, Bring-Your-Own-keys (the user pastes their
// project token into .env; NavBharatAI never stores it). Each recipe includes a SERVER helper (capture an
// event from backend code, with a distinctId) and a CLIENT helper (init once + track events + identify a
// user). PURE builders; the generated code is correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export type AnalyticsProvider = 'posthog' | 'mixpanel';

export interface AnalyticsConfig {
  provider: AnalyticsProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── PostHog ──────────────────────────────────────────────────────────────────────────────────────────────
const POSTHOG_SERVER = `import { PostHog } from 'posthog-node';

// Bring-Your-Own PostHog project — Project API Key + host (EU: https://eu.i.posthog.com,
// US: https://us.i.posthog.com) from PostHog → Settings → Project. Pasted into .env; never hardcode them.
const client = new PostHog(process.env.POSTHOG_KEY as string, { host: process.env.POSTHOG_HOST });

// Capture a backend event. Always attach the user's stable id as distinctId so server + client events merge.
export function trackServerEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  client.capture({ distinctId, event, properties });
}

// Flush pending events before the process exits (e.g. a serverless handler or a graceful shutdown).
export async function flushAnalytics(): Promise<void> {
  await client.shutdown();
}
`;

const POSTHOG_CLIENT = `import posthog from 'posthog-js';

// Call ONCE at app start (e.g. in your root component/entry). The key is the PUBLIC project key — safe in the
// browser. In Vite expose it as VITE_POSTHOG_KEY; in Next as NEXT_PUBLIC_POSTHOG_KEY.
let started = false;
export function initAnalytics(): void {
  if (started || typeof window === 'undefined') return;
  const key = import.meta.env?.VITE_POSTHOG_KEY;
  if (!key) return; // no key configured → analytics stays off, app is unaffected
  posthog.init(key, { api_host: import.meta.env?.VITE_POSTHOG_HOST || 'https://us.i.posthog.com' });
  started = true;
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (started) posthog.capture(event, properties);
}

// Tie subsequent events to a signed-in user.
export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (started) posthog.identify(userId, traits);
}
`;

// ── Mixpanel ─────────────────────────────────────────────────────────────────────────────────────────────
const MIXPANEL_SERVER = `import Mixpanel from 'mixpanel';

// Bring-Your-Own Mixpanel project token — Mixpanel → Settings → Project Settings. Pasted into .env.
const mixpanel = Mixpanel.init(process.env.MIXPANEL_TOKEN as string);

// Capture a backend event. distinct_id ties it to the same user the client tracks.
export function trackServerEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  mixpanel.track(event, { distinct_id: distinctId, ...(properties ?? {}) });
}
`;

const MIXPANEL_CLIENT = `import mixpanel from 'mixpanel-browser';

// Call ONCE at app start. The project token is safe in the browser. In Vite expose it as VITE_MIXPANEL_TOKEN;
// in Next as NEXT_PUBLIC_MIXPANEL_TOKEN.
let started = false;
export function initAnalytics(): void {
  if (started || typeof window === 'undefined') return;
  const token = import.meta.env?.VITE_MIXPANEL_TOKEN;
  if (!token) return; // no token configured → analytics stays off, app is unaffected
  mixpanel.init(token);
  started = true;
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (started) mixpanel.track(event, properties);
}

// Tie subsequent events to a signed-in user.
export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (!started) return;
  mixpanel.identify(userId);
  if (traits) mixpanel.people.set(traits);
}
`;

const POSTHOG_INSTRUCTIONS =
  'PostHog analytics wired. Paste your PostHog Project API Key + host into .env (client key as ' +
  'VITE_POSTHOG_KEY / VITE_POSTHOG_HOST for the browser) — NavBharatAI never stores them. Call initAnalytics() ' +
  'once at app start, then track("Signed up", {...}) / identify(userId) anywhere; use trackServerEvent() from ' +
  'backend code. Analytics stays OFF (and the app is unaffected) if no key is set.';

const MIXPANEL_INSTRUCTIONS =
  'Mixpanel analytics wired. Paste your Mixpanel project token into .env (client token as VITE_MIXPANEL_TOKEN ' +
  'for the browser) — NavBharatAI never stores it. Call initAnalytics() once at app start, then track(...) / ' +
  'identify(userId) anywhere; use trackServerEvent() from backend code. Analytics stays OFF (and the app is ' +
  'unaffected) if no token is set.';

export function generateAnalyticsIntegration(provider: AnalyticsProvider): AnalyticsConfig {
  if (provider === 'posthog') {
    return {
      provider,
      files: {
        'server/lib/analytics.ts': POSTHOG_SERVER,
        'src/lib/analytics.ts': POSTHOG_CLIENT,
        [ENV_EXAMPLE]: 'POSTHOG_KEY=\nPOSTHOG_HOST=\nVITE_POSTHOG_KEY=\nVITE_POSTHOG_HOST=\n',
      },
      envKeys: ['POSTHOG_KEY', 'POSTHOG_HOST', 'VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST'],
      dependencies: [
        { name: 'posthog-node', version: '^4' },
        { name: 'posthog-js', version: '^1' },
      ],
      instructions: POSTHOG_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/analytics.ts': MIXPANEL_SERVER,
      'src/lib/analytics.ts': MIXPANEL_CLIENT,
      [ENV_EXAMPLE]: 'MIXPANEL_TOKEN=\nVITE_MIXPANEL_TOKEN=\n',
    },
    envKeys: ['MIXPANEL_TOKEN', 'VITE_MIXPANEL_TOKEN'],
    dependencies: [
      { name: 'mixpanel', version: '^0.18' },
      { name: 'mixpanel-browser', version: '^2' },
    ],
    instructions: MIXPANEL_INSTRUCTIONS,
  };
}

export function isAnalyticsProvider(v: unknown): v is AnalyticsProvider {
  return v === 'posthog' || v === 'mixpanel';
}
