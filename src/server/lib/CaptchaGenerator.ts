// U-4 (verified recipe modules) — CAPTCHA / bot-protection verification (dependency-free, BYO secret).
//
// Any public form — signup, login, contact, "request a callback" — gets hammered by bots the moment it ships:
// fake accounts, spam, credential-stuffing. A CAPTCHA widget on the client is only half the defence; the token
// it produces MUST be verified SERVER-SIDE against the provider, because a bot can just skip the widget and
// POST a blank/forged token. The common mistake is trusting the client, or "verifying" but failing OPEN so an
// outage silently lets every bot through. This recipe adds the real server verifier for the three major
// providers (Cloudflare Turnstile, hCaptcha, Google reCAPTCHA v2/v3), selected by one env var, calling the
// provider's siteverify endpoint with the built-in fetch — NO npm dependency. It fails CLOSED (an
// unverifiable token is rejected) because the entire point is to block bots. PURE builder; correct and
// complete — no TODO stubs (the real-features rule). Unit-tested.

export interface CaptchaConfig {
  files: Record<string, string>;
  /** CAPTCHA_PROVIDER + CAPTCHA_SECRET (+ optional CAPTCHA_MIN_SCORE for reCAPTCHA v3). */
  envKeys: string[];
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const CAPTCHA_SERVER = `// Server-side CAPTCHA verification. Set CAPTCHA_PROVIDER ('turnstile' | 'hcaptcha' | 'recaptcha') and
// CAPTCHA_SECRET in .env (server secret — never ship it to the browser). For reCAPTCHA v3, CAPTCHA_MIN_SCORE
// (default 0.5) is the pass threshold. All three verify the client's token against the provider's siteverify
// endpoint with the built-in fetch — no npm dependency.

const PROVIDER = (process.env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
const SECRET = process.env.CAPTCHA_SECRET as string;

const ENDPOINTS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

// Verify a CAPTCHA token submitted with a form. Call this on the server BEFORE you trust the request (create
// the account, send the message, …); if it returns false, reject with 400. Optionally pass the client IP for
// the provider's extra risk signal. FAILS CLOSED: a missing secret, a network error, or a provider error all
// return false — a bot must never slip through because verification was unavailable.
export async function verifyCaptcha(token: string, remoteip?: string): Promise<boolean> {
  const endpoint = ENDPOINTS[PROVIDER];
  if (!endpoint || !SECRET || !token) return false;
  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    if (remoteip) body.set('remoteip', remoteip);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json()) as { success?: boolean; score?: number };
    if (data.success !== true) return false;
    // reCAPTCHA v3 returns a 0..1 risk score — enforce a minimum. v2/Turnstile/hCaptcha omit it (pass).
    if (typeof data.score === 'number') {
      const min = Number(process.env.CAPTCHA_MIN_SCORE ?? '0.5');
      return data.score >= (Number.isFinite(min) ? min : 0.5);
    }
    return true;
  } catch {
    return false; // fail CLOSED — bot protection must not pass requests through on an outage.
  }
}
`;

const INSTRUCTIONS =
  'CAPTCHA verification wired at server/lib/captcha.ts (no dependency — provider siteverify via fetch). Set ' +
  "CAPTCHA_PROVIDER ('turnstile' | 'hcaptcha' | 'recaptcha') and CAPTCHA_SECRET in .env (server secret). On " +
  'every public form route (signup/login/contact), call await verifyCaptcha(req.body.captchaToken, req.ip) ' +
  'BEFORE acting on the request and return 400 if it is false — the client widget alone is not enough, a bot ' +
  'can forge the token. For reCAPTCHA v3 set CAPTCHA_MIN_SCORE (default 0.5). It FAILS CLOSED (an unverifiable ' +
  'token is rejected), so an outage never lets bots through. You paste your secret into .env; NavBharatAI ' +
  'never stores it.';

export function generateCaptchaIntegration(): CaptchaConfig {
  return {
    files: {
      'server/lib/captcha.ts': CAPTCHA_SERVER,
      [ENV_EXAMPLE]: 'CAPTCHA_PROVIDER=turnstile\nCAPTCHA_SECRET=\n# reCAPTCHA v3 only — pass threshold 0..1 (default 0.5)\nCAPTCHA_MIN_SCORE=0.5\n',
    },
    envKeys: ['CAPTCHA_PROVIDER', 'CAPTCHA_SECRET', 'CAPTCHA_MIN_SCORE'],
    instructions: INSTRUCTIONS,
  };
}
