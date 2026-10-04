// AgentV3 — NO FAKE BUTTON, NO FAKE FEATURE (admin-mandated 2026-10-04, unbreakable).
//
// Admin, verbatim: *"navbharatai kab bhi koi app banaye, usme koi bhi function fake nahi hona chahiye! jab
// 'login' button bane, to fake login na bane, real login button ho, google login, apple login, user se real
// api secret mange jaye! … agar koi button/feature fake banaya hai, ya dummy/demo banaya hai, to user ko
// clearly bataya jaye ki yeh button fake hai, aur bataya jaye kyu fake hai. jaise api keys chahiye, secret
// chahiye … 3 dot menu ke secret and keys ya settings ke secret and keys me yeh secret dalo! red colour me
// saf saf likho user ki language me ki iske bina kaam fake/dummy/demo hoga!!!"*
//
// 🔴 WHY THE KEY WAS NEVER ASKED FOR. Three guards already exist and all three were blind to the same app:
//   • `AppRequirements` demands a key only when the app's code NAMES one (a package or an env var). A login
//     that checks `password === 'demo123'` names nothing, so no key was ever asked for.
//   • `AuthenticityAnalysis` finds the WORDS mock / fake / simulate. A demo login written in ordinary code
//     carries none of them.
//   • `SEED_PASSWORD_RULE` told the builder how to seed a demo user — and nothing told it that a seeded user
//     is not a login.
// The class: a feature whose real version needs the USER's own credential (login, payment, OTP, email) was
// implemented LOCALLY in ordinary-looking code, so the machinery that demands the credential never fired,
// and the user was handed a button that only pretends. This module reads the SHAPE, not the words:
//   login    — a sign-in screen whose password is written into the app (or compared in the browser), and no
//              auth provider anywhere in the project;
//   oauth    — a "Continue with Google / Apple" control with no OAuth SDK or route anywhere;
//   payment  — a pay/checkout action that marks itself paid with no gateway (or UPI link) anywhere;
//   otp      — an OTP the page generates or compares against a literal, with no SMS/auth provider;
//   email    — "email sent" with no transport anywhere.
// Each finding (1) is disclosed in the chat, in the user's language, naming the key and where to paste it;
// (2) puts a RED line on the app's own screen (`withHonestyBanner`, index.html) so a visitor of the preview
// or the published app is never fooled; (3) implies the requirement, so the closing ask card asks for the
// exact key (`impliedRequirementsFor`); (4) is said to the builder at write time (`fakeFeatureWriteNote`).
//
// 🔒 PRECISION FIRST, like every sibling (scriptedAssistant.ts, AuthenticityAnalysis.ts): the provider check
// is PROJECT-WIDE (a LoginPage that calls a context backed by Supabase is real, and the Supabase import may
// live in another file), a PIN lock on a personal diary is not a login, "mark as paid" in an expense tracker
// is not a payment, a chat's "message sent" is not an email, and a request that ASKED for a demo / offline /
// local login is left alone. A false positive costs a user one red line on a working screen; a false
// negative is the fake button the admin saw. Both halves are tested. PURE — no I/O.

import { signInCandidates, authLivesInTheBrowser } from './signInExplore';
import { impliedRequirement, type AppRequirement } from './AppRequirements';
import { recipeFor, preferredOption, requiredVarNames } from '../../lib/credentialRecipes';
import { HONESTY_BANNER_OPEN, HONESTY_BANNER_CLOSE, stripHonestyBanner, hasHonestyBanner } from '../../lib/honestyBanner';

export { hasHonestyBanner };

export type FakeFeatureKind = 'login' | 'oauth-button' | 'payment' | 'otp' | 'email' | 'sms' | 'upload';

/** The AppRequirements service the REAL version of each fake needs. */
export type ImpliedServiceId = 'login' | 'payments_razorpay' | 'sms' | 'email_api' | 'storage';

export interface FakeFeatureFinding {
  kind: FakeFeatureKind;
  file: string;
  /** 1-based line of the evidence. */
  line: number;
  snippet: string;
  requirementId: ImpliedServiceId;
}

/** `AGENTV3_NO_FAKE_FEATURES=off` reverts every reader of this module with no deploy. Default ON. */
export function noFakeFeaturesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_NO_FAKE_FEATURES ?? '').trim().toLowerCase() !== 'off';
}

const SOURCE_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|html)$/i;
const NOT_APP_RE = /(^|[\\/])(?:__mocks__|mocks?|tests?|__tests__|e2e|node_modules|dist|build|coverage)([\\/]|$)|\.(?:test|spec)\./i;
/** Our own in-app notice must never be read as the app's fake (the banner names login, payment, OTP, email). */
const OUR_BANNER_RE = /nbai-honesty/;

// ── What makes a feature REAL (checked over the WHOLE project) ────────────────────────────────────────
const AUTH_PROVIDER_RE = /@supabase\/supabase-js|supabase\.auth\b|firebase\/auth|\bgetAuth\s*\(|signInWith(?:Popup|Redirect|EmailAndPassword|OAuth|Password|Otp|PhoneNumber|Credential|IdToken)\b|@clerk\/|@auth0\/|\bauth0\b|next-auth|\bpassport\b|jsonwebtoken|\bjose\b|\bbcrypt|argon2|@react-oauth\/google|google\.accounts\.id|AppleID\.auth|['"`]\/(?:api\/)?(?:auth|login|signin|sign-in|session|users\/login)\b/i;
const OAUTH_RE = /signInWith(?:Popup|Redirect|OAuth)\b|GoogleAuthProvider|OAuthProvider|@react-oauth\/google|google\.accounts\.id|AppleID\.auth|['"`]\/(?:api\/)?(?:auth|oauth)\/(?:google|apple|facebook|github|microsoft)\b|next-auth|@clerk\/|@auth0\/|\bpassport\b|supabase\.auth\.signIn|provider\s*:\s*['"](?:google|apple|github|facebook|azure|microsoft)['"]/i;
const GATEWAY_RE = /\brazorpay\b|\bcashfree\b|\bstripe\b|\bpaytm\b|\bphonepe\b|\bpayu\b|\binstamojo\b|\bpaypal\b|upi:\/\/|pay\?pa=|@cashfreepayments|checkout\.razorpay|['"`]\/(?:api\/)?(?:payments?|pay|checkout|orders?\/create|create-order|verify-payment)\b/i;
const SMS_RE = /\btwilio\b|\bmsg91\b|\btextlocal\b|\bfast2sms\b|\b2factor\b|firebase\/auth|signInWithPhoneNumber|signInWithOtp|verifyOtp\s*\(\s*\{|supabase\.auth\b|['"`]\/(?:api\/)?(?:otp|send-otp|verify-otp|sms)\b/i;
const STORAGE_RE = /supabase\.storage\b|firebase\/storage|\bgetStorage\s*\(|\bcloudinary\b|@aws-sdk\/client-s3|S3Client|\bmulter\b|uploadthing|@uploadcare|\bimagekit\b|['"`]\/(?:api\/)?(?:upload|files|media|images|assets)\b|new\s+FormData\s*\(/i;
const MAIL_RE = /\bnodemailer\b|['"]resend['"]|\bResend\b|\bsendgrid\b|\bmailgun\b|client-ses\b|SESClient|\bemailjs\b|\bpostmark\b|\bbrevo\b|sendinblue|mailto:|formspree|getform\.io|web3forms|data-netlify|['"`]\/(?:api\/)?(?:email|mail|send-email|send-mail|contact|subscribe|newsletter)\b/i;

// ── The fake shapes (checked per file) ────────────────────────────────────────────────────────────────
/** A credential compared in the browser: `password === 'x'`, `users.find(u => u.password …)`, `u.password === password`. */
const CRED_COMPARE_RE = /\b(?:password|pass(?:word)?|pwd)\w*\s*[!=]==?\s*['"`][^'"`\n]{3,64}['"`]|\b(?:users?|accounts?|credentials|members)\w*\.find\s*\([^)]*\bpassword\b|\.password\s*[!=]==?\s*(?:password|pass|pwd|input|value|entered)\b/i;
const SIGNIN_SURFACE_RE = /type=["']password["']|\b(?:sign\s*in|log\s*in|login|signin)\b/i;
const OAUTH_BUTTON_RE = /(?:continue|sign\s*in|log\s*in|login|sign\s*up|register)\s+with\s+(?:google|apple|facebook|github|microsoft)\b|\b(?:google|apple)\s+(?:sign[\s-]?in|login)\b/i;
const PAY_ACTION_RE = /\bpay\s*now\b|\bproceed\s+to\s+pay(?:ment)?\b|\bmake\s+(?:a\s+)?payment\b|\bbuy\s+now\b|\bcomplete\s+(?:purchase|payment)\b|\bpay\s*(?:₹|\$|rs\.?\s?\d)|\bhandle(?:Pay|Payment|Checkout)\w*\b|\bprocess(?:Payment|Checkout)\w*\b|\b(?:start|initiate|begin)Payment\w*\b|\bcheckout\b/i;
const PAID_STATE_RE = /\bset(?:Is)?(?:Paid|PaymentDone|PaymentSuccess|PaymentStatus|PaymentComplete|OrderPaid)\w*\s*\(|\b(?:is)?[pP]aid\s*:\s*true\b|\bpayment(?:Status|State|Result)?\s*[:=]\s*['"`](?:success|succeeded|paid|done|completed?|captured)['"`]|\bstatus\s*[:=]\s*['"`](?:paid|payment[\s_-]?(?:success|done|completed?))['"`]/i;
const OTP_FAKE_RE = /\b\w*otp\w*\s*[!=]==?\s*['"`]\d{4,8}['"`]|\b(?:const|let|var)\s+\w*otp\w*\s*=\s*(?:String\s*\(|`\$\{)?\s*Math\.(?:floor|random)|\b(?:your|demo|test)\s+otp\s*(?:is|:)/i;
const EMAIL_SENT_RE = /\be-?mail\s+(?:has\s+been\s+|was\s+|successfully\s+|is\s+)?sent\b|\bsent\s+(?:an?\s+|the\s+)?e-?mail\b|\bsetEmailSent\s*\(\s*true|\bemailSent\s*:\s*true\b|\b(?:reset|verification|confirmation|magic|activation)\s+(?:link|e-?mail|code)\s+(?:has\s+been\s+|was\s+)?sent\b/i;
/** "SMS sent", "sent to your mobile" — with nothing in the project that could send one. */
const SMS_SENT_RE = /\bsms\s+(?:has\s+been\s+|was\s+|successfully\s+)?sent\b|\bsent\s+(?:an?\s+|the\s+)?sms\b|\bsent\s+to\s+your\s+(?:phone|mobile|number)\b/i;
/** "Uploaded to the cloud/server" — a claim about a place the file never reached. A local gallery that says "upload complete" is left alone. */
const UPLOAD_CLAIM_RE = /\b(?:uploaded|saved|synced|backed\s+up)\s+to\s+(?:the\s+|our\s+)?(?:cloud|server)\b/i;
/** A sign-up form — read with the shared browser-only judgement below, never on its own. */
const SIGNUP_SURFACE_RE = /\b(?:sign\s*up|register|create\s+(?:an?\s+)?account)\b/i;
/** Where a browser-only account store is written — the evidence line for the whole-project judgement below. */
const BROWSER_STORE_WRITE_RE = /(?:local|session)Storage\.setItem\(|indexedDB\.open\(|\bset\(\s*['"`][^'"`]*(?:users?|accounts?)/i;
/** A request about a password MANAGER keeps passwords in the browser on purpose; that is the app, not a login. */
const PASSWORD_MANAGER_RE = /\bpassword\s+(?:manager|vault|keeper|saver|generator)\b|\bvault\s+app\b/i;

// ── Requests that ASKED for the local thing (the prompt, not the code) ────────────────────────────────
const ASKED_LOCAL_LOGIN_RE = /\b(?:demo|dummy|offline|local(?:-only)?|hard-?coded|no[\s-]backend|without\s+(?:a\s+)?(?:backend|server|database))\b[^.\n]{0,40}\b(?:login|password|auth|sign[\s-]?in)\b|\b(?:login|password|auth|sign[\s-]?in)\b[^.\n]{0,40}\b(?:demo|dummy|offline|local(?:-only)?|hard-?coded)\b|\bpin\s*(?:lock|code)\b|\bpassword\s+gate\b|बिना\s+(?:backend|server|database)/i;
const ASKED_NO_PAYMENT_RE = /\bcash\s+on\s+delivery\b|\bcod\b|\bcash\s+only\b|\bno\s+(?:online\s+)?payments?\b|\bwithout\s+(?:online\s+)?payments?\b|\bmanual\s+payment\b|\boffline\s+payment\b/i;
const ASKED_DEMO_RE = /\b(?:demo|dummy|mock|fake|simulated?)\s+(?:app|version|mode|flow|data)\b/i;

const MAX_FINDINGS = 12;
const SNIPPET_MAX = 120;

const trimSnippet = (line: string): string => {
  const t = line.trim();
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t;
};

/** The 1-based line of the first match, with its text. */
function firstHit(content: string, re: RegExp): { line: number; text: string } | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 4000 || /^\s*(?:\/\/|\*|\/\*)/.test(l)) continue; // a comment is not the app
    if (re.test(l)) return { line: i + 1, text: l };
  }
  return null;
}

function appSources(files: Readonly<Record<string, string>>): Array<[string, string]> {
  return Object.entries(files ?? {})
    .filter(([p, c]) => typeof c === 'string' && c.length > 0 && SOURCE_RE.test(p) && !NOT_APP_RE.test(p))
    .slice(0, 400);
}

const REQUIREMENT_OF: Record<FakeFeatureKind, ImpliedServiceId> = {
  login: 'login', 'oauth-button': 'login', payment: 'payments_razorpay', otp: 'sms', email: 'email_api', sms: 'sms', upload: 'storage',
};

/**
 * Every fake feature in the project. `prompt` is the user's request: a request that asked for a demo,
 * an offline login or cash-only payment stands the matching rule down. PURE.
 */
export function findFakeFeatures(files: Readonly<Record<string, string>>, prompt = ''): FakeFeatureFinding[] {
  const sources = appSources(files);
  if (sources.length === 0) return [];
  const req = String(prompt ?? '');
  if (ASKED_DEMO_RE.test(req)) return [];
  const all = sources.map(([, c]) => c);
  const has = (re: RegExp) => all.some((c) => re.test(c));
  const authProvider = has(AUTH_PROVIDER_RE);
  const oauth = has(OAUTH_RE);
  const gateway = has(GATEWAY_RE);
  const sms = has(SMS_RE);
  const mail = has(MAIL_RE);
  const storage = has(STORAGE_RE);
  const localLoginAsked = ASKED_LOCAL_LOGIN_RE.test(req) || PASSWORD_MANAGER_RE.test(req);
  const noPaymentAsked = ASKED_NO_PAYMENT_RE.test(req);

  const out: FakeFeatureFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: FakeFeatureKind, file: string, hit: { line: number; text: string } | null) => {
    if (!hit || seen.has(`${kind}\u0000${file}`) || out.length >= MAX_FINDINGS) return;
    seen.add(`${kind}\u0000${file}`);
    out.push({ kind, file, line: hit.line, snippet: trimSnippet(hit.text), requirementId: REQUIREMENT_OF[kind] });
  };

  for (const [file, content] of sources) {
    if (OUR_BANNER_RE.test(content) && /\.html?$/i.test(file)) continue;
    // LOGIN: a sign-in surface whose credential lives in the app, and no provider anywhere.
    if (!authProvider && !localLoginAsked && SIGNIN_SURFACE_RE.test(content)) {
      const demo = signInCandidates({ [file]: content }).length > 0;
      const hit = firstHit(content, CRED_COMPARE_RE) ?? (demo ? firstHit(content, /\b(?:password|pass(?:word)?(?:Hash|Digest)?)\s*:/i) : null);
      if (hit) add('login', file, hit);
    }
    // OAUTH BUTTON: "Continue with Google" with no SDK or route that could do it.
    if (!oauth && !localLoginAsked) add('oauth-button', file, firstHit(content, OAUTH_BUTTON_RE));
    // PAYMENT: a pay action that marks itself paid, with no gateway or UPI link anywhere.
    if (!gateway && !noPaymentAsked && PAY_ACTION_RE.test(content)) add('payment', file, firstHit(content, PAID_STATE_RE));
    // OTP: generated or compared by the page itself, with nothing that could send one.
    if (!sms) add('otp', file, firstHit(content, OTP_FAKE_RE));
    // EMAIL: "sent" with no transport anywhere.
    if (!mail) add('email', file, firstHit(content, EMAIL_SENT_RE));
    // SMS: "sent to your mobile" with nothing that could send one.
    if (!sms) add('sms', file, firstHit(content, SMS_SENT_RE));
    // UPLOAD: "uploaded to the cloud" with no storage transport anywhere.
    if (!storage) add('upload', file, firstHit(content, UPLOAD_CLAIM_RE));
  }
  // ONE JUDGEMENT WITH THE SIGN-IN EXPLORER (Q-540, #3526). `authLivesInTheBrowser` decides that an app's
  // accounts live in the browser alone — the explorer signs a throwaway account up there because the app has
  // no server to keep one. That is the very fake this module exists to disclose, so the two must never
  // disagree: on the real school app the sign-up wrote to `localStorage.setItem(USERS_KEY, …)`, which the
  // shape above did not read, and the explorer knew what the user was never told. A sign-in surface is still
  // required (a page that only stores a password is not a login), and every stand-down above still holds.
  if (!out.some((f) => f.kind === 'login') && !authProvider && !localLoginAsked && out.length < MAX_FINDINGS) {
    let browserOnly = false;
    try { browserOnly = authLivesInTheBrowser(files); } catch { browserOnly = false; }
    if (browserOnly && sources.some(([, c]) => SIGNIN_SURFACE_RE.test(c) || SIGNUP_SURFACE_RE.test(c))) {
      const store = sources.find(([, c]) => /password/i.test(c) && BROWSER_STORE_WRITE_RE.test(c))
        ?? sources.find(([, c]) => BROWSER_STORE_WRITE_RE.test(c));
      if (store) add('login', store[0], firstHit(store[1], BROWSER_STORE_WRITE_RE));
    }
  }
  return out;
}

// ── Where the user pastes the key ─────────────────────────────────────────────────────────────────────
/** The phone app's path (the admin's "3 dot menu") and the website's — both are said, the phone one first. */
export const KEYS_PATH_PHONE = 'NavBharatAI → ⋮ More → Keys & Secrets';
export const KEYS_PATH_WEB = 'Settings → App Settings → Secrets & API Keys';

/** The exact env names the real version reads — the recipe's recommended provider, first option. */
export function keysForFinding(finding: Pick<FakeFeatureFinding, 'requirementId'>): string[] {
  const option = preferredOption(recipeFor(finding.requirementId), null);
  return requiredVarNames(option, []);
}

/**
 * The AppRequirements entries a project's fakes imply, so the closing ask card asks for the exact keys
 * and the key checklist lists them. One entry per service, `why` written for the ask card. PURE.
 */
export function impliedRequirementsFor(findings: readonly FakeFeatureFinding[]): AppRequirement[] {
  const out: AppRequirement[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (seen.has(f.requirementId)) continue;
    seen.add(f.requirementId);
    const req = impliedRequirement(f.requirementId, keysForFinding(f));
    if (!req) continue;
    out.push({ ...req, why: `${ENGLISH.feature[f.kind]} in your app is a demo until this key is added — then it becomes real. Paste it here, or in ${KEYS_PATH_PHONE}.` });
  }
  return out;
}

// ── The words, in the user's language ─────────────────────────────────────────────────────────────────
interface Strings {
  feature: Record<FakeFeatureKind, string>;
  /** One line per fake: what is a demo, that it is not real, which keys, where. */
  line: (feature: string, files: string, keys: string, where: string) => string;
  /** Closing line: add the key, then tell me, and I make it real. */
  tail: string;
  /** The on-screen banner's heading. */
  banner: string;
}

const ENGLISH: Strings = {
  feature: { login: 'Login', 'oauth-button': 'Google / Apple sign-in', payment: 'Payment', otp: 'OTP', email: 'Email sending', sms: 'SMS sending', upload: 'Cloud upload' },
  line: (feature, files, keys, where) => `🔴 ${feature} in this app is a DEMO — it is not real (${files}). Without a key it only pretends to work. To make it real, add ${keys} in ${where}.`,
  tail: 'Once the key is saved, reply "make it real" and I will wire it in. Until then that part of the app is clearly marked as a demo on screen.',
  banner: 'DEMO — not real',
};

const STRINGS: Record<string, Strings> = {
  hi: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email भेजना', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 इस ऐप में ${feature} असली नहीं है — यह DEMO है (${files})। बिना key के यह सिर्फ़ दिखावा है। असली बनाने के लिए ${keys} यहाँ डालें: ${where}।`,
    tail: 'Key डालने के बाद मुझे “असली बनाओ” लिखें, मैं जोड़ दूँगा। तब तक ऐप की स्क्रीन पर साफ़ लिखा रहेगा कि यह demo है।',
    banner: 'DEMO — असली नहीं',
  },
  bn: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email পাঠানো', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 এই অ্যাপে ${feature} আসল নয় — এটি DEMO (${files})। key ছাড়া এটি শুধু দেখানোর জন্য। আসল করতে ${keys} এখানে দিন: ${where}।`,
    tail: 'Key দেওয়ার পর আমাকে “আসল করো” লিখুন, আমি যুক্ত করে দেব। ততক্ষণ অ্যাপের স্ক্রিনে স্পষ্ট লেখা থাকবে যে এটি demo।',
    banner: 'DEMO — আসল নয়',
  },
  pa: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email ਭੇਜਣਾ', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 ਇਸ ਐਪ ਵਿੱਚ ${feature} ਅਸਲੀ ਨਹੀਂ ਹੈ — ਇਹ DEMO ਹੈ (${files})। key ਤੋਂ ਬਿਨਾਂ ਇਹ ਸਿਰਫ਼ ਦਿਖਾਵਾ ਹੈ। ਅਸਲੀ ਬਣਾਉਣ ਲਈ ${keys} ਇੱਥੇ ਪਾਓ: ${where}।`,
    tail: 'Key ਪਾਉਣ ਤੋਂ ਬਾਅਦ ਮੈਨੂੰ “ਅਸਲੀ ਬਣਾਓ” ਲਿਖੋ, ਮੈਂ ਜੋੜ ਦਿਆਂਗਾ। ਉਦੋਂ ਤੱਕ ਐਪ ਦੀ ਸਕ੍ਰੀਨ ’ਤੇ ਸਾਫ਼ ਲਿਖਿਆ ਰਹੇਗਾ ਕਿ ਇਹ demo ਹੈ।',
    banner: 'DEMO — ਅਸਲੀ ਨਹੀਂ',
  },
  gu: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email મોકલવું', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 આ ઍપમાં ${feature} અસલી નથી — આ DEMO છે (${files})। key વગર તે માત્ર દેખાવ છે. અસલી બનાવવા ${keys} અહીં મૂકો: ${where}.`,
    tail: 'Key મૂક્યા પછી મને “અસલી બનાવો” લખો, હું જોડી દઈશ. ત્યાં સુધી ઍપની સ્ક્રીન પર સ્પષ્ટ લખેલું રહેશે કે આ demo છે.',
    banner: 'DEMO — અસલી નથી',
  },
  or: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email ପଠାଇବା', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 ଏହି ଆପ୍‌ରେ ${feature} ଅସଲ ନୁହେଁ — ଏହା DEMO (${files})। key ବିନା ଏହା କେବଳ ଦେଖାଣିଆ। ଅସଲ କରିବାକୁ ${keys} ଏଠାରେ ଦିଅନ୍ତୁ: ${where}।`,
    tail: 'Key ଦେବା ପରେ ମୋତେ “ଅସଲ କର” ଲେଖନ୍ତୁ, ମୁଁ ଯୋଡ଼ିଦେବି। ସେ ପର୍ଯ୍ୟନ୍ତ ଆପ୍ ସ୍କ୍ରିନ୍‌ରେ ସ୍ପଷ୍ଟ ଲେଖା ରହିବ ଯେ ଏହା demo।',
    banner: 'DEMO — ଅସଲ ନୁହେଁ',
  },
  ta: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email அனுப்புதல்', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 இந்த ஆப்பில் ${feature} உண்மையானது அல்ல — இது DEMO (${files}). key இல்லாமல் இது வெறும் காட்சிக்கே. உண்மையாக்க ${keys} இங்கே சேர்க்கவும்: ${where}.`,
    tail: 'Key சேர்த்த பிறகு “உண்மையாக்கு” என்று எழுதுங்கள், நான் இணைத்து விடுகிறேன். அதுவரை ஆப் திரையில் இது demo என்று தெளிவாக இருக்கும்.',
    banner: 'DEMO — உண்மையல்ல',
  },
  te: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email పంపడం', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 ఈ యాప్‌లో ${feature} నిజమైనది కాదు — ఇది DEMO (${files}). key లేకుండా ఇది కేవలం చూపించడానికే. నిజం చేయడానికి ${keys} ఇక్కడ పెట్టండి: ${where}.`,
    tail: 'Key పెట్టాక నాకు “నిజం చేయి” అని రాయండి, నేను కలుపుతాను. అప్పటి వరకు యాప్ స్క్రీన్‌పై ఇది demo అని స్పష్టంగా ఉంటుంది.',
    banner: 'DEMO — నిజం కాదు',
  },
  kn: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email ಕಳುಹಿಸುವುದು', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ${feature} ನಿಜವಲ್ಲ — ಇದು DEMO (${files}). key ಇಲ್ಲದೆ ಇದು ಬರೀ ತೋರಿಕೆ. ನಿಜ ಮಾಡಲು ${keys} ಇಲ್ಲಿ ಹಾಕಿ: ${where}.`,
    tail: 'Key ಹಾಕಿದ ಮೇಲೆ ನನಗೆ “ನಿಜ ಮಾಡು” ಎಂದು ಬರೆಯಿರಿ, ನಾನು ಸೇರಿಸುತ್ತೇನೆ. ಅಲ್ಲಿಯವರೆಗೆ ಆ್ಯಪ್ ಪರದೆಯಲ್ಲಿ ಇದು demo ಎಂದು ಸ್ಪಷ್ಟವಾಗಿ ಇರುತ್ತದೆ.',
    banner: 'DEMO — ನಿಜವಲ್ಲ',
  },
  ml: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email അയയ്ക്കൽ', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 ഈ ആപ്പിൽ ${feature} യഥാർത്ഥമല്ല — ഇത് DEMO ആണ് (${files}). key ഇല്ലാതെ ഇത് വെറും കാഴ്ചയ്ക്ക് മാത്രം. യഥാർത്ഥമാക്കാൻ ${keys} ഇവിടെ ചേർക്കുക: ${where}.`,
    tail: 'Key ചേർത്ത ശേഷം “യഥാർത്ഥമാക്കൂ” എന്ന് എഴുതൂ, ഞാൻ ചേർക്കാം. അതുവരെ ആപ്പ് സ്ക്രീനിൽ ഇത് demo ആണെന്ന് വ്യക്തമായി കാണാം.',
    banner: 'DEMO — യഥാർത്ഥമല്ല',
  },
  ar: {
    feature: { login: 'Login', 'oauth-button': 'Google / Apple login', payment: 'Payment', otp: 'OTP', email: 'Email بھیجنا', sms: 'SMS', upload: 'Cloud upload' },
    line: (feature, files, keys, where) => `🔴 اِس ایپ میں ${feature} اصلی نہیں ہے — یہ DEMO ہے (${files})۔ key کے بغیر یہ صرف دکھاوا ہے۔ اصلی بنانے کے لیے ${keys} یہاں ڈالیں: ${where}۔`,
    tail: 'Key ڈالنے کے بعد مجھے “اصلی بناؤ” لکھیں، میں جوڑ دوں گا۔ تب تک ایپ کی اسکرین پر صاف لکھا رہے گا کہ یہ demo ہے۔',
    banner: 'DEMO — اصلی نہیں',
  },
};

function stringsFor(langCode?: string | null): Strings {
  return (langCode && STRINGS[langCode]) || ENGLISH;
}

/** One finding per feature kind, files joined, for the chat line and the banner. */
function byKind(findings: readonly FakeFeatureFinding[]): Array<{ kind: FakeFeatureKind; files: string[]; keys: string[] }> {
  const groups = new Map<FakeFeatureKind, { kind: FakeFeatureKind; files: string[]; keys: string[] }>();
  for (const f of findings) {
    const g = groups.get(f.kind) ?? { kind: f.kind, files: [], keys: keysForFinding(f) };
    if (!g.files.includes(f.file)) g.files.push(f.file);
    groups.set(f.kind, g);
  }
  return [...groups.values()];
}

/**
 * The lines appended to the user's summary — one per fake feature, in the user's language, naming the
 * files, the exact keys and both paths. '' when there is nothing to disclose. PURE.
 */
export function fakeFeatureNotice(findings: readonly FakeFeatureFinding[], langCode?: string | null): string {
  if (!findings || findings.length === 0) return '';
  const s = stringsFor(langCode);
  const where = `${KEYS_PATH_PHONE} / ${KEYS_PATH_WEB}`;
  const lines = byKind(findings).map((g) => s.line(s.feature[g.kind], g.files.slice(0, 3).join(', '), g.keys.join(', '), where));
  return ['', '', ...lines, s.tail].join('\n');
}

/** The admin-report line. PURE. */
export function fakeFeatureReportLine(findings: readonly FakeFeatureFinding[]): string {
  const kinds = [...new Set(findings.map((f) => f.kind))];
  return `The app has ${kinds.join(', ')} that only pretend${kinds.length === 1 ? 's' : ''} to work (no provider anywhere in the project): `
    + findings.slice(0, 5).map((f) => `${f.file}:${f.line} ${f.snippet}`).join(' · ');
}

// ── The RED line on the app's own screen ──────────────────────────────────────────────────────────────
const BANNER_OPEN = HONESTY_BANNER_OPEN;
const BANNER_CLOSE = HONESTY_BANNER_CLOSE;

/** Text for the banner — the same words as the chat line, minus the file names (a visitor has no files). */
export function honestyBannerLines(findings: readonly FakeFeatureFinding[], langCode?: string | null): string[] {
  const s = stringsFor(langCode);
  return byKind(findings).map((g) => `⚠️ ${s.feature[g.kind]}: ${s.banner}. ${g.keys.join(', ')} → ${KEYS_PATH_PHONE} / ${KEYS_PATH_WEB}`);
}

/**
 * index.html with the red notice block replaced, added, or removed — whichever the findings call for.
 * Idempotent: a block from an earlier build is always replaced, and no findings means no block, so an
 * app whose demo was made real loses the banner on the next build. Fixed to the top of the page, red,
 * in the user's language, dismissible for the session (the × is 36px for a thumb). The text avoids
 * every word `scanAuthenticity` reads as a left-over stub, because index.html is scanned too. PURE.
 */
export function withHonestyBanner(html: string | null | undefined, findings: readonly FakeFeatureFinding[], langCode?: string | null): string | null {
  if (html == null) return null;
  const stripped = stripHonestyBanner(html);
  if (!findings || findings.length === 0) return stripped;
  const lines = honestyBannerLines(findings, langCode);
  const lang = langCode && STRINGS[langCode] ? langCode : 'en';
  const json = JSON.stringify(lines).replace(/</g, '\\u003c');
  const script = [
    BANNER_OPEN,
    '<script>',
    '(function(){',
    `  var lines=${json};`,
    '  function show(){',
    '    if(document.getElementById("nbai-honesty"))return;',
    '    try{if(sessionStorage.getItem("nbai-honesty-hidden")==="1")return;}catch(e){}',
    '    var bar=document.createElement("div");bar.id="nbai-honesty";bar.setAttribute("role","alert");',
    `    bar.setAttribute("lang",${JSON.stringify(lang)});`,
    '    bar.style.cssText="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;font:600 14px/1.45 system-ui,-apple-system,sans-serif;padding:10px 48px 10px 14px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:pre-wrap;word-break:break-word;";',
    '    bar.textContent=lines.join("\\n");',
    '    var x=document.createElement("button");x.type="button";x.setAttribute("aria-label","Close");x.textContent="\\u00d7";',
    '    x.style.cssText="position:absolute;top:4px;right:6px;width:36px;height:36px;background:transparent;border:0;color:#fff;font-size:24px;line-height:36px;cursor:pointer;";',
    '    x.onclick=function(){try{sessionStorage.setItem("nbai-honesty-hidden","1");}catch(e){}bar.remove();};',
    '    bar.appendChild(x);document.body.appendChild(bar);',
    '  }',
    '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",show);else show();',
    '})();',
    '</script>',
    BANNER_CLOSE,
  ].join('\n');
  if (/<\/body>/i.test(stripped)) return stripped.replace(/<\/body>/i, `    ${script}\n  </body>`);
  return `${stripped}\n${script}\n`;
}

// ── Said to the builder while the file is still open ──────────────────────────────────────────────────
const WRITE_NOTE_FIX: Record<FakeFeatureKind, string> = {
  login: 'A login whose password is written into the app is a demo, not a login. Wire the user\'s own auth provider (Supabase / Firebase / Clerk — real email, Google and Apple sign-in; ask for its keys with request_secrets when you have that tool)',
  'oauth-button': 'A "Continue with Google / Apple" button with no OAuth SDK or route behind it is a fake button. Wire the provider (Supabase Auth / Firebase Auth / Clerk; ask for its keys with request_secrets when you have that tool)',
  payment: 'A payment that marks itself paid is a fake payment. Use generate_payment (Razorpay / Cashfree, server-verified) or a UPI link that opens a real UPI app; ask for the gateway keys with request_secrets when you have that tool',
  otp: 'An OTP the page generates or compares against a literal is a fake OTP. Send it through a provider (Firebase / Supabase phone sign-in, MSG91, Twilio) and verify it there; ask for the keys with request_secrets when you have that tool',
  email: '"Email sent" with no transport is a fake email. Send it through a provider (generate_email — Resend / SendGrid / SMTP) or open a mailto: link; ask for the keys with request_secrets when you have that tool',
  sms: '"SMS sent" with nothing that sends one is a fake SMS. Send it through a provider (MSG91, Twilio, Firebase phone sign-in); ask for the keys with request_secrets when you have that tool',
  upload: '"Uploaded to the cloud" with no storage is a fake upload. Use the user\'s storage (Supabase Storage, Firebase Storage, Cloudinary, S3 — Settings → App Settings → Storage) or say the file stays on this device',
};

/**
 * One note per fake shape in the file being written, for the builder (the end-of-build disclosure tells
 * the USER; this tells the BUILDER, who can still make it real). Provider presence is judged on this one
 * file only — the project may hold the provider elsewhere, in which case the note is one false alarm
 * the builder can ignore, while a real fake is caught where it is cheapest to fix. '' when clean. PURE.
 */
export function fakeFeatureWriteNote(file: string, content: string): string {
  if (typeof content !== 'string' || !content) return '';
  const hits = findFakeFeatures({ [file]: content });
  if (hits.length === 0) return '';
  const lines = hits.map((h) => `  ${file}:${h.line} ${h.snippet}\n  → ${WRITE_NOTE_FIX[h.kind]}.`).join('\n');
  return `\n\n⛔ NO FAKE BUTTON, NO FAKE FEATURE — ${file} has a feature that only pretends to work:\n${lines}\n`
    + 'Until the real provider is wired, that screen MUST carry a clearly visible RED line in the user\'s language saying it is a '
    + `demo and not real, and which key makes it real (${KEYS_PATH_PHONE}); say the same in your final message. `
    + 'Never present it as working.';
}
