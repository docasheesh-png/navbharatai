// "KAHAN SE MILEGA" — the credential recipe registry (admin 2026-08-17).
//
// WHY THIS FILE EXISTS. NavBharatAI already tells a user WHICH key an app needs and WHERE IN NAVBHARATAI
// to paste it (AppRequirements.ts, secretRequest.ts). It has never told them the one thing they are
// actually stuck on: where the key comes from in the FIRST place. "Add RAZORPAY_KEY_ID in Settings →
// Secrets & API Keys" is a perfect instruction for somebody who already has a Razorpay key, and useless
// for everybody else — which is most people.
//
// That knowledge DID exist in this codebase, five times over and drifting:
//   src/lib/dbProviders.ts        — keyLink + per-field `where` for 11 databases
//   src/lib/paymentSetup.ts       — dashboardLink + per-field `where` for the payment gateways
//   src/components/settings/AuthSettings.tsx / StorageSettings.tsx — the same shape again
//   src/components/ide/APIMarketplace.tsx — 33 services with `steps`, and no links at all
// …and NONE of it was reachable from AppRequirements.ts, the one module that actually decides what the
// app in front of the user needs. So the knowledge existed and never arrived. This is that knowledge in
// ONE place, keyed by the service ids AppRequirements already owns.
//
// ── THE DIVISION OF OWNERSHIP (this is what stops the drift coming back) ─────────────────────────────
// AppRequirements.ts owns WHICH ENV VARS a service needs. This file owns WHERE THE HUMAN GETS THEM.
// A recipe therefore NEVER re-declares an env var list — it only annotates names that module already
// knows, and `recipeVarNames()` is cross-checked against its `serviceEnvNames()` by this module's test
// suite, so a name that drifts apart there fails CI instead of silently dropping the annotation.
// Re-declaring the names would recreate exactly the five-way drift this file was written to end.
//
// ── WHY A CURATED TABLE AND NOT AN LLM ──────────────────────────────────────────────────────────────
// A console path is a FACT with a short shelf life, and it is a fact about somebody's money. A model
// asked "where are Razorpay's API keys?" answers fluently and is subtly wrong the moment a dashboard is
// reorganised — and a user who follows a confidently wrong path into a payment console does not blame
// the model, they lose trust in NavBharatAI. A table cannot hallucinate. It can go stale, which is a
// different and much safer failure: see LINK MAINTENANCE below.
//
// ── LINK MAINTENANCE (honest boundary, rule 6) ──────────────────────────────────────────────────────
// Every `link` below is a console entry point deliberately chosen to be STABLE rather than deep — the
// page a provider is least likely to move. `path` is then written to SURVIVE that link going stale: it
// names the clicks, so a user who lands on a reorganised console root can still finish. The link is
// only ever a convenience on top of a path that stands on its own.
//
// VERIFIED 2026-08-17 against each provider's own current documentation. That pass corrected three
// entries that were wrong from memory — MSG91's auth-key URL, Clerk's deep link (replaced with the
// dashboard root, which cannot rot the same way), and the Google Maps order of operations (the API must
// be ENABLED before a key will work, which is the single most common reason a fresh Maps key returns an
// error). It also added the facts a first-timer actually trips on: which values are shown only once,
// which need an OTP or an admin role, and which need KYC.
//
// This cannot be verified automatically from CI — the build environment cannot reach these hosts, and
// even where it can, a console page behind a login tells us nothing. So this is a HUMAN-MAINTAINED
// table with a stated verification date, not a self-checking one. Re-verify when a user reports a path
// that no longer matches, and move the date when you do.
//
// PURE — no I/O, no LLM call, zero added cost to any build.

/** One environment variable, annotated with where a human finds its value. */
export interface RecipeVar {
  /**
   * The env var name. MUST already appear in AppRequirements' catalogue for this recipe's id — this
   * module annotates names, it never introduces them.
   */
  name: string;
  /** The exact clicks inside that provider's console that reveal THIS value. */
  where: string;
  /**
   * True when the value must never reach a browser bundle. A `VITE_`/`NEXT_PUBLIC_` prefix publishes a
   * value to every visitor, so a secret key under one is a real leak rather than a style mistake — this
   * flag is what a later slice checks the saved name against.
   */
  serverOnly?: boolean;
  /**
   * Prefixes that identify a SANDBOX/TEST credential. A test key is not wrong — it is the correct thing
   * to build against — but shipping one to real users means no money ever arrives, silently. Recorded
   * here so the warning can be deterministic rather than guessed.
   */
  testPrefixes?: string[];
}

/** One provider that can satisfy a requirement (a requirement may have several — Maps is Google OR Mapbox). */
export interface CredentialOption {
  /** The provider as the USER knows it — "Razorpay", never an internal id. */
  provider: string;
  /** The console page where these values live. Always https. */
  link: string;
  /** The bare host, for surfaces where a link cannot be clicked (plain text, a voice reply, a log). */
  linkLabel: string;
  /** The clicks INSIDE that console. Written so it still works if `link` has gone stale. */
  path: string;
  /** What getting this costs. Plain language — a free tier is the single most useful fact here. */
  cost: string;
  /**
   * npm packages that identify THIS provider specifically.
   *
   * The env-var signal is stronger but arrives later — an app can declare `mapbox-gl` in package.json
   * before any code reads a token. Without this, such an app would be sent to whichever provider happens
   * to be listed first, which for Maps means handing a Mapbox user the Google Cloud Console.
   */
  packages?: string[];
  /** The variables this provider supplies, in the order its own console presents them. */
  vars: RecipeVar[];
}

export interface CredentialRecipe {
  /** The AppRequirements service id this satisfies. */
  id: string;
  /** Providers that satisfy it. The FIRST is the recommended default when we cannot tell them apart. */
  options: CredentialOption[];
  /**
   * A genuinely keyless way to get the same outcome, or null when there honestly is not one.
   *
   * This is the most valuable field in the file and the easiest to leave empty out of laziness. The best
   * possible credential help is not needing the credential: UPI takes real money with no gateway account,
   * OpenStreetMap draws a real map with no token. A user who can skip the console entirely should be told
   * so BEFORE being sent to one. `null` is an honest answer and must stay honest — never fill this with a
   * near-miss that does not actually do the same job.
   */
  keyless: string | null;
}

/**
 * The catalogue. Keyed by AppRequirements' service ids.
 *
 * Links reuse the ones already shipped and in daily use elsewhere in this repo (dbProviders.ts,
 * paymentSetup.ts, AuthSettings.tsx, StorageSettings.tsx) rather than newly invented ones — those have
 * been in front of real users, which is better evidence than a fresh guess.
 */
export const CREDENTIAL_RECIPES: CredentialRecipe[] = [
  {
    id: 'payments_razorpay',
    keyless: 'To take money in India you may not need this at all — a UPI link accepts real payments with no gateway account and no fees.',
    options: [
      {
        provider: 'Razorpay',
        link: 'https://dashboard.razorpay.com/app/keys',
        linkLabel: 'dashboard.razorpay.com',
        path: 'Account & Settings → Website and app settings → API Keys → Generate Key',
        cost: 'Free to create. Razorpay charges about 2% per payment. Live keys need KYC (PAN + bank account).',
        packages: ['razorpay'],
        vars: [
          { name: 'RAZORPAY_KEY_ID', where: 'Shown on screen as “Key Id” right after you generate the pair', testPrefixes: ['rzp_test_'] },
          { name: 'RAZORPAY_KEY_SECRET', where: 'Shown ONCE, in the same dialog — copy it before closing, it cannot be viewed again', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'payments_cashfree',
    keyless: 'To take money in India you may not need this at all — a UPI link accepts real payments with no gateway account and no fees.',
    options: [
      {
        provider: 'Cashfree',
        link: 'https://merchant.cashfree.com/merchants/pg/developers/api-keys',
        linkLabel: 'merchant.cashfree.com',
        path: 'Developers → API Keys (under Payment Gateway) → Generate API Keys',
        cost: 'Free to create. Cashfree charges about 2% per payment. Test keys are generated for you; live keys need KYC and an OTP.',
        packages: ['cashfree-pg'],
        vars: [
          { name: 'CASHFREE_APP_ID', where: 'Developers → API Keys → App ID (the keys show masked — use View API Key to reveal them)' },
          { name: 'CASHFREE_SECRET_KEY', where: 'Developers → API Keys → Secret Key → View API Key. Only one pair can exist at a time, so regenerating replaces the old one', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'payments_stripe',
    keyless: null,
    options: [
      {
        provider: 'Stripe',
        link: 'https://dashboard.stripe.com/apikeys',
        linkLabel: 'dashboard.stripe.com',
        path: 'Developers → API keys',
        cost: 'Free to create. About 3% per payment. Note Stripe cannot take Indian UPI — for Indian customers use UPI or Razorpay alongside it.',
        packages: ['stripe', '@stripe/stripe-js'],
        vars: [
          { name: 'STRIPE_PUBLISHABLE_KEY', where: 'Developers → API keys → Publishable key (safe to expose)', testPrefixes: ['pk_test_'] },
          { name: 'STRIPE_SECRET_KEY', where: 'Developers → API keys → Secret key → Reveal', serverOnly: true, testPrefixes: ['sk_test_', 'rk_test_'] },
          { name: 'STRIPE_WEBHOOK_SECRET', where: 'Developers → Webhooks → your endpoint → Signing secret (only if your app confirms payments by webhook)', serverOnly: true, testPrefixes: ['whsec_test_'] },
        ],
      },
    ],
  },
  {
    id: 'email_smtp',
    keyless: null,
    options: [
      {
        provider: 'Gmail (app password)',
        link: 'https://myaccount.google.com/apppasswords',
        linkLabel: 'myaccount.google.com/apppasswords',
        path: 'Google Account → Security → 2-Step Verification (must be ON first) → App passwords',
        cost: 'Free. Sends roughly 500 mails a day — fine to start, not for bulk email.',
        packages: ['nodemailer'],
        vars: [
          { name: 'SMTP_HOST', where: 'Use smtp.gmail.com (port 587)' },
          { name: 'SMTP_USER', where: 'Your full Gmail address' },
          { name: 'SMTP_PASS', where: 'The 16-character app password Google shows you — NOT your normal Gmail password', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'email_api',
    keyless: null,
    options: [
      {
        provider: 'Resend',
        link: 'https://resend.com/api-keys',
        linkLabel: 'resend.com/api-keys',
        path: 'API Keys → Create API Key',
        cost: 'Free tier of about 3,000 mails a month. Sending from your own domain needs a DNS record.',
        packages: ['resend'],
        vars: [{ name: 'RESEND_API_KEY', where: 'Shown ONCE when you create the key — copy it immediately', serverOnly: true }],
      },
      {
        provider: 'SendGrid',
        link: 'https://app.sendgrid.com/settings/api_keys',
        linkLabel: 'app.sendgrid.com',
        path: 'Settings → API Keys → Create API Key → Full Access',
        cost: 'Free tier of about 100 mails a day. Requires sender verification before anything sends.',
        packages: ['@sendgrid/mail'],
        vars: [{ name: 'SENDGRID_API_KEY', where: 'Shown ONCE when you create the key — copy it immediately', serverOnly: true }],
      },
    ],
  },
  {
    id: 'sms',
    keyless: null,
    options: [
      {
        provider: 'MSG91',
        link: 'https://control.msg91.com/app/m/l/settings/security/authkey',
        linkLabel: 'control.msg91.com',
        path: 'Authkey (top row, or the username dropdown) → Create New',
        cost: 'Indian provider, priced per SMS. Indian numbers also need a DLT-registered sender ID and template by law.',
        packages: [],
        vars: [{ name: 'MSG91_AUTH_KEY', where: 'Authkey → Create New → name it → copy the key shown. Creating one asks for an OTP on your registered mobile', serverOnly: true }],
      },
      {
        provider: 'Twilio',
        link: 'https://console.twilio.com/',
        linkLabel: 'console.twilio.com',
        path: 'Console home → Account Info panel',
        cost: 'Free trial credit, then per SMS. A trial account can only text numbers you have verified.',
        packages: ['twilio'],
        vars: [
          { name: 'TWILIO_ACCOUNT_SID', where: 'Console home → Account Info → Account SID (starts with AC)' },
          { name: 'TWILIO_AUTH_TOKEN', where: 'Console home → Account Info → Auth Token → click to reveal', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'maps',
    keyless: 'A map may need no key at all — OpenStreetMap with Leaflet draws a real, zoomable map for free, and a plain Google Maps embed needs no key either.',
    options: [
      {
        provider: 'Google Maps',
        link: 'https://console.cloud.google.com/google/maps-apis/credentials',
        linkLabel: 'console.cloud.google.com',
        path: 'APIs & Services → Library → enable “Maps JavaScript API” FIRST, then Credentials → Create credentials → API key',
        cost: 'Has a monthly free allowance, but a billing account with a card is required even to start. Restrict the key to your own domain before you ship it.',
        packages: ['@react-google-maps/api', '@googlemaps/js-api-loader'],
        vars: [{ name: 'VITE_GOOGLE_MAPS_API_KEY', where: 'Credentials → your API key → Copy. A browser key is visible to every visitor, so restrict it by HTTP referrer on the same screen' }],
      },
      {
        provider: 'Mapbox',
        link: 'https://account.mapbox.com/access-tokens/',
        linkLabel: 'account.mapbox.com',
        path: 'Access Tokens → Default public token (already created for you, at the top of the list)',
        cost: 'Generous free tier and no card needed to start.',
        packages: ['mapbox-gl', 'react-map-gl'],
        vars: [{ name: 'VITE_MAPBOX_ACCESS_TOKEN', where: 'Access Tokens → Default public token — it starts with pk. A token starting with sk is a SECRET one and must never go in a browser app' }],
      },
    ],
  },
  {
    id: 'app_ai_key',
    keyless: null,
    options: [
      {
        provider: 'Google AI Studio',
        link: 'https://aistudio.google.com/apikey',
        linkLabel: 'aistudio.google.com/apikey',
        path: 'Create API key (let it make a new project for you on the first one)',
        cost: 'Works on the free tier immediately — no card and no billing account needed.',
        packages: ['@google/generative-ai'],
        vars: [{ name: 'GOOGLE_API_KEY', where: 'Create API key → copy the value shown (it starts with AIza)', serverOnly: true }],
      },
      {
        provider: 'OpenAI',
        link: 'https://platform.openai.com/api-keys',
        linkLabel: 'platform.openai.com',
        path: 'API keys → Create new secret key',
        cost: 'Pay as you go — you must add credit before any call works.',
        packages: ['openai'],
        vars: [{ name: 'OPENAI_API_KEY', where: 'Shown ONCE when created — copy it immediately', serverOnly: true }],
      },
    ],
  },
  {
    id: 'storage',
    keyless: null,
    options: [
      {
        provider: 'Cloudinary',
        link: 'https://console.cloudinary.com/settings/api-keys',
        linkLabel: 'console.cloudinary.com',
        path: 'Settings → API Keys',
        cost: 'Free tier that covers a small app, and image resizing is included.',
        packages: ['cloudinary'],
        vars: [
          { name: 'CLOUDINARY_CLOUD_NAME', where: 'Shown on the Console dashboard home, and again under Settings → API Keys' },
          { name: 'CLOUDINARY_API_KEY', where: 'Settings → API Keys → API Key' },
          { name: 'CLOUDINARY_URL', where: 'Settings → API Keys → the full CLOUDINARY_URL line (it contains the secret). You need the Admin or Master Admin role to see it — a read-only user cannot', serverOnly: true },
        ],
      },
      {
        provider: 'Amazon S3',
        link: 'https://console.aws.amazon.com/iam/home#/security_credentials',
        linkLabel: 'console.aws.amazon.com',
        path: 'IAM → Users → your user → Security credentials → Create access key',
        cost: 'Cheap per GB, but needs a card on the account. Cloudflare R2 uses these same two names and has no egress fee.',
        packages: ['@aws-sdk/client-s3', 'aws-sdk'],
        vars: [
          { name: 'S3_BUCKET', where: 'S3 → the bucket you created → its name' },
          { name: 'AWS_ACCESS_KEY_ID', where: 'IAM → Security credentials → Access keys → Access key ID' },
          { name: 'AWS_SECRET_ACCESS_KEY', where: 'Shown ONCE when the access key is created — download the .csv', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'auth',
    keyless: 'You may not need a separate login provider — a database you connect in Settings → App Settings → Database (Supabase or Firebase) already includes real email and Google login.',
    options: [
      {
        provider: 'Clerk',
        link: 'https://dashboard.clerk.com/',
        linkLabel: 'dashboard.clerk.com',
        path: 'your application → API Keys → Quick Copy',
        cost: 'Free up to a few thousand monthly users.',
        packages: ['@clerk/clerk-react', '@clerk/nextjs', '@clerk/backend'],
        vars: [
          { name: 'VITE_CLERK_PUBLISHABLE_KEY', where: 'API Keys → Publishable key (starts with pk_ — safe to expose)', testPrefixes: ['pk_test_'] },
          { name: 'CLERK_SECRET_KEY', where: 'API Keys → Secret key → reveal (starts with sk_)', serverOnly: true, testPrefixes: ['sk_test_'] },
        ],
      },
      {
        provider: 'Auth0',
        link: 'https://manage.auth0.com/#/applications',
        linkLabel: 'manage.auth0.com',
        path: 'Applications → your application → Settings',
        cost: 'Free tier for a small app.',
        packages: ['@auth0/auth0-react', 'auth0'],
        vars: [
          { name: 'AUTH0_DOMAIN', where: 'Applications → your app → Settings → Domain' },
          { name: 'AUTH0_CLIENT_ID', where: 'Applications → your app → Settings → Client ID' },
          { name: 'AUTH0_CLIENT_SECRET', where: 'Applications → your app → Settings → Client Secret → reveal', serverOnly: true },
        ],
      },
    ],
  },
  {
    id: 'database_hosted',
    keyless: 'NavBharatAI can create a real database for you in one tap from Settings → App Settings → Database — you do not have to open any console yourself.',
    options: [
      {
        provider: 'Supabase',
        link: 'https://supabase.com/dashboard/project/_/settings/api',
        linkLabel: 'supabase.com/dashboard',
        path: 'your project → Project Settings → API',
        cost: 'Free tier with a real Postgres. A free organisation allows 2 projects.',
        packages: ['@supabase/supabase-js'],
        vars: [
          { name: 'VITE_SUPABASE_URL', where: 'Project Settings → API → Project URL' },
          { name: 'VITE_SUPABASE_ANON_KEY', where: 'Project Settings → API → Project API keys → anon / public' },
        ],
      },
      {
        provider: 'Firebase',
        link: 'https://console.firebase.google.com/',
        linkLabel: 'console.firebase.google.com',
        path: 'your project → Project Settings → General → Your apps → SDK setup and configuration',
        cost: 'Free Spark plan to start.',
        packages: ['firebase', 'firebase-admin'],
        vars: [
          { name: 'VITE_FIREBASE_API_KEY', where: 'Project Settings → General → Your apps → apiKey' },
          { name: 'VITE_FIREBASE_PROJECT_ID', where: 'Project Settings → General → Project ID' },
        ],
      },
      {
        provider: 'MongoDB Atlas',
        link: 'https://cloud.mongodb.com/',
        linkLabel: 'cloud.mongodb.com',
        path: 'your cluster → Connect → Drivers → copy the connection string',
        cost: 'Free shared cluster. Remember to allow network access from anywhere, or the app cannot connect.',
        packages: ['mongodb', 'mongoose'],
        vars: [{ name: 'MONGODB_URI', where: 'Connect → Drivers → the string shown — replace <password> with your database user password', serverOnly: true }],
      },
    ],
  },
];

const BY_ID = new Map(CREDENTIAL_RECIPES.map((r) => [r.id, r]));

/** The recipe for an AppRequirements service id, or null when we have no curated knowledge for it. PURE. */
export function recipeFor(id: string | null | undefined): CredentialRecipe | null {
  return BY_ID.get(String(id ?? '')) ?? null;
}

/** What the built app itself reveals about which provider it intends to use. */
export interface ProviderSignals {
  /** Env-var names the app's own source reads. The strongest signal. */
  envVars?: readonly string[] | null;
  /** npm packages the app declares. Weaker, but present earlier than any variable read. */
  packages?: readonly string[] | null;
}

const clean = (xs: readonly string[] | null | undefined) =>
  new Set((xs || []).map((n) => String(n ?? '').trim()).filter(Boolean));

/**
 * The provider to actually show, given what the built app reveals about itself.
 *
 * A requirement like `maps` can be satisfied by two different providers, and telling a Mapbox user to
 * open the Google Cloud Console is worse than saying nothing at all. So the app's own code decides:
 * first by the variables it reads, then — for an app that has declared a package but not yet read a
 * variable — by that package. Only when it reveals neither do we fall back to the FIRST option, which
 * each recipe orders by how easy the credential is to obtain (free tier, no card), not by popularity.
 * PURE.
 */
export function preferredOption(
  recipe: CredentialRecipe | null | undefined,
  signals: ProviderSignals | null | undefined,
): CredentialOption | null {
  if (!recipe || recipe.options.length === 0) return null;

  const envVars = clean(signals?.envVars);
  if (envVars.size > 0) {
    const match = recipe.options.find((o) => o.vars.some((v) => envVars.has(v.name)));
    if (match) return match;
  }
  const packages = clean(signals?.packages);
  if (packages.size > 0) {
    const match = recipe.options.find((o) => (o.packages || []).some((p) => packages.has(p)));
    if (match) return match;
  }
  return recipe.options[0];
}

/**
 * Two names that carry the SAME value, differing only by a browser-exposure prefix.
 *
 * `VITE_MAPBOX_ACCESS_TOKEN` and `MAPBOX_ACCESS_TOKEN` are one credential written for two build systems.
 * Listing both as separate things to go and fetch would send someone back to a console for a value they
 * already hold. PURE.
 */
export function isSameCredentialName(a: string, b: string): boolean {
  const bare = (n: string) => String(n ?? '').trim().replace(/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)/, '');
  return bare(a) === bare(b) && bare(a).length > 0;
}

/**
 * The variable names to actually ask a user for, once a provider has been chosen.
 *
 * Two sources, and each is authoritative about a different thing. The APP'S OWN CODE is the truth about
 * NAMING — if it reads `MAPBOX_ACCESS_TOKEN`, telling the user to save `VITE_MAPBOX_ACCESS_TOKEN` leaves
 * the feature just as dead as saying nothing, because nothing will ever read what they saved. The RECIPE
 * is the truth about COMPLETENESS — a payment integration needs a key AND a secret, and an app that has
 * so far only referenced the key still needs both before it can charge anybody.
 *
 * So: every name the code really reads, plus any recipe variable that is not already covered by one of
 * them. Falls back to the recipe alone for an app that references nothing yet. PURE.
 */
export function requiredVarNames(
  option: CredentialOption | null | undefined,
  matchedEnvVars: readonly string[] | null | undefined,
): string[] {
  const matched = (matchedEnvVars || []).map((n) => String(n ?? '').trim()).filter(Boolean);
  if (!option) return Array.from(new Set(matched));
  const extra = option.vars
    .map((v) => v.name)
    .filter((name) => !matched.some((m) => isSameCredentialName(m, name)));
  return Array.from(new Set([...matched, ...extra]));
}

/**
 * Every env var name this file annotates, for the id given — used by the test that proves the annotation
 * has not drifted away from AppRequirements' catalogue. PURE.
 */
export function recipeVarNames(id: string): string[] {
  const recipe = recipeFor(id);
  if (!recipe) return [];
  return recipe.options.flatMap((o) => o.vars.map((v) => v.name));
}

/**
 * The one-line "where to get it" fragment for a build message: a markdown link plus the console path.
 *
 * The path is included even though the link is clickable, because the link lands the user on a console
 * page and the path is what gets them through it — and because a stale link degrades to a still-usable
 * instruction rather than a dead end. PURE.
 */
export function optionSource(option: CredentialOption | null | undefined): string {
  if (!option) return '';
  return `[${option.linkLabel}](${option.link}) (${option.path})`;
}

/**
 * Just the clickable link, with no console path.
 *
 * The build-summary checklist is under a standing instruction to stay SHORT (admin 2026-08-03: long
 * build messages go unread), and a full console path is several times the length of the link. In a chat
 * message the link is clickable, so it already lands the user on the right page and the path is mostly
 * redundant there. The path is not lost — it is what `optionSource` renders on the surfaces that have
 * room for it, and it is what rescues a user when a link has gone stale. PURE.
 */
export function optionLink(option: CredentialOption | null | undefined): string {
  if (!option) return '';
  return `[${option.linkLabel}](${option.link})`;
}
