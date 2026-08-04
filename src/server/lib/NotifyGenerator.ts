// U-4 (verified recipe modules) — team-notification generator (Slack + Discord webhooks).
//
// Real, working "ping our team channel" notifications generated into the app, Bring-Your-Own-webhook (the
// user pastes an incoming-webhook URL into .env; NavBharatAI never stores it). This is the operational
// heartbeat of most apps — a new order, a signup, a failed payment, a support request posted straight into
// Slack/Discord. Each recipe is a SERVER helper (the webhook URL is a secret and must never reach the
// browser): notify(message). Both providers are plain incoming webhooks called with the built-in fetch, so
// NO npm dependency is needed. PURE builders; the generated code is correct and complete — no TODO stubs
// (the real-features rule). Unit-tested.

export type NotifyProvider = 'slack' | 'discord';

export interface NotifyConfig {
  provider: NotifyProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers are incoming webhooks called with the global fetch — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Slack (incoming webhook) ─────────────────────────────────────────────────────────────────────────────
const SLACK_SERVER = `// Bring-Your-Own Slack incoming webhook — api.slack.com/messaging/webhooks → create one for your channel.
// Pasted into .env as SLACK_WEBHOOK_URL. It targets a specific channel; the URL is a secret (server-only).
const WEBHOOK = process.env.SLACK_WEBHOOK_URL as string;

// Post a message to the Slack channel. Returns true when Slack accepted it; never throws, so a notification
// failure can't break the request that triggered it.
export async function notify(message: string): Promise<boolean> {
  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
`;

// ── Discord (incoming webhook) ───────────────────────────────────────────────────────────────────────────
const DISCORD_SERVER = `// Bring-Your-Own Discord webhook — Channel → Edit → Integrations → Webhooks → New Webhook. Pasted into .env
// as DISCORD_WEBHOOK_URL. It targets a specific channel; the URL is a secret (server-only).
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL as string;

// Post a message to the Discord channel. Returns true when Discord accepted it (2xx); never throws, so a
// notification failure can't break the request that triggered it.
export async function notify(message: string): Promise<boolean> {
  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    return r.ok; // Discord returns 204 No Content on success
  } catch {
    return false;
  }
}
`;

const SLACK_INSTRUCTIONS =
  'Slack notifications wired. Create an incoming webhook for your channel and paste the URL into .env as ' +
  'SLACK_WEBHOOK_URL — NavBharatAI never stores it. Import notify(message) and call it on the events that ' +
  'matter (new order, signup, failed payment). It never throws, so a Slack outage never breaks the request. ' +
  'The webhook URL stays server-side.';

const DISCORD_INSTRUCTIONS =
  'Discord notifications wired. Create a channel webhook and paste the URL into .env as DISCORD_WEBHOOK_URL — ' +
  'NavBharatAI never stores it. Import notify(message) and call it on the events that matter. It never ' +
  'throws, so a Discord outage never breaks the request. The webhook URL stays server-side.';

export function generateNotifyIntegration(provider: NotifyProvider): NotifyConfig {
  if (provider === 'slack') {
    return {
      provider,
      files: {
        'server/lib/notify.ts': SLACK_SERVER,
        [ENV_EXAMPLE]: 'SLACK_WEBHOOK_URL=\n',
      },
      envKeys: ['SLACK_WEBHOOK_URL'],
      instructions: SLACK_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/notify.ts': DISCORD_SERVER,
      [ENV_EXAMPLE]: 'DISCORD_WEBHOOK_URL=\n',
    },
    envKeys: ['DISCORD_WEBHOOK_URL'],
    instructions: DISCORD_INSTRUCTIONS,
  };
}

export function isNotifyProvider(v: unknown): v is NotifyProvider {
  return v === 'slack' || v === 'discord';
}
