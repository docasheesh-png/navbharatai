// AgentV3 — "WHAT THIS APP NEEDS FROM YOU" — the external-service requirement detector + honest notice
// (admin question 2026-08-03: "database wali app ya 3-4 extra-feature wali apps kya NavBharatAI handle nahi
// kar payega? … v5 user ko bole settings me jaakar keys daalo?").
//
// THE PROBLEM THIS SOLVES. NavBharatAI already handles database + multi-feature apps end-to-end: a sandbox
// Postgres is auto-provisioned (postgresProvision.ts), and a user's OWN connected DB / auth / storage is
// injected into `.env` and explicitly taught to the builder (userDatabaseContext / userAuthContext /
// userStorageContext). What was MISSING is the last honest mile: when an app genuinely needs a credential
// that can only come from the USER'S OWN account — a payment gateway key, an SMTP password, a Maps key —
// nothing told the user. The app shipped with a Pay button that could not charge, and only the DATABASE
// case ever produced a message (ImportPreview.ts, and only on the import path). That is exactly the state
// the second absolute rule forbids: a feature that "looks done" but does nothing.
//
// THE DESIGN (deliberate, and why it is not a wall of prompts):
//   • Anything we can safely provision OURSELVES, we provision and never mention (Postgres in the sandbox).
//     The user is not asked for what the engine can do for them.
//   • Only a credential that is genuinely the USER'S OWN ACCOUNT is surfaced — because we must never bill a
//     third-party service to NavBharatAI's account, and we cannot invent someone's Razorpay key.
//   • It NEVER blocks or delays the build. The app is built and shown first; the checklist rides the final
//     summary. A missing key degrades that ONE feature to an honest inactive state — never a fake success.
//   • It is SHORT. One line per item, with the EXACT key names and the EXACT settings path to paste them in.
//
// Pure + deterministic: no I/O, no LLM call, zero added cost. The caller passes the built files and the
// user's already-loaded vault secret names; this module decides. Kill switch lives at the call site
// (AGENTV3_APP_REQUIREMENTS=off).
//
// WHITE-LABEL SAFE: every name below is a service the USER themselves chooses and pays for (Razorpay,
// Twilio, Cloudinary…). None of NavBharatAI's own AI vendors is ever named — that rule is about hiding
// which model built the app, not about hiding the user's own integrations.

import { recipeFor, preferredOption, optionLink, requiredVarNames, type KeylessRoute } from '../../lib/credentialRecipes';

/** Where a requirement is satisfied. */
export type RequirementKind =
  /** The engine provisions it automatically — informational only, never shown as a user task. */
  | 'auto'
  /** Only the user's own account can supply it — this is what we surface. */
  | 'user';

export interface AppRequirement {
  /** Stable id (also the dedupe key). */
  id: string;
  /** Short user-facing label, e.g. "Payments (Razorpay)". */
  label: string;
  kind: RequirementKind;
  /** Env-var names that satisfy it. ANY one present ⇒ configured (providers differ in which they need). */
  envVars: string[];
  /** Exact in-app navigation path where the user supplies it. */
  settingsPath: string;
  /**
   * The env-var names the BUILT APP's own code actually reads, out of this service's catalogue entry.
   *
   * A requirement can be served by more than one provider (`maps` is Google OR Mapbox), and sending a
   * Mapbox user into the Google Cloud Console is worse than saying nothing at all. The app's own source
   * is the only non-guessing way to tell them apart, so it is recorded here and handed to
   * credentialRecipes' `preferredOption`. Empty when the service was detected from a package alone.
   */
  matchedEnvVars: string[];
  /**
   * The npm packages the built app declares, out of this service's catalogue entry.
   *
   * Weaker than `matchedEnvVars` but available earlier: an app can declare `mapbox-gl` before any code
   * reads a token, and without this such an app would be pointed at whichever provider happens to be
   * listed first. Empty when the service was detected from an env reference alone.
   */
  matchedPackages: string[];
}

/** What the detector reads. All fields optional — a caller with only a file map still gets a result. */
export interface RequirementInput {
  /** Built file path → content. Only paths/deps/env-refs are inspected, never whole bodies semantically. */
  files?: Map<string, string> | Record<string, string> | null;
  /** The user's original prompt (weakest signal — used only to confirm, never alone). */
  prompt?: string | null;
}

// The catalogue ENTRY, not a detection result: `matchedEnvVars`/`matchedPackages` describe what one
// particular app turned out to reference, so they are omitted here rather than carried as empty arrays
// on every spec — a spec that could hold them would invite somebody to read them as catalogue data.
interface ServiceSpec extends Omit<AppRequirement, 'kind' | 'matchedEnvVars' | 'matchedPackages'> {
  kind: RequirementKind;
  /** npm package names (exact, from package.json deps) that imply this service. */
  packages: string[];
  /** Env-var names whose mere REFERENCE in code implies this service (superset of `envVars`). */
  envHints: string[];
}

const SECRETS_PATH = 'Settings → App Settings → Secrets & API Keys';
const DB_PATH = 'Settings → App Settings → Database';
const AUTH_PATH = 'Settings → App Settings → Authentication';
const STORAGE_PATH = 'Settings → App Settings → Storage';

// The curated catalogue. HIGH-PRECISION on purpose: a service is listed only when its package or its
// env-var name is unmistakable, so we never nag a user about a service their app does not actually use.
const SERVICES: ServiceSpec[] = [
  // ── Payments ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'payments_razorpay', label: 'Payments (Razorpay)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['razorpay'], envVars: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    envHints: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'VITE_RAZORPAY_KEY_ID'],
  },
  {
    id: 'payments_cashfree', label: 'Payments (Cashfree)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['cashfree-pg'], envVars: ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY'],
    envHints: ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET'],
  },
  {
    id: 'payments_stripe', label: 'Payments (Stripe)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['stripe', '@stripe/stripe-js'], envVars: ['STRIPE_SECRET_KEY'],
    envHints: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  // ── Email ────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'email_smtp', label: 'Email sending (SMTP)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['nodemailer'], envVars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
    envHints: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PASSWORD', 'EMAIL_USER', 'EMAIL_PASS'],
  },
  {
    id: 'email_api', label: 'Email sending (SendGrid / Resend)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['@sendgrid/mail', 'resend'], envVars: ['SENDGRID_API_KEY', 'RESEND_API_KEY'],
    envHints: ['SENDGRID_API_KEY', 'RESEND_API_KEY'],
  },
  // ── SMS / OTP ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'sms', label: 'SMS / OTP (Twilio / MSG91)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['twilio'], envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MSG91_AUTH_KEY'],
    envHints: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MSG91_AUTH_KEY', 'MSG91_API_KEY'],
  },
  // ── Maps ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'maps', label: 'Maps (Google Maps / Mapbox)', kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['@react-google-maps/api', '@googlemaps/js-api-loader', 'mapbox-gl', 'react-map-gl'],
    envVars: ['GOOGLE_MAPS_API_KEY', 'MAPBOX_ACCESS_TOKEN'],
    envHints: ['GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY', 'MAPBOX_ACCESS_TOKEN', 'VITE_MAPBOX_ACCESS_TOKEN', 'VITE_MAPBOX_TOKEN'],
  },
  // ── AI inside the USER'S app (their own key — nothing to do with which model builds it) ──────────
  {
    id: 'app_ai_key', label: "Your app's own AI key", kind: 'user', settingsPath: SECRETS_PATH,
    packages: ['openai', '@google/generative-ai'], envVars: ['OPENAI_API_KEY', 'GOOGLE_API_KEY'],
    envHints: ['OPENAI_API_KEY', 'VITE_OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY'],
  },
  // ── Storage (uploads) — has its own dedicated settings screen ────────────────────────────────────
  {
    id: 'storage', label: 'File / image storage (S3 / Cloudinary)', kind: 'user', settingsPath: STORAGE_PATH,
    packages: ['@aws-sdk/client-s3', 'cloudinary', 'aws-sdk'],
    envVars: ['AWS_ACCESS_KEY_ID', 'CLOUDINARY_URL', 'CLOUDINARY_API_KEY'],
    envHints: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET', 'CLOUDINARY_URL', 'CLOUDINARY_API_KEY', 'CLOUDINARY_CLOUD_NAME'],
  },
  // ── Auth (dedicated providers) — its own settings screen ─────────────────────────────────────────
  {
    id: 'auth', label: 'Login / signup provider (Clerk / Auth0)', kind: 'user', settingsPath: AUTH_PATH,
    packages: ['@clerk/clerk-react', '@clerk/nextjs', '@clerk/backend', '@auth0/auth0-react', 'auth0'],
    envVars: ['CLERK_SECRET_KEY', 'AUTH0_CLIENT_ID'],
    envHints: ['CLERK_SECRET_KEY', 'VITE_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_DOMAIN'],
  },
  // ── Database ─────────────────────────────────────────────────────────────────────────────────────
  // NOTE `kind: 'auto'` for the SQL case: the sandbox provisions a real Postgres for the preview
  // (postgresProvision.ts), so the app RUNS without the user doing anything. It is surfaced only through
  // `permanentDataRequirement()` below — a separate, gentler "your data lives in a temporary preview DB"
  // line — never as a blocking task, because the app genuinely works without it.
  {
    id: 'database_sql', label: 'Your own database', kind: 'auto', settingsPath: DB_PATH,
    packages: ['pg', 'postgres', '@neondatabase/serverless', 'mysql2', 'drizzle-orm', '@prisma/client'],
    envVars: ['DATABASE_URL'], envHints: ['DATABASE_URL', 'POSTGRES_URL', 'PG_CONNECTION_STRING'],
  },
  {
    id: 'database_hosted', label: 'Your own database', kind: 'user', settingsPath: DB_PATH,
    packages: ['@supabase/supabase-js', 'firebase', 'firebase-admin', 'mongodb', 'mongoose', 'appwrite'],
    envVars: ['VITE_SUPABASE_URL', 'VITE_FIREBASE_API_KEY', 'MONGODB_URI', 'VITE_APPWRITE_ENDPOINT'],
    envHints: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'MONGODB_URI', 'MONGO_URL', 'VITE_APPWRITE_ENDPOINT', 'VITE_APPWRITE_PROJECT_ID'],
  },
];

/** Uppercase env-style name, as referenced through process.env / import.meta.env. */
const ENV_REF_RE = /(?:process\.env|import\.meta\.env)(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\])/g;

/** Paths that are not the app's own source (never scanned for signals). */
const SKIP_PATH = /(^|[/\\])(node_modules|dist|build|coverage|\.next|\.git|vendor)([/\\]|$)/i;

function toEntries(files: RequirementInput['files']): Array<[string, string]> {
  if (!files) return [];
  const raw = files instanceof Map ? Array.from(files.entries()) : Object.entries(files);
  return raw.filter(([p, c]) => typeof p === 'string' && typeof c === 'string' && !SKIP_PATH.test(p)) as Array<[string, string]>;
}

/** Every dependency name declared by any package.json in the build (deps + devDeps + peerDeps). */
function declaredPackages(entries: Array<[string, string]>): Set<string> {
  const out = new Set<string>();
  for (const [p, content] of entries) {
    if (!/(^|[/\\])package\.json$/i.test(p)) continue;
    let json: any;
    try {
      json = JSON.parse(content);
    } catch {
      continue; // a malformed package.json is a different problem — never crash the notice on it
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = json?.[field];
      if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) out.add(name);
    }
  }
  return out;
}

/** Every env-var name the app's own source actually reads. */
function referencedEnvNames(entries: Array<[string, string]>): Set<string> {
  const out = new Set<string>();
  for (const [p, content] of entries) {
    if (!/\.(m?[jt]sx?|c?[jt]s)$/i.test(p)) continue;
    ENV_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENV_REF_RE.exec(content)) !== null) {
      const name = m[1] || m[2];
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Which external services this app genuinely uses, judged from the REAL build output: the packages it
 * declares and the env-vars its code actually reads. The prompt is intentionally NOT a trigger on its own
 * (a user saying "shop" must not conjure a Stripe task) — it only confirms what the code already shows.
 * Deterministic, catalogue-ordered, deduped by id. Pure.
 */
export function detectAppRequirements(input: RequirementInput): AppRequirement[] {
  const entries = toEntries(input?.files);
  if (entries.length === 0) return [];
  const pkgs = declaredPackages(entries);
  const envs = referencedEnvNames(entries);
  const found: AppRequirement[] = [];
  const seen = new Set<string>();
  for (const spec of SERVICES) {
    const matchedEnvVars = spec.envHints.filter((n) => envs.has(n));
    const matchedPackages = spec.packages.filter((n) => pkgs.has(n));
    if ((matchedPackages.length === 0 && matchedEnvVars.length === 0) || seen.has(spec.id)) continue;
    seen.add(spec.id);
    found.push({
      id: spec.id, label: spec.label, kind: spec.kind, envVars: [...spec.envVars],
      settingsPath: spec.settingsPath, matchedEnvVars, matchedPackages,
    });
  }
  return found;
}

/**
 * Every env-var name this catalogue knows for one service — the union of the names that satisfy it and
 * the wider set that merely hints at it.
 *
 * Exported for ONE reason: credentialRecipes.ts annotates these names with "where does a human get this
 * value", and an annotation keyed to a name that no longer exists here would silently stop appearing.
 * Its test suite cross-checks against this function, so the two files cannot drift apart in silence —
 * which is the exact failure that left five copies of this knowledge scattered around the repo. PURE.
 */
export function serviceEnvNames(id: string): string[] {
  const spec = SERVICES.find((s) => s.id === id);
  return spec ? Array.from(new Set([...spec.envVars, ...spec.envHints])) : [];
}

/**
 * Every npm package this catalogue detects one service by. Exported for the same anti-drift reason as
 * `serviceEnvNames` — credentialRecipes maps packages to providers, and a package named there that this
 * detector never looks for would be a rule that can never fire. PURE.
 */
export function servicePackages(id: string): string[] {
  const spec = SERVICES.find((s) => s.id === id);
  return spec ? [...spec.packages] : [];
}

/**
 * The requirements the user still has to supply: `kind: 'user'` only (never the auto-provisioned ones),
 * minus anything already satisfied by a secret they have ALREADY saved. A requirement counts as satisfied
 * when ANY of its env-vars — or any of the catalogue's wider hints for it — is present and non-empty in the
 * vault, because providers differ in which subset they need. Pure.
 */
export function unconfiguredRequirements(
  requirements: AppRequirement[],
  vaultSecrets: Record<string, string> | null | undefined,
): AppRequirement[] {
  const have = new Set(
    Object.entries(vaultSecrets && typeof vaultSecrets === 'object' ? vaultSecrets : {})
      .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
      .map(([k]) => k),
  );
  return (Array.isArray(requirements) ? requirements : []).filter((r) => {
    if (!r || r.kind !== 'user') return false;
    const spec = SERVICES.find((s) => s.id === r.id);
    const names = spec ? new Set([...spec.envVars, ...spec.envHints]) : new Set(r.envVars ?? []);
    for (const n of names) if (have.has(n)) return false; // already supplied → not a task
    return true;
  });
}

// ── The user-facing notice ─────────────────────────────────────────────────────────────────────────────
// Deliberately SHORT (admin 2026-08-03: long build messages are unreadable): one heading line, one line per
// item with the exact key names and path, one closing line explaining the honest degraded state.

interface NoticeStrings {
  head: (n: number) => string;
  add: string;
  /**
   * "…where you get it from", given an already-rendered link.
   *
   * A function rather than a word because the clause sits BEFORE the source in English ("get it from X")
   * and AFTER it in every Indian language here ("X से लें"). A shared word plus a fixed word order would
   * read as machine translation in exactly the languages this notice exists to serve.
   */
  from: (source: string) => string;
  tail: string;
  /**
   * "You may not need all of these —", introducing the keyless routes.
   *
   * This is the single most valuable line in the notice, because it can DELETE a task rather than help
   * with it: a shop can take real money over UPI with no payment account at all. It is a separate short
   * clause per route rather than a translation of the long English sentences on the Settings screens —
   * forty long translations would be forty chances to ship a clumsy one, and this message is under a
   * standing brevity constraint anyway.
   */
  keylessHead: string;
  keyless: Record<KeylessRoute, string>;
}

const KEYLESS_EN: Record<KeylessRoute, string> = {
  upi: 'a UPI link takes real payments with no payment account at all',
  osm: 'a free OpenStreetMap map needs no key',
  'db-auth': 'the database you connect already includes login',
  'one-tap-db': 'NavBharatAI can create the database for you in one tap',
};

const STRINGS: Record<string, NoticeStrings> = {
  hi: {
    head: (n) => `🔑 यह ऐप बन गया है। इसे पूरी तरह चालू करने के लिए ${n === 1 ? '1 चीज़' : `${n} चीज़ें`} आपके अपने account से चाहिए:`,
    add: 'डालें',
    from: (src) => `${src} से लें`,
    keylessHead: '💡 शायद इनमें से कुछ की ज़रूरत ही न पड़े —',
    keyless: { 'upi': 'UPI लिंक से बिना किसी payment account के असली payment आ सकता है', 'osm': 'मुफ़्त OpenStreetMap के नक़्शे को कोई key नहीं चाहिए', 'db-auth': 'जो database आप जोड़ेंगे उसमें login पहले से है', 'one-tap-db': 'NavBharatAI एक tap में आपका database बना सकता है' },
    tail: 'तब तक वे बटन “Coming soon” दिखाएँगे — बाक़ी पूरा ऐप सामान्य रूप से चलेगा।',
  },
  bn: {
    head: (n) => `🔑 অ্যাপটি তৈরি হয়ে গেছে। এটি সম্পূর্ণ চালু করতে ${n === 1 ? '১টি জিনিস' : `${n}টি জিনিস`} আপনার নিজের account থেকে দরকার:`,
    add: 'দিন', from: (src) => `${src} থেকে নিন`,
    keylessHead: '💡 হয়তো এর কয়েকটির দরকারই নেই —',
    keyless: { 'upi': 'UPI লিঙ্ক দিয়ে কোনো payment account ছাড়াই আসল payment নেওয়া যায়', 'osm': 'বিনামূল্যের OpenStreetMap মানচিত্রে কোনো key লাগে না', 'db-auth': 'আপনি যে database যুক্ত করবেন তাতে login আগে থেকেই আছে', 'one-tap-db': 'NavBharatAI এক tap-এ আপনার database বানিয়ে দিতে পারে' },
    tail: 'ততক্ষণ ওই বোতামগুলি “Coming soon” দেখাবে — বাকি পুরো অ্যাপ স্বাভাবিক ভাবে চলবে।',
  },
  pa: {
    head: (n) => `🔑 ਐਪ ਬਣ ਗਈ ਹੈ। ਇਸਨੂੰ ਪੂਰੀ ਤਰ੍ਹਾਂ ਚਲਾਉਣ ਲਈ ${n === 1 ? '1 ਚੀਜ਼' : `${n} ਚੀਜ਼ਾਂ`} ਤੁਹਾਡੇ ਆਪਣੇ account ਤੋਂ ਚਾਹੀਦੀਆਂ ਹਨ:`,
    add: 'ਪਾਓ', from: (src) => `${src} ਤੋਂ ਲਵੋ`,
    keylessHead: '💡 ਸ਼ਾਇਦ ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੁਝ ਦੀ ਲੋੜ ਹੀ ਨਾ ਪਵੇ —',
    keyless: { 'upi': 'UPI ਲਿੰਕ ਨਾਲ ਬਿਨਾਂ ਕਿਸੇ payment account ਦੇ ਅਸਲੀ payment ਆ ਸਕਦੀ ਹੈ', 'osm': 'ਮੁਫ਼ਤ OpenStreetMap ਨਕਸ਼ੇ ਲਈ ਕੋਈ key ਨਹੀਂ ਚਾਹੀਦੀ', 'db-auth': 'ਜੋ database ਤੁਸੀਂ ਜੋੜੋਗੇ ਉਸ ਵਿੱਚ login ਪਹਿਲਾਂ ਤੋਂ ਹੈ', 'one-tap-db': 'NavBharatAI ਇੱਕ tap ਵਿੱਚ ਤੁਹਾਡਾ database ਬਣਾ ਸਕਦਾ ਹੈ' },
    tail: 'ਉਦੋਂ ਤੱਕ ਉਹ ਬਟਨ “Coming soon” ਦਿਖਾਉਣਗੇ — ਬਾਕੀ ਪੂਰੀ ਐਪ ਆਮ ਵਾਂਗ ਚੱਲੇਗੀ।',
  },
  gu: {
    head: (n) => `🔑 એપ બની ગઈ છે. તેને પૂરેપૂરી ચાલુ કરવા ${n === 1 ? '1 વસ્તુ' : `${n} વસ્તુઓ`} તમારા પોતાના account માંથી જોઈએ:`,
    add: 'ઉમેરો', from: (src) => `${src} પરથી લો`,
    keylessHead: '💡 કદાચ આમાંથી કેટલીક વસ્તુની જરૂર જ ન પડે —',
    keyless: { 'upi': 'UPI લિંકથી કોઈ payment account વગર જ સાચી payment આવી શકે છે', 'osm': 'મફત OpenStreetMap નકશા માટે કોઈ key જોઈતી નથી', 'db-auth': 'તમે જે database જોડશો તેમાં login પહેલેથી છે', 'one-tap-db': 'NavBharatAI એક tap માં તમારું database બનાવી શકે છે' },
    tail: 'ત્યાં સુધી એ બટન “Coming soon” બતાવશે — બાકીની આખી એપ સામાન્ય રીતે ચાલશે.',
  },
  or: {
    head: (n) => `🔑 ଆପ୍‌ ତିଆରି ହୋଇଗଲା। ଏହାକୁ ସମ୍ପୂର୍ଣ୍ଣ ଚଳାଇବା ପାଇଁ ${n === 1 ? '୧ଟି ଜିନିଷ' : `${n}ଟି ଜିନିଷ`} ଆପଣଙ୍କ ନିଜ account ରୁ ଦରକାର:`,
    add: 'ଦିଅନ୍ତୁ', from: (src) => `${src} ରୁ ନିଅନ୍ତୁ`,
    keylessHead: '💡 ହୁଏତ ଏଥିରୁ କେତେକର ଆବଶ୍ୟକତା ହିଁ ନାହିଁ —',
    keyless: { 'upi': 'UPI ଲିଙ୍କ ଦ୍ୱାରା କୌଣସି payment account ବିନା ଅସଲ payment ଆସିପାରେ', 'osm': 'ମାଗଣା OpenStreetMap ମାନଚିତ୍ର ପାଇଁ କୌଣସି key ଦରକାର ନାହିଁ', 'db-auth': 'ଆପଣ ଯେଉଁ database ଯୋଡ଼ିବେ ସେଥିରେ login ପୂର୍ବରୁ ଅଛି', 'one-tap-db': 'NavBharatAI ଗୋଟିଏ tap ରେ ଆପଣଙ୍କ database ତିଆରି କରିପାରେ' },
    tail: 'ସେ ପର୍ଯ୍ୟନ୍ତ ସେହି ବଟନ୍‌ “Coming soon” ଦେଖାଇବ — ବାକି ପୂରା ଆପ୍‌ ସ୍ୱାଭାବିକ ଭାବେ ଚାଲିବ।',
  },
  ta: {
    head: (n) => `🔑 ஆப் தயாராகிவிட்டது. இதை முழுமையாக இயக்க ${n === 1 ? '1 விஷயம்' : `${n} விஷயங்கள்`} உங்கள் சொந்த account-லிருந்து தேவை:`,
    add: 'சேர்க்கவும்', from: (src) => `${src} இல் இருந்து பெறவும்`,
    keylessHead: '💡 இவற்றில் சிலவற்றுக்கு தேவையே இல்லாமல் இருக்கலாம் —',
    keyless: { 'upi': 'UPI இணைப்பு மூலம் எந்த payment account இல்லாமலேயே உண்மையான payment பெறலாம்', 'osm': 'இலவச OpenStreetMap வரைபடத்திற்கு key தேவையில்லை', 'db-auth': 'நீங்கள் இணைக்கும் database-இல் login ஏற்கனவே உள்ளது', 'one-tap-db': 'NavBharatAI ஒரே tap-இல் உங்கள் database-ஐ உருவாக்கும்' },
    tail: 'அதுவரை அந்த பட்டன்கள் “Coming soon” எனக் காட்டும் — மீதி முழு ஆப்பும் வழக்கம் போல் இயங்கும்.',
  },
  te: {
    head: (n) => `🔑 యాప్ తయారైంది. దీన్ని పూర్తిగా నడపడానికి ${n === 1 ? '1 విషయం' : `${n} విషయాలు`} మీ సొంత account నుండి కావాలి:`,
    add: 'జోడించండి', from: (src) => `${src} నుండి తీసుకోండి`,
    keylessHead: '💡 వీటిలో కొన్ని అవసరమే లేకపోవచ్చు —',
    keyless: { 'upi': 'UPI లింక్‌తో ఎలాంటి payment account లేకుండానే నిజమైన payment రావచ్చు', 'osm': 'ఉచిత OpenStreetMap మ్యాప్‌కు ఏ key అవసరం లేదు', 'db-auth': 'మీరు కలిపే database లో login అప్పటికే ఉంది', 'one-tap-db': 'NavBharatAI ఒక్క tap లో మీ database ను తయారు చేయగలదు' },
    tail: 'అప్పటివరకు ఆ బటన్లు “Coming soon” అని చూపిస్తాయి — మిగిలిన యాప్ మామూలుగా పనిచేస్తుంది.',
  },
  kn: {
    head: (n) => `🔑 ಆ್ಯಪ್ ಸಿದ್ಧವಾಗಿದೆ. ಇದನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಚಲಾಯಿಸಲು ${n === 1 ? '1 ವಿಷಯ' : `${n} ವಿಷಯಗಳು`} ನಿಮ್ಮ ಸ್ವಂತ account ನಿಂದ ಬೇಕು:`,
    add: 'ಸೇರಿಸಿ', from: (src) => `${src} ಇಂದ ಪಡೆಯಿರಿ`,
    keylessHead: '💡 ಇವುಗಳಲ್ಲಿ ಕೆಲವು ಬೇಕಾಗದೇ ಇರಬಹುದು —',
    keyless: { 'upi': 'UPI ಲಿಂಕ್‌ನಿಂದ ಯಾವುದೇ payment account ಇಲ್ಲದೆಯೇ ನಿಜವಾದ payment ಬರಬಹುದು', 'osm': 'ಉಚಿತ OpenStreetMap ನಕ್ಷೆಗೆ ಯಾವ key ಬೇಕಿಲ್ಲ', 'db-auth': 'ನೀವು ಸೇರಿಸುವ database ನಲ್ಲಿ login ಈಗಾಗಲೇ ಇದೆ', 'one-tap-db': 'NavBharatAI ಒಂದೇ tap ನಲ್ಲಿ ನಿಮ್ಮ database ರಚಿಸಬಲ್ಲದು' },
    tail: 'ಅಲ್ಲಿಯವರೆಗೆ ಆ ಬಟನ್‌ಗಳು “Coming soon” ಎಂದು ತೋರಿಸುತ್ತವೆ — ಉಳಿದ ಪೂರ್ತಿ ಆ್ಯಪ್ ಎಂದಿನಂತೆ ಚಲಿಸುತ್ತದೆ.',
  },
  ml: {
    head: (n) => `🔑 ആപ്പ് തയ്യാറായി. ഇത് പൂർണ്ണമായി പ്രവർത്തിപ്പിക്കാൻ ${n === 1 ? '1 കാര്യം' : `${n} കാര്യങ്ങൾ`} നിങ്ങളുടെ സ്വന്തം account-ൽ നിന്ന് വേണം:`,
    add: 'ചേർക്കുക', from: (src) => `${src} ൽ നിന്ന് എടുക്കുക`,
    keylessHead: '💡 ഇവയിൽ ചിലത് വേണ്ടിവരില്ലായിരിക്കാം —',
    keyless: { 'upi': 'UPI ലിങ്ക് വഴി ഒരു payment account പോലും ഇല്ലാതെ യഥാർത്ഥ payment ലഭിക്കും', 'osm': 'സൗജന്യ OpenStreetMap മാപ്പിന് key ആവശ്യമില്ല', 'db-auth': 'നിങ്ങൾ ചേർക്കുന്ന database-ൽ login നേരത്തെ തന്നെയുണ്ട്', 'one-tap-db': 'NavBharatAI ഒറ്റ tap-ൽ നിങ്ങളുടെ database ഉണ്ടാക്കിത്തരും' },
    tail: 'അതുവരെ ആ ബട്ടണുകൾ “Coming soon” എന്ന് കാണിക്കും — ബാക്കി ആപ്പ് പതിവുപോലെ പ്രവർത്തിക്കും.',
  },
  ar: {
    head: (n) => `🔑 ایپ بن گئی ہے۔ اِسے پوری طرح چلانے کے لیے ${n === 1 ? '1 چیز' : `${n} چیزیں`} آپ کے اپنے account سے چاہیے:`,
    add: 'ڈالیں', from: (src) => `${src} سے لیں`,
    keylessHead: '💡 شاید اِن میں سے کچھ کی ضرورت ہی نہ پڑے —',
    keyless: { 'upi': 'UPI لنک سے کسی payment account کے بغیر ہی اصلی payment آ سکتی ہے', 'osm': 'مفت OpenStreetMap نقشے کے لیے کوئی key نہیں چاہیے', 'db-auth': 'جو database آپ جوڑیں گے اُس میں login پہلے سے موجود ہے', 'one-tap-db': 'NavBharatAI ایک tap میں آپ کا database بنا سکتا ہے' },
    tail: 'تب تک وہ بٹن “Coming soon” دکھائیں گے — باقی پوری ایپ معمول کے مطابق چلے گی۔',
  },
};

const ENGLISH: NoticeStrings = {
  head: (n) => `🔑 Your app is built. ${n === 1 ? '1 thing needs' : `${n} things need`} a key from your own account to go fully live:`,
  add: 'add',
  from: (src) => `get it from ${src}`,
  keylessHead: '💡 You may not need all of these —',
  keyless: KEYLESS_EN,
  tail: 'Until then those buttons show “Coming soon” — the rest of the app works normally.',
};

/**
 * The short, localized "what this app still needs from you" checklist, or `''` when there is nothing to
 * ask for (the overwhelmingly common case — a plain app needs no external account). `langCode` is
 * LanguageDetect's code; unknown / Latin-script falls back to English. Pure + deterministic.
 */
export function appRequirementsNotice(missing: AppRequirement[], langCode?: string | null): string {
  const items = (Array.isArray(missing) ? missing : []).filter((r) => r && r.kind === 'user');
  if (items.length === 0) return '';
  const s = (langCode && STRINGS[langCode]) || ENGLISH;
  const lines = items.map((r) => {
    const option = preferredOption(recipeFor(r.id), { envVars: r.matchedEnvVars, packages: r.matchedPackages });
    // NAME ONLY THE CHOSEN PROVIDER'S KEYS. `envVars` is an ANY-ONE-OF list — "Maps" carries both
    // GOOGLE_MAPS_API_KEY and MAPBOX_ACCESS_TOKEN — and rendering it verbatim reads as "go and get all
    // of these", next to a link to one console. Once the app's own packages and imports have told us
    // which provider it uses, asking for the other one's key is noise the user cannot act on.
    const names = option ? requiredVarNames(option, r.matchedEnvVars) : (r.envVars ?? []);
    const keys = names.filter((k) => typeof k === 'string' && k).map((k) => `\`${k}\``).join(', ');
    const base = keys
      ? `• **${r.label}** — ${r.settingsPath} → ${keys} ${s.add}`
      : `• **${r.label}** — ${r.settingsPath}`;
    // WHERE THE KEY COMES FROM. Without this the line is a perfect instruction for somebody who already
    // holds the key, and a dead end for everybody else. A service we have no curated recipe for keeps
    // exactly the old line — an invented link on a payment console is far worse than no link.
    const source = optionLink(option);
    return source ? `${base} · ${s.from(source)}` : base;
  });

  // THE ONE LINE THAT CAN DELETE A TASK RATHER THAN HELP WITH IT.
  //
  // This is the only place the notice grows, and it is worth the row: a shop can take real money over a
  // UPI link with no payment account at all, so the best possible outcome of this whole checklist is
  // that an item disappears from it. It appears ONLY when something still missing genuinely has a
  // keyless route, so a checklist with no shortcut is byte-identical to before.
  //
  // Capped at two. Three shortcuts in one sentence stops being advice and becomes a paragraph, and this
  // message has been under a "keep it short" instruction since 2026-08-03.
  const routes: string[] = [];
  for (const r of items) {
    const key = recipeFor(r.id)?.keylessKey;
    if (!key) continue;
    const text = s.keyless[key];
    if (text && !routes.includes(text)) routes.push(text);
    if (routes.length === 2) break;
  }
  // Borrow the sentence terminator from this language's own closing line rather than hardcoding a Latin
  // full stop — Hindi/Punjabi/Gujarati/Odia/Bengali end a sentence with `।` and Urdu with `۔`, and a
  // stray `.` is the small tell that a string was translated by someone not reading it. Derived rather
  // than declared so a new language cannot forget to set it.
  const stop = s.tail.trim().slice(-1);
  const keylessLine = routes.length > 0 ? `${s.keylessHead} ${routes.join('; ')}${stop}` : null;

  return [s.head(items.length), ...lines, ...(keylessLine ? [keylessLine] : []), s.tail].join('\n');
}
