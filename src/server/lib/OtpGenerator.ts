// U-4 (verified recipe modules) — OTP phone-verification generator (MSG91 + Twilio).
//
// A real, working phone-OTP login/verification flow generated into the app, Bring-Your-Own-keys (the user
// pastes their provider credentials into .env; NavBharatAI never stores them). Phone-OTP login is the most
// common auth pattern in India-first apps, so MSG91 (an India-first provider, like Razorpay leads payments)
// is the primary; Twilio Verify is the global alternative.
//
// Each recipe includes a SERVER route (send OTP + verify OTP — the verification is always done server-side
// against the provider; a client-reported "verified" is never trusted) and a CLIENT helper. The generated
// code is correct and complete — no TODO stubs (the real-features rule). PURE builders; unit-tested.

export type OtpProvider = 'msg91' | 'twilio';

export interface OtpConfig {
  provider: OtpProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** MSG91 uses the global fetch against its v5 REST API, so it needs no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── MSG91 (India-first, v5 REST API via global fetch — no SDK dependency) ────────────────────────────────
const MSG91_SERVER = `import { Router } from 'express';

// Bring-Your-Own MSG91 credentials — from MSG91 Dashboard → API → Auth Key, and an approved OTP template.
// Pasted into .env; never hardcode them. The mobile number MUST include the country code (e.g. 919876543210).
const AUTH_KEY = process.env.MSG91_AUTH_KEY as string;
const TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID as string;

export const otpRouter = Router();

// 1) Send an OTP to a phone number. MSG91 generates + stores the code and texts it via your template.
otpRouter.post('/send', async (req, res) => {
  const { mobile } = req.body ?? {};
  if (typeof mobile !== 'string' || !/^\\d{10,15}$/.test(mobile)) {
    return res.status(400).json({ error: 'mobile (with country code, digits only) is required' });
  }
  try {
    const url = 'https://control.msg91.com/api/v5/otp?template_id=' + encodeURIComponent(TEMPLATE_ID) + '&mobile=' + encodeURIComponent(mobile);
    const r = await fetch(url, { method: 'POST', headers: { authkey: AUTH_KEY, 'Content-Type': 'application/json' } });
    const data = await r.json();
    if (data?.type === 'success') return res.json({ sent: true });
    return res.status(502).json({ error: data?.message || 'Could not send the OTP' });
  } catch {
    res.status(500).json({ error: 'Could not reach the OTP provider' });
  }
});

// 2) Verify the OTP the user typed — done SERVER-SIDE against MSG91, never trusted from the client.
otpRouter.post('/verify', async (req, res) => {
  const { mobile, otp } = req.body ?? {};
  if (typeof mobile !== 'string' || typeof otp !== 'string') {
    return res.status(400).json({ error: 'mobile and otp are required' });
  }
  try {
    const url = 'https://control.msg91.com/api/v5/otp/verify?otp=' + encodeURIComponent(otp) + '&mobile=' + encodeURIComponent(mobile);
    const r = await fetch(url, { method: 'GET', headers: { authkey: AUTH_KEY } });
    const data = await r.json();
    const verified = data?.type === 'success';
    res.status(verified ? 200 : 400).json({ verified });
  } catch {
    res.status(500).json({ error: 'Could not reach the OTP provider' });
  }
});
`;

// ── Twilio (global — Verify API) ─────────────────────────────────────────────────────────────────────────
const TWILIO_SERVER = `import { Router } from 'express';
import twilio from 'twilio';

// Bring-Your-Own Twilio credentials — Account SID + Auth Token from the Twilio Console, and a Verify Service
// SID (Console → Verify → Services). Pasted into .env; never hardcode them. \`to\` must be E.164 (+919876543210).
const client = twilio(process.env.TWILIO_ACCOUNT_SID as string, process.env.TWILIO_AUTH_TOKEN as string);
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID as string;

export const otpRouter = Router();

// 1) Send an OTP via Twilio Verify (Twilio generates, stores and expires the code for you).
otpRouter.post('/send', async (req, res) => {
  const { to } = req.body ?? {};
  if (typeof to !== 'string' || !/^\\+\\d{8,15}$/.test(to)) {
    return res.status(400).json({ error: 'to (E.164, e.g. +919876543210) is required' });
  }
  try {
    await client.verify.v2.services(VERIFY_SERVICE_SID).verifications.create({ to, channel: 'sms' });
    res.json({ sent: true });
  } catch {
    res.status(502).json({ error: 'Could not send the OTP' });
  }
});

// 2) Verify the OTP the user typed — checked SERVER-SIDE with Twilio; only status 'approved' is a real pass.
otpRouter.post('/verify', async (req, res) => {
  const { to, code } = req.body ?? {};
  if (typeof to !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'to and code are required' });
  }
  try {
    const check = await client.verify.v2.services(VERIFY_SERVICE_SID).verificationChecks.create({ to, code });
    const verified = check.status === 'approved';
    res.status(verified ? 200 : 400).json({ verified });
  } catch {
    res.status(500).json({ error: 'Could not verify the OTP' });
  }
});
`;

// ── Client helper (provider-agnostic — the same two calls to your own server) ────────────────────────────
function clientHelper(idField: 'mobile' | 'to', codeField: 'otp' | 'code'): string {
  return `// Send + verify a phone OTP against your own server (which talks to the provider). Import and use in a
// login/verification screen. The number format required by your provider is documented in .env.example.
export async function sendOtp(${idField}: string): Promise<void> {
  const r = await fetch('/api/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ${idField} }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send OTP');
}

export async function verifyOtp(${idField}: string, ${codeField}: string): Promise<boolean> {
  const r = await fetch('/api/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ${idField}, ${codeField} }),
  });
  const data = await r.json().catch(() => ({}));
  return r.ok && data.verified === true;
}
`;
}

const MSG91_INSTRUCTIONS =
  'MSG91 OTP wired (India-first). Paste your MSG91 Auth Key and an approved OTP Template ID into .env — ' +
  'NavBharatAI never stores them. Mount the router (e.g. app.use("/api/otp", otpRouter)) and call sendOtp/' +
  'verifyOtp from your login screen. The mobile number must include the country code (e.g. 919876543210). ' +
  'Verification is always done server-side against MSG91 — a client-reported success is never trusted.';

const TWILIO_INSTRUCTIONS =
  'Twilio Verify OTP wired. Paste your Twilio Account SID, Auth Token and a Verify Service SID into .env — ' +
  'NavBharatAI never stores them. Mount the router (e.g. app.use("/api/otp", otpRouter)) and call sendOtp/' +
  'verifyOtp from your login screen. Numbers must be E.164 (e.g. +919876543210). Verification is done ' +
  'server-side with Twilio — only a status of "approved" passes.';

export function generateOtpIntegration(provider: OtpProvider): OtpConfig {
  if (provider === 'msg91') {
    return {
      provider,
      files: {
        'server/routes/otp.ts': MSG91_SERVER,
        'src/lib/otp.ts': clientHelper('mobile', 'otp'),
        [ENV_EXAMPLE]: 'MSG91_AUTH_KEY=\nMSG91_TEMPLATE_ID=\n',
      },
      envKeys: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'],
      // MSG91 v5 is a REST API called with the global fetch — no npm dependency needed.
      instructions: MSG91_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/routes/otp.ts': TWILIO_SERVER,
      'src/lib/otp.ts': clientHelper('to', 'code'),
      [ENV_EXAMPLE]: 'TWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\nTWILIO_VERIFY_SERVICE_SID=\n',
    },
    envKeys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'],
    dependency: { name: 'twilio', version: '^5' },
    instructions: TWILIO_INSTRUCTIONS,
  };
}

export function isOtpProvider(v: unknown): v is OtpProvider {
  return v === 'msg91' || v === 'twilio';
}
