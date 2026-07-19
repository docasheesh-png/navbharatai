// U-4 (verified recipe modules) — feature-flag generator (LaunchDarkly + Unleash).
//
// Real, working server-side feature flags generated into the app, Bring-Your-Own-keys (the user pastes their
// SDK key into .env; NavBharatAI never stores it). Feature flags are what let a team ship a feature dark, roll
// it out to 5% then 100%, run an A/B test, or kill a broken feature INSTANTLY without a redeploy. Each recipe
// is a SERVER helper: isFeatureEnabled(flag, userKey) — evaluated per user so gradual/targeted rollouts work.
// PURE builders; the generated code is correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export type FeatureFlagProvider = 'launchdarkly' | 'unleash';

export interface FeatureFlagConfig {
  provider: FeatureFlagProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── LaunchDarkly (server SDK) ────────────────────────────────────────────────────────────────────────────
const LAUNCHDARKLY_SERVER = `import * as ld from '@launchdarkly/node-server-sdk';

// Bring-Your-Own LaunchDarkly SDK key — LaunchDarkly → Account settings → Projects → SDK key (server-side).
// Pasted into .env as a server secret; never hardcode it.
const client = ld.init(process.env.LAUNCHDARKLY_SDK_KEY as string);
const ready = client.waitForInitialization({ timeout: 10 }).catch(() => {/* evaluate falls back to the default */});

// Evaluate a boolean flag for a specific user. \`userKey\` targets the rollout (percentage/segment/individual).
// Always returns the default (false) when the flag is missing or the client can't reach LaunchDarkly.
export async function isFeatureEnabled(flag: string, userKey: string): Promise<boolean> {
  await ready;
  return client.variation(flag, { kind: 'user', key: userKey }, false);
}
`;

// ── Unleash (open-source, self-hostable) ─────────────────────────────────────────────────────────────────
const UNLEASH_SERVER = `import { initialize, isEnabled } from 'unleash-client';

// Bring-Your-Own Unleash — API URL + a client API token (Unleash → API access). Pasted into .env; never
// hardcode them. Works against Unleash Cloud or a self-hosted Unleash instance.
const unleash = initialize({
  url: process.env.UNLEASH_URL as string,
  appName: process.env.UNLEASH_APP_NAME || 'app',
  customHeaders: { Authorization: process.env.UNLEASH_API_TOKEN as string },
});
const ready = new Promise<void>((resolve) => unleash.on('ready', resolve));

// Evaluate a flag for a specific user. \`userKey\` feeds Unleash's gradual-rollout/targeting strategies.
// Returns false when the flag is unknown or Unleash is unreachable.
export async function isFeatureEnabled(flag: string, userKey: string): Promise<boolean> {
  await ready;
  return isEnabled(flag, { userId: userKey });
}
`;

const LAUNCHDARKLY_INSTRUCTIONS =
  'LaunchDarkly feature flags wired. Paste your server-side SDK key into .env as LAUNCHDARKLY_SDK_KEY — ' +
  'NavBharatAI never stores it. Import isFeatureEnabled(flag, userKey) and gate features/routes with it; the ' +
  'userKey drives percentage/segment/individual rollouts. A missing flag or an unreachable service always ' +
  'falls back to false, so the app never breaks on flag trouble.';

const UNLEASH_INSTRUCTIONS =
  'Unleash feature flags wired (open-source, self-hostable). Paste your Unleash API URL + client token into ' +
  '.env (UNLEASH_URL, UNLEASH_API_TOKEN) — NavBharatAI never stores them. Import isFeatureEnabled(flag, ' +
  'userKey) and gate features/routes with it; the userKey feeds Unleash gradual-rollout strategies. An ' +
  'unknown flag or an unreachable server falls back to false.';

export function generateFeatureFlagIntegration(provider: FeatureFlagProvider): FeatureFlagConfig {
  if (provider === 'launchdarkly') {
    return {
      provider,
      files: {
        'server/lib/featureFlags.ts': LAUNCHDARKLY_SERVER,
        [ENV_EXAMPLE]: 'LAUNCHDARKLY_SDK_KEY=\n',
      },
      envKeys: ['LAUNCHDARKLY_SDK_KEY'],
      dependency: { name: '@launchdarkly/node-server-sdk', version: '^9' },
      instructions: LAUNCHDARKLY_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/featureFlags.ts': UNLEASH_SERVER,
      [ENV_EXAMPLE]: 'UNLEASH_URL=\nUNLEASH_API_TOKEN=\nUNLEASH_APP_NAME=\n',
    },
    envKeys: ['UNLEASH_URL', 'UNLEASH_API_TOKEN', 'UNLEASH_APP_NAME'],
    dependency: { name: 'unleash-client', version: '^6' },
    instructions: UNLEASH_INSTRUCTIONS,
  };
}

export function isFeatureFlagProvider(v: unknown): v is FeatureFlagProvider {
  return v === 'launchdarkly' || v === 'unleash';
}
