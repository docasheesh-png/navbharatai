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
}

/** What the detector reads. All fields optional — a caller with only a file map still gets a result. */
export interface RequirementInput {
  /** Built file path → content. Only paths/deps/env-refs are inspected, never whole bodies semantically. */
  files?: Map<string, string> | Record<string, string> | null;
  /** The user's original prompt (weakest signal — used only to confirm, never alone). */
  prompt?: string | null;
}

interface ServiceSpec extends Omit<AppRequirement, 'kind'> {
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
    const hit = spec.packages.some((n) => pkgs.has(n)) || spec.envHints.some((n) => envs.has(n));
    if (!hit || seen.has(spec.id)) continue;
    seen.add(spec.id);
    found.push({ id: spec.id, label: spec.label, kind: spec.kind, envVars: [...spec.envVars], settingsPath: spec.settingsPath });
  }
  return found;
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
  tail: string;
}

const STRINGS: Record<string, NoticeStrings> = {
  hi: {
    head: (n) => `🔑 यह ऐप बन गया है। इसे पूरी तरह चालू करने के लिए ${n === 1 ? '1 चीज़' : `${n} चीज़ें`} आपके अपने account से चाहिए:`,
    add: 'डालें',
    tail: 'तब तक वे बटन “Coming soon” दिखाएँगे — बाक़ी पूरा ऐप सामान्य रूप से चलेगा।',
  },
  bn: {
    head: (n) => `🔑 অ্যাপটি তৈরি হয়ে গেছে। এটি সম্পূর্ণ চালু করতে ${n === 1 ? '১টি জিনিস' : `${n}টি জিনিস`} আপনার নিজের account থেকে দরকার:`,
    add: 'দিন', tail: 'ততক্ষণ ওই বোতামগুলি “Coming soon” দেখাবে — বাকি পুরো অ্যাপ স্বাভাবিক ভাবে চলবে।',
  },
  pa: {
    head: (n) => `🔑 ਐਪ ਬਣ ਗਈ ਹੈ। ਇਸਨੂੰ ਪੂਰੀ ਤਰ੍ਹਾਂ ਚਲਾਉਣ ਲਈ ${n === 1 ? '1 ਚੀਜ਼' : `${n} ਚੀਜ਼ਾਂ`} ਤੁਹਾਡੇ ਆਪਣੇ account ਤੋਂ ਚਾਹੀਦੀਆਂ ਹਨ:`,
    add: 'ਪਾਓ', tail: 'ਉਦੋਂ ਤੱਕ ਉਹ ਬਟਨ “Coming soon” ਦਿਖਾਉਣਗੇ — ਬਾਕੀ ਪੂਰੀ ਐਪ ਆਮ ਵਾਂਗ ਚੱਲੇਗੀ।',
  },
  gu: {
    head: (n) => `🔑 એપ બની ગઈ છે. તેને પૂરેપૂરી ચાલુ કરવા ${n === 1 ? '1 વસ્તુ' : `${n} વસ્તુઓ`} તમારા પોતાના account માંથી જોઈએ:`,
    add: 'ઉમેરો', tail: 'ત્યાં સુધી એ બટન “Coming soon” બતાવશે — બાકીની આખી એપ સામાન્ય રીતે ચાલશે.',
  },
  or: {
    head: (n) => `🔑 ଆପ୍‌ ତିଆରି ହୋଇଗଲା। ଏହାକୁ ସମ୍ପୂର୍ଣ୍ଣ ଚଳାଇବା ପାଇଁ ${n === 1 ? '୧ଟି ଜିନିଷ' : `${n}ଟି ଜିନିଷ`} ଆପଣଙ୍କ ନିଜ account ରୁ ଦରକାର:`,
    add: 'ଦିଅନ୍ତୁ', tail: 'ସେ ପର୍ଯ୍ୟନ୍ତ ସେହି ବଟନ୍‌ “Coming soon” ଦେଖାଇବ — ବାକି ପୂରା ଆପ୍‌ ସ୍ୱାଭାବିକ ଭାବେ ଚାଲିବ।',
  },
  ta: {
    head: (n) => `🔑 ஆப் தயாராகிவிட்டது. இதை முழுமையாக இயக்க ${n === 1 ? '1 விஷயம்' : `${n} விஷயங்கள்`} உங்கள் சொந்த account-லிருந்து தேவை:`,
    add: 'சேர்க்கவும்', tail: 'அதுவரை அந்த பட்டன்கள் “Coming soon” எனக் காட்டும் — மீதி முழு ஆப்பும் வழக்கம் போல் இயங்கும்.',
  },
  te: {
    head: (n) => `🔑 యాప్ తయారైంది. దీన్ని పూర్తిగా నడపడానికి ${n === 1 ? '1 విషయం' : `${n} విషయాలు`} మీ సొంత account నుండి కావాలి:`,
    add: 'జోడించండి', tail: 'అప్పటివరకు ఆ బటన్లు “Coming soon” అని చూపిస్తాయి — మిగిలిన యాప్ మామూలుగా పనిచేస్తుంది.',
  },
  kn: {
    head: (n) => `🔑 ಆ್ಯಪ್ ಸಿದ್ಧವಾಗಿದೆ. ಇದನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಚಲಾಯಿಸಲು ${n === 1 ? '1 ವಿಷಯ' : `${n} ವಿಷಯಗಳು`} ನಿಮ್ಮ ಸ್ವಂತ account ನಿಂದ ಬೇಕು:`,
    add: 'ಸೇರಿಸಿ', tail: 'ಅಲ್ಲಿಯವರೆಗೆ ಆ ಬಟನ್‌ಗಳು “Coming soon” ಎಂದು ತೋರಿಸುತ್ತವೆ — ಉಳಿದ ಪೂರ್ತಿ ಆ್ಯಪ್ ಎಂದಿನಂತೆ ಚಲಿಸುತ್ತದೆ.',
  },
  ml: {
    head: (n) => `🔑 ആപ്പ് തയ്യാറായി. ഇത് പൂർണ്ണമായി പ്രവർത്തിപ്പിക്കാൻ ${n === 1 ? '1 കാര്യം' : `${n} കാര്യങ്ങൾ`} നിങ്ങളുടെ സ്വന്തം account-ൽ നിന്ന് വേണം:`,
    add: 'ചേർക്കുക', tail: 'അതുവരെ ആ ബട്ടണുകൾ “Coming soon” എന്ന് കാണിക്കും — ബാക്കി ആപ്പ് പതിവുപോലെ പ്രവർത്തിക്കും.',
  },
  ar: {
    head: (n) => `🔑 ایپ بن گئی ہے۔ اِسے پوری طرح چلانے کے لیے ${n === 1 ? '1 چیز' : `${n} چیزیں`} آپ کے اپنے account سے چاہیے:`,
    add: 'ڈالیں', tail: 'تب تک وہ بٹن “Coming soon” دکھائیں گے — باقی پوری ایپ معمول کے مطابق چلے گی۔',
  },
};

const ENGLISH: NoticeStrings = {
  head: (n) => `🔑 Your app is built. ${n === 1 ? '1 thing needs' : `${n} things need`} a key from your own account to go fully live:`,
  add: 'add',
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
    const keys = (r.envVars ?? []).filter((k) => typeof k === 'string' && k).map((k) => `\`${k}\``).join(', ');
    return keys
      ? `• **${r.label}** — ${r.settingsPath} → ${keys} ${s.add}`
      : `• **${r.label}** — ${r.settingsPath}`;
  });
  return [s.head(items.length), ...lines, s.tail].join('\n');
}
