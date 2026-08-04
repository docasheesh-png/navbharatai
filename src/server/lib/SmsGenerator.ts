// U-4 (verified recipe modules) — transactional-SMS generator (Twilio + Vonage).
//
// Real, working transactional SMS generated into the app, Bring-Your-Own-keys (the user pastes their provider
// credentials into .env; NavBharatAI never stores them). This is arbitrary outbound SMS — order confirmations,
// shipping alerts, appointment reminders, notifications — DISTINCT from the phone-OTP recipe (generate_otp),
// which is login/verification only. Each recipe is a SERVER helper sendSms(to, body); sending an SMS from the
// browser would leak the credentials, so it is always server-side. PURE builders; the generated code is
// correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type SmsProvider = 'twilio' | 'vonage';

export interface SmsConfig {
  provider: SmsProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Twilio (Messages API) ────────────────────────────────────────────────────────────────────────────────
const TWILIO_SERVER = `import twilio from 'twilio';

// Bring-Your-Own Twilio credentials — Account SID + Auth Token from the Twilio Console, and a Twilio phone
// number (or Messaging Service sender) as TWILIO_FROM_NUMBER. Pasted into .env; never hardcode them.
const client = twilio(process.env.TWILIO_ACCOUNT_SID as string, process.env.TWILIO_AUTH_TOKEN as string);

// Send a transactional SMS. \`to\` must be E.164 (e.g. +919876543210). Returns the provider message SID.
export async function sendSms(to: string, body: string): Promise<string> {
  const message = await client.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER as string, body });
  return message.sid;
}
`;

// ── Vonage (SMS API) ─────────────────────────────────────────────────────────────────────────────────────
const VONAGE_SERVER = `import { Vonage } from '@vonage/server-sdk';

// Bring-Your-Own Vonage credentials — API Key + API Secret from the Vonage Dashboard, and a sender id/number
// as VONAGE_FROM. Pasted into .env; never hardcode them.
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY as string,
  apiSecret: process.env.VONAGE_API_SECRET as string,
});

// Send a transactional SMS. \`to\` is the recipient number in international format (e.g. 919876543210).
export async function sendSms(to: string, body: string): Promise<string> {
  const resp = await vonage.sms.send({ to, from: process.env.VONAGE_FROM as string, text: body });
  return resp.messages[0]['message-id'];
}
`;

const TWILIO_INSTRUCTIONS =
  'Twilio transactional SMS wired. Paste your Twilio Account SID, Auth Token and a from-number ' +
  '(TWILIO_FROM_NUMBER) into .env — NavBharatAI never stores them. Import sendSms(to, body) and call it from ' +
  'server code (order confirmations, alerts). Numbers must be E.164 (e.g. +919876543210). SMS is always sent ' +
  'server-side so the credentials never reach the browser. For login OTP use the generate_otp recipe instead.';

const VONAGE_INSTRUCTIONS =
  'Vonage transactional SMS wired. Paste your Vonage API Key, API Secret and a sender (VONAGE_FROM) into .env ' +
  '— NavBharatAI never stores them. Import sendSms(to, body) and call it from server code. SMS is always sent ' +
  'server-side so the credentials never reach the browser. For login OTP use the generate_otp recipe instead.';

export function generateSmsIntegration(provider: SmsProvider): SmsConfig {
  if (provider === 'twilio') {
    return {
      provider,
      files: {
        'server/lib/sms.ts': TWILIO_SERVER,
        [ENV_EXAMPLE]: 'TWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\nTWILIO_FROM_NUMBER=\n',
      },
      envKeys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
      dependency: { name: 'twilio', version: '^5' },
      instructions: TWILIO_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/sms.ts': VONAGE_SERVER,
      [ENV_EXAMPLE]: 'VONAGE_API_KEY=\nVONAGE_API_SECRET=\nVONAGE_FROM=\n',
    },
    envKeys: ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_FROM'],
    dependency: { name: '@vonage/server-sdk', version: '^3' },
    instructions: VONAGE_INSTRUCTIONS,
  };
}

export function isSmsProvider(v: unknown): v is SmsProvider {
  return v === 'twilio' || v === 'vonage';
}
