// U-4 (verified recipe modules) — newsletter / mailing-list generator (Mailchimp + Brevo).
//
// Real, working email-list signup generated into the app, Bring-Your-Own-keys (the user pastes their provider
// key + list id into .env; NavBharatAI never stores them). This is the "join our newsletter / waitlist"
// capability on almost every landing page — DISTINCT from the transactional-email recipe (generate_email),
// which SENDS one-off emails; this ADDS a contact to a marketing list. Each recipe is a SERVER helper (the
// key is a secret and must never reach the browser): subscribe(email, name?). Both providers are plain REST
// APIs called with the built-in fetch, so NO npm dependency is needed. PURE builders; the generated code is
// correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type NewsletterProvider = 'mailchimp' | 'brevo';

export interface NewsletterConfig {
  provider: NewsletterProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Mailchimp (Marketing API) ────────────────────────────────────────────────────────────────────────────
const MAILCHIMP_SERVER = `// Bring-Your-Own Mailchimp — API key (Account → Extras → API keys) + Audience/List ID (Audience →
// Settings → Audience name and defaults). Pasted into .env. The data-center is the suffix of the API key
// (e.g. '...-us21' → 'us21'); we derive it automatically. Server secret; must never reach the browser.
const KEY = process.env.MAILCHIMP_API_KEY as string;
const LIST_ID = process.env.MAILCHIMP_LIST_ID as string;
const DC = KEY?.split('-')[1] ?? 'us1';

// Add (or update) a subscriber on the audience. Returns true when Mailchimp accepted it.
export async function subscribe(email: string, name?: string): Promise<boolean> {
  const auth = Buffer.from('anystring:' + KEY).toString('base64');
  const r = await fetch('https://' + DC + '.api.mailchimp.com/3.0/lists/' + LIST_ID + '/members', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_address: email, status: 'subscribed', merge_fields: name ? { FNAME: name } : undefined }),
  });
  return r.ok;
}
`;

// ── Brevo (formerly Sendinblue) ──────────────────────────────────────────────────────────────────────────
const BREVO_SERVER = `// Bring-Your-Own Brevo — API key (Brevo → SMTP & API → API keys) + a contact List ID (Contacts → Lists).
// Pasted into .env. Server secret; must never reach the browser.
const KEY = process.env.BREVO_API_KEY as string;
const LIST_ID = Number(process.env.BREVO_LIST_ID);

// Add (or update) a contact on the list. Returns true when Brevo accepted it.
export async function subscribe(email: string, name?: string): Promise<boolean> {
  const r = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, listIds: [LIST_ID], updateEnabled: true, attributes: name ? { FIRSTNAME: name } : undefined }),
  });
  // 201 (created) and 204 (updated) are both success.
  return r.ok;
}
`;

const MAILCHIMP_INSTRUCTIONS =
  'Mailchimp newsletter signup wired. Paste your Mailchimp API key + Audience/List ID into .env ' +
  '(MAILCHIMP_API_KEY, MAILCHIMP_LIST_ID) — NavBharatAI never stores them. The data-center is derived from ' +
  'the key automatically. Import subscribe(email, name?) and call it from your signup form handler on the ' +
  'server. The key stays server-side. To SEND one-off emails instead, use the generate_email recipe.';

const BREVO_INSTRUCTIONS =
  'Brevo newsletter signup wired. Paste your Brevo API key + a contact List ID into .env (BREVO_API_KEY, ' +
  'BREVO_LIST_ID) — NavBharatAI never stores them. Import subscribe(email, name?) and call it from your ' +
  'signup form handler on the server. The key stays server-side. To SEND one-off emails instead, use the ' +
  'generate_email recipe.';

export function generateNewsletterIntegration(provider: NewsletterProvider): NewsletterConfig {
  if (provider === 'mailchimp') {
    return {
      provider,
      files: {
        'server/lib/newsletter.ts': MAILCHIMP_SERVER,
        [ENV_EXAMPLE]: 'MAILCHIMP_API_KEY=\nMAILCHIMP_LIST_ID=\n',
      },
      envKeys: ['MAILCHIMP_API_KEY', 'MAILCHIMP_LIST_ID'],
      instructions: MAILCHIMP_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/newsletter.ts': BREVO_SERVER,
      [ENV_EXAMPLE]: 'BREVO_API_KEY=\nBREVO_LIST_ID=\n',
    },
    envKeys: ['BREVO_API_KEY', 'BREVO_LIST_ID'],
    instructions: BREVO_INSTRUCTIONS,
  };
}

export function isNewsletterProvider(v: unknown): v is NewsletterProvider {
  return v === 'mailchimp' || v === 'brevo';
}
