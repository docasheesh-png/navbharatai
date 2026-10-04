// ⛔ NO FAKE BUTTON, NO FAKE FEATURE (admin-mandated 2026-10-04, unbreakable).
//
// "jab 'login' button bane, to fake login na bane … user se real api secret mange jaye! agar koi button/feature
// fake banaya hai, to user ko clearly bataya jaye ki yeh fake hai, aur kyu … red colour me, user ki language me."
//
// The class behind it: a feature whose real version needs the user's own credential was built LOCALLY, so it
// named no key, so nothing ever asked for one (AppRequirements reads names; AuthenticityAnalysis reads the
// words mock/fake). These tests lock the shape-reader, its precision, the red on-screen line, the chat line
// in the user's language, the key ask it implies, the write-time note, and that every lane carries the rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findFakeFeatures, fakeFeatureNotice, fakeFeatureWriteNote, impliedRequirementsFor, keysForFinding,
  withHonestyBanner, hasHonestyBanner, honestyBannerLines, noFakeFeaturesEnabled, KEYS_PATH_PHONE,
} from '../src/server/AgentV3/fakeFeatureScan';
import { detectAppRequirements, unconfiguredRequirements, appRequirementsNotice } from '../src/server/AgentV3/AppRequirements';
import { postBuildKeyAsks } from '../src/server/AgentV3/secretRequest';
import { scanAuthenticity } from '../src/server/AgentV3/AuthenticityAnalysis';
const HONESTY_MARK = 'nbai-honesty';
import { NO_FAKE_FEATURE_RULE, SEED_PASSWORD_RULE } from '../src/server/AgentV3/noEvalRule';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { extractHonestyBanner, stripHonestyBanner } from '../src/lib/honestyBanner';
import { buildReactPreview } from '../src/server/runtime/ReactPreview';
import { buildSourceAppPreview } from '../src/lib/previewUtils';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';
import { featurePresenceRepairPrompt } from '../src/server/AgentV3/FeaturePresence';
import { authenticityRepairInstruction } from '../src/server/AgentV3/AuthenticityAnalysis';

const DEMO_LOGIN = `import { useState } from 'react';
const DEMO_USER = { email: 'demo@shop.in', password: 'demo123' };
export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = () => {
    if (email === DEMO_USER.email && password === DEMO_USER.password) { localStorage.setItem('token', 'ok'); onLogin(); }
  };
  return <form onSubmit={submit}><input value={email} onChange={(e) => setEmail(e.target.value)} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /><button>Login</button></form>;
}`;

const HASHED_DEMO_LOGIN = `export const USERS = [{ username: 'student', passwordHash: hashPassword("demo123") }];
export function LoginForm() { return <form><input type="password" /><button>Sign in</button></form>; }`;

const SUPABASE_LOGIN = `import { supabase } from '../lib/supabase';
export default function LoginPage() {
  const signIn = (email: string, password: string) => supabase.auth.signInWithPassword({ email, password });
  return <form><input type="password" /><button>Login</button></form>;
}`;

const PIN_LOCK = `export function PinLock({ onUnlock }) { const [pin, setPin] = useState('');
  return <form onSubmit={() => { if (pin === '1234') onUnlock(); }}><input type="password" value={pin} /><button>Unlock</button></form>; }`;

const GOOGLE_BUTTON = `export function Welcome() { return <button onClick={() => alert('soon')}>Continue with Google</button>; }`;
const GOOGLE_REAL = `import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
export function Welcome() { return <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>Continue with Google</button>; }`;

const FAKE_PAY = `export function Checkout({ total }) { const [paid, setPaid] = useState(false);
  const handlePay = () => { setTimeout(() => setPaid(true), 1500); };
  return <div><p>Total ₹{total}</p><button onClick={handlePay}>Pay Now</button>{paid && <p>Payment successful</p>}</div>; }`;
const RAZORPAY_PAY = `export function Checkout({ order }) { const handlePay = () => { const rzp = new window.Razorpay({ order_id: order.id }); rzp.open(); };
  return <button onClick={handlePay}>Pay Now</button>; }`;
const EXPENSE_MARK_PAID = `export function Bills({ bills, update }) { const markPaid = (id) => update(id, { paid: true });
  return bills.map((b) => <button onClick={() => markPaid(b.id)}>Mark as paid</button>); }`;

const FAKE_OTP = `export function Verify({ phone }) { const otp = String(Math.floor(100000 + Math.random() * 900000));
  return <p>Your OTP is {otp}</p>; }`;
const TWILIO_SERVER = `import twilio from 'twilio'; export const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);`;

const FAKE_EMAIL = `export function Contact() { const send = () => toast('Email sent! We will reply soon.'); return <button onClick={send}>Send</button>; }`;
const REAL_EMAIL_SERVER = `import nodemailer from 'nodemailer'; export const transport = nodemailer.createTransport({});`;
const CHAT_SENT = `export function Chat() { const send = () => setStatus('Message sent'); return <button onClick={send}>Send</button>; }`;

const kinds = (files: Record<string, string>, prompt = '') => findFakeFeatures(files, prompt).map((f) => f.kind).sort();

describe('🔴 the shape-reader: a feature that only pretends, with no provider anywhere in the project', () => {
  it('a login that checks a password written into the app is a fake login, and implies a REAL login', () => {
    const hits = findFakeFeatures({ 'src/pages/LoginPage.tsx': DEMO_LOGIN });
    expect(hits.map((h) => h.kind)).toEqual(['login']);
    expect(hits[0].requirementId).toBe('login');
    expect(hits[0].file).toBe('src/pages/LoginPage.tsx');
    expect(hits[0].line).toBeGreaterThan(0);
  });

  it('the hashed demo account of autopsy 70e030bb is read too', () => {
    expect(kinds({ 'src/auth.tsx': HASHED_DEMO_LOGIN })).toEqual(['login']);
  });

  it('the SAME login page is real when a provider lives anywhere in the project — even another file', () => {
    expect(kinds({ 'src/pages/LoginPage.tsx': DEMO_LOGIN, 'src/lib/supabase.ts': "import { createClient } from '@supabase/supabase-js'; export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);" })).toEqual([]);
    expect(kinds({ 'src/pages/LoginPage.tsx': SUPABASE_LOGIN })).toEqual([]);
    expect(kinds({ 'src/pages/LoginPage.tsx': DEMO_LOGIN, 'server/routes/auth.ts': "app.post('/api/login', async (req, res) => { const ok = await bcrypt.compare(req.body.password, user.hash); });" })).toEqual([]);
  });

  it('a PIN lock on a personal app is not a login', () => {
    expect(kinds({ 'src/PinLock.tsx': PIN_LOCK })).toEqual([]);
  });

  it('"Continue with Google" with nothing behind it is a fake button; with an OAuth SDK it is real', () => {
    const hits = findFakeFeatures({ 'src/Welcome.tsx': GOOGLE_BUTTON });
    expect(hits.map((h) => h.kind)).toEqual(['oauth-button']);
    expect(hits[0].requirementId).toBe('login');
    expect(kinds({ 'src/Welcome.tsx': GOOGLE_REAL })).toEqual([]);
  });

  it('a payment that marks itself paid is a fake payment; a gateway anywhere makes it real; "mark as paid" is bookkeeping', () => {
    const hits = findFakeFeatures({ 'src/Checkout.tsx': FAKE_PAY });
    expect(hits.map((h) => h.kind)).toEqual(['payment']);
    expect(hits[0].requirementId).toBe('payments_razorpay');
    expect(kinds({ 'src/Checkout.tsx': RAZORPAY_PAY })).toEqual([]);
    expect(kinds({ 'src/Checkout.tsx': FAKE_PAY, 'server/pay.ts': "app.post('/api/payment/verify', verifySignature);" })).toEqual([]);
    expect(kinds({ 'src/Bills.tsx': EXPENSE_MARK_PAID })).toEqual([]);
  });

  it('an OTP the page makes up is a fake OTP; an SMS provider anywhere makes it real', () => {
    const hits = findFakeFeatures({ 'src/Verify.tsx': FAKE_OTP });
    expect(hits.map((h) => h.kind)).toEqual(['otp']);
    expect(hits[0].requirementId).toBe('sms');
    expect(kinds({ 'src/Verify.tsx': FAKE_OTP, 'server/sms.ts': TWILIO_SERVER })).toEqual([]);
  });

  it('"Email sent" with no transport is a fake email; a chat\'s "Message sent" is not an email', () => {
    const hits = findFakeFeatures({ 'src/Contact.tsx': FAKE_EMAIL });
    expect(hits.map((h) => h.kind)).toEqual(['email']);
    expect(hits[0].requirementId).toBe('email_api');
    expect(kinds({ 'src/Contact.tsx': FAKE_EMAIL, 'server/mail.ts': REAL_EMAIL_SERVER })).toEqual([]);
    expect(kinds({ 'src/Contact.tsx': FAKE_EMAIL.replace("toast('Email sent! We will reply soon.')", "window.location.href = 'mailto:hi@shop.in'") })).toEqual([]);
    expect(kinds({ 'src/Chat.tsx': CHAT_SENT })).toEqual([]);
  });

  it('a request that ASKED for the local thing stands the rule down — and only that rule', () => {
    const app = { 'src/pages/LoginPage.tsx': DEMO_LOGIN, 'src/Checkout.tsx': FAKE_PAY };
    expect(kinds(app)).toEqual(['login', 'payment']);
    expect(kinds(app, 'a shop with a simple demo login, no backend')).toEqual(['payment']);
    expect(kinds(app, 'shop app, cash on delivery only')).toEqual(['login']);
    expect(kinds(app, 'make a demo app of a shop')).toEqual([]);
    expect(kinds({ 'src/pages/LoginPage.tsx': DEMO_LOGIN }, 'diary app with a pin lock')).toEqual([]);
  });

  it('a comment, a test file and our own on-screen line are never the app\'s fake', () => {
    expect(kinds({ 'src/a.tsx': "// password === 'x' would be a fake login\nexport const a = 1;" })).toEqual([]);
    expect(kinds({ 'src/Login.test.tsx': DEMO_LOGIN })).toEqual([]);
    const html = withHonestyBanner('<html><body><div id="root"></div></body></html>', findFakeFeatures({ 'src/L.tsx': DEMO_LOGIN }), 'hi')!;
    expect(kinds({ 'index.html': html })).toEqual([]);
  });

  it('one finding per kind per file, capped', () => {
    const twice = `${DEMO_LOGIN}\nconst other = password === 'admin123';`;
    expect(findFakeFeatures({ 'src/L.tsx': twice })).toHaveLength(1);
    expect(findFakeFeatures({})).toEqual([]);
    expect(findFakeFeatures({ 'src/x.tsx': '' })).toEqual([]);
  });
});

describe('🔒 our own templates pass our own gate', () => {
  it('no golden scaffold ships a fake login, payment, OTP or email', () => {
    expect(GOLDEN_SCAFFOLDS.length).toBeGreaterThan(10);
    for (const s of GOLDEN_SCAFFOLDS) {
      const files = goldenScaffoldFiles(s);
      expect(Object.keys(files).length, s.id).toBeGreaterThan(0);
      expect(findFakeFeatures(files), `${s.id} carries a fake feature`).toEqual([]);
    }
    // The canary: the reader is not silently returning [] for everything.
    expect(findFakeFeatures({ 'src/L.tsx': DEMO_LOGIN })).toHaveLength(1);
  });
});

describe('🗣️ the chat line: in the user\'s language, the key names, both paths', () => {
  const hits = findFakeFeatures({ 'src/pages/LoginPage.tsx': DEMO_LOGIN, 'src/Checkout.tsx': FAKE_PAY });

  it('Hindi names the demo, the file, the exact keys and where to paste them', () => {
    const text = fakeFeatureNotice(hits, 'hi');
    expect(text).toContain('🔴');
    expect(text).toContain('DEMO');
    expect(text).toContain('src/pages/LoginPage.tsx');
    expect(text).toContain('VITE_SUPABASE_URL');
    expect(text).toContain('VITE_SUPABASE_ANON_KEY');
    expect(text).toContain('RAZORPAY_KEY_ID');
    expect(text).toContain('⋮ More → Keys & Secrets');
    expect(text).toContain('Settings → App Settings → Secrets & API Keys');
    expect(text).toContain('असली');
  });

  it('English is the fallback, and nothing is said when nothing is fake', () => {
    expect(fakeFeatureNotice(hits, null)).toContain('is a DEMO — it is not real');
    expect(fakeFeatureNotice(hits, 'xx')).toContain('is a DEMO');
    expect(fakeFeatureNotice([], 'hi')).toBe('');
  });

  it('every language in the table says DEMO, the keys and the phone path', () => {
    for (const lang of ['hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar']) {
      const text = fakeFeatureNotice(hits, lang);
      expect(text, lang).toContain('DEMO');
      expect(text, lang).toContain('VITE_SUPABASE_URL');
      expect(text, lang).toContain(KEYS_PATH_PHONE);
    }
  });
});

describe('🔑 the key ask fires for a fake — the half that never fired before', () => {
  const hits = findFakeFeatures({ 'src/pages/LoginPage.tsx': DEMO_LOGIN });

  it('a fake login implies the REAL login requirement with Supabase Auth\'s two keys', () => {
    const implied = impliedRequirementsFor(hits);
    expect(implied.map((r) => r.id)).toEqual(['login']);
    expect(implied[0].implied).toBe(true);
    expect(implied[0].matchedEnvVars).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(implied[0].settingsPath).toContain('Authentication');
    expect(keysForFinding(hits[0])).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
  });

  it('the closing ask card asks for exactly those keys, in the demo wording, and not once a key is saved', () => {
    const implied = impliedRequirementsFor(hits);
    const missing = unconfiguredRequirements(implied, {});
    const asks = postBuildKeyAsks(missing, []);
    expect(asks.map((a) => a.name)).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(asks[0].why).toContain('demo until this key is added');
    expect(unconfiguredRequirements(implied, { VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual([]);
    expect(unconfiguredRequirements(implied, { VITE_FIREBASE_API_KEY: 'AIza' })).toEqual([]);
    expect(unconfiguredRequirements(implied, { CLERK_SECRET_KEY: 'sk_test_x' })).toEqual([]);
  });

  it('the key checklist lists it with the one-tap route, and the detector never finds "login" from code', () => {
    const notice = appRequirementsNotice(unconfiguredRequirements(impliedRequirementsFor(hits), {}), 'hi');
    expect(notice).toContain('VITE_SUPABASE_URL');
    expect(notice).toContain('Authentication');
    // An app that READS Supabase keys is a database app, never also a "login" requirement.
    const found = detectAppRequirements({ files: { 'src/lib/db.ts': 'const u = import.meta.env.VITE_SUPABASE_URL;' } });
    expect(found.map((r) => r.id)).toEqual(['database_hosted']);
  });

  it('one implied entry per service, however many fakes', () => {
    const many = findFakeFeatures({ 'src/L.tsx': DEMO_LOGIN, 'src/W.tsx': GOOGLE_BUTTON, 'src/C.tsx': FAKE_PAY, 'src/V.tsx': FAKE_OTP, 'src/E.tsx': FAKE_EMAIL });
    expect(impliedRequirementsFor(many).map((r) => r.id)).toEqual(['login', 'payments_razorpay', 'sms', 'email_api']);
  });
});

describe('🟥 the red line on the app\'s own screen (index.html)', () => {
  const hits = findFakeFeatures({ 'src/pages/LoginPage.tsx': DEMO_LOGIN });
  const page = '<!doctype html>\n<html>\n  <head><title>Shop</title></head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n';

  it('is injected before </body>, red, in the user\'s language, dismissible with a 36px thumb target', () => {
    const html = withHonestyBanner(page, hits, 'hi')!;
    expect(hasHonestyBanner(html)).toBe(true);
    expect(html.indexOf('nbai-honesty')).toBeLessThan(html.indexOf('</body>'));
    expect(html).toContain('#b91c1c');
    expect(html).toContain('"lang","hi"');
    expect(html).toContain('असली नहीं');
    expect(html).toContain('VITE_SUPABASE_URL');
    expect(html).toContain('Keys & Secrets');
    expect(html).toContain('width:36px;height:36px');
    expect(html).toContain('role","alert');
  });

  it('is idempotent: a second build replaces the block, and a clean build removes it', () => {
    const once = withHonestyBanner(page, hits, 'hi')!;
    const twice = withHonestyBanner(once, hits, 'hi')!;
    expect(twice).toBe(once);
    expect(twice.split('nbai-honesty -->').length).toBe(3); // one open, one close
    const gone = withHonestyBanner(twice, [], 'hi')!;
    expect(hasHonestyBanner(gone)).toBe(false);
    expect(gone).toBe(page);
    // A language change rewrites the text.
    expect(withHonestyBanner(once, hits, null)).toContain('DEMO — not real');
  });

  it('survives the readiness scan: the line carries no word scanAuthenticity reads as a stub', () => {
    const html = withHonestyBanner(page, hits, 'hi')!;
    const issues = scanAuthenticity('index.html', html);
    expect(issues.filter((i) => i.severity === 'high')).toEqual([]);
    expect(issues.filter((i) => i.kind === 'simulated-result' || i.kind === 'simulated-data')).toEqual([]);
  });

  it('the injected script is valid JavaScript and names both paths (a generated script is code nobody parses otherwise)', () => {
    const html = withHonestyBanner(page, hits, 'hi')!;
    const body = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
    expect(() => new Function(body)).not.toThrow(); // compiles; never executed here
    expect(html).toContain('Settings → App Settings → Secrets & API Keys');
  });

  it('a page without <body> gets the block appended; null stays null', () => {
    expect(withHonestyBanner('<div></div>', hits, 'en')).toContain('nbai-honesty');
    expect(withHonestyBanner(null, hits, 'en')).toBeNull();
    expect(honestyBannerLines(hits, 'en')[0]).toContain('DEMO — not real');
  });
});

describe('✍️ the builder hears it with the file open, and every lane carries the rule', () => {
  it('the write-time note names the shape, the real path and the red line; silent on a clean file', () => {
    const note = fakeFeatureWriteNote('src/pages/LoginPage.tsx', DEMO_LOGIN);
    expect(note).toContain('NO FAKE BUTTON');
    expect(note).toContain('src/pages/LoginPage.tsx');
    expect(note).toContain('request_secrets');
    expect(note).toContain(KEYS_PATH_PHONE);
    expect(fakeFeatureWriteNote('src/pages/LoginPage.tsx', SUPABASE_LOGIN)).toBe('');
    expect(fakeFeatureWriteNote('src/x.ts', '')).toBe('');
  });

  it('the rule is in the shared module and in all THREE lanes (architect, fast lane, one-shot)', () => {
    expect(NO_FAKE_FEATURE_RULE).toContain('NO FAKE BUTTON');
    expect(NO_FAKE_FEATURE_RULE).toContain('Keys & Secrets');
    expect(NO_FAKE_FEATURE_RULE).toContain('RED line');
    expect(SEED_PASSWORD_RULE).toContain('never the app\'s LOGIN');
    for (const f of ['src/server/AgentV3/systemPrompt.ts', 'src/server/AgentV3/SimpleBuilder.ts', 'src/server/AgentV3/OneShotBuilder.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/^\s*NO_FAKE_FEATURE_RULE,\s*$/m);
    }
  });

  it('the route puts the line on screen, discloses, asks for the key; the dispatcher notes it at write time', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    for (const call of ['findFakeFeatures(', 'withHonestyBanner(', 'fakeFeatureNotice(', 'impliedRequirementsFor(', "code: 'FAKE_FEATURE_SHIPPED'"]) {
      expect(route, call).toContain(call);
    }
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toContain('fakeFeatureWriteNote(p, files[p])');
    expect(readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8')).toContain("code: 'FAKE_FEATURE_SHIPPED'");
  });

  it('AGENTV3_NO_FAKE_FEATURES reads off in any case, on otherwise', () => {
    expect(noFakeFeaturesEnabled({})).toBe(true);
    expect(noFakeFeaturesEnabled({ AGENTV3_NO_FAKE_FEATURES: ' OFF ' })).toBe(false);
    expect(noFakeFeaturesEnabled({ AGENTV3_NO_FAKE_FEATURES: 'on' })).toBe(true);
  });
});

// ── THE SIBLINGS (admin: "sath kill the siblings") ──────────────────────────────────────────────────
describe('🧬 siblings: the same fake from every other door', () => {
  it('a sign-up that keeps its accounts in the browser is the fake login from the other door', () => {
    const signup = `export function Register() { const submit = () => { const users = JSON.parse(localStorage.getItem('users') || '[]'); users.push({ email, password }); localStorage.setItem('users', JSON.stringify(users)); };
      return <form onSubmit={submit}><h2>Create account</h2><input type="password" /><button>Sign up</button></form>; }`;
    const hits = findFakeFeatures({ 'src/Register.tsx': signup });
    expect(hits.map((h) => h.kind)).toEqual(['login']);
    expect(kinds({ 'src/Register.tsx': signup, 'src/lib/auth.ts': "import { getAuth } from 'firebase/auth';" })).toEqual([]);
  });

  it('"reset link sent", "SMS sent" and "uploaded to the cloud" with nothing behind them are fakes; local saves are not', () => {
    expect(kinds({ 'src/Forgot.tsx': "export const Forgot = () => <button onClick={() => setMsg('Reset link sent to your email')}>Send</button>;" })).toEqual(['email']);
    const sms = findFakeFeatures({ 'src/Notify.tsx': "export const Notify = () => <button onClick={() => toast('SMS sent to your mobile')}>Send</button>;" });
    expect(sms.map((h) => `${h.kind}:${h.requirementId}`)).toEqual(['sms:sms']);
    const up = findFakeFeatures({ 'src/Photos.tsx': "export const Photos = () => <button onClick={() => { setPhotos([...photos, file]); toast('Uploaded to the cloud'); }}>Upload</button>;" });
    expect(up.map((h) => `${h.kind}:${h.requirementId}`)).toEqual(['upload:storage']);
    expect(impliedRequirementsFor(up).map((r) => r.id)).toEqual(['storage']);
    // Real transports stand it down; a local gallery's "upload complete" is not a cloud claim.
    expect(kinds({ 'src/Photos.tsx': "const fd = new FormData(); fd.append('f', file); await fetch('/api/upload', { method: 'POST', body: fd }); toast('Uploaded to the cloud');" })).toEqual([]);
    expect(kinds({ 'src/Photos.tsx': "export const Photos = () => <button onClick={() => { save(file); toast('Upload complete'); }}>Upload</button>;" })).toEqual([]);
    expect(kinds({ 'src/Notify.tsx': "toast('SMS sent to your mobile')", 'server/sms.ts': TWILIO_SERVER })).toEqual([]);
  });

  it('the server-built in-browser preview carries the red line (its shell does not reuse the app\'s <body>)', () => {
    const hits = findFakeFeatures({ 'src/pages/LoginPage.tsx': DEMO_LOGIN });
    const index = withHonestyBanner('<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>', hits, 'hi')!;
    const app = {
      'index.html': index,
      'package.json': JSON.stringify({ dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } }),
      'src/main.tsx': "import { createRoot } from 'react-dom/client'; import App from './App'; createRoot(document.getElementById('root')!).render(<App />);",
      'src/App.tsx': "export default function App(){ return <p>hi</p>; }",
    };
    const server = buildReactPreview(VirtualFileSystem.fromRecord(app));
    expect(server).toContain('nbai-honesty');
    expect(server).toContain('#b91c1c');
    // The client renderer reuses the app's <body>, so the block rides along by construction — asserted anyway.
    const client = buildSourceAppPreview(app as never);
    expect(client).toContain('nbai-honesty');
    // A clean app gets nothing from either.
    const clean = { ...app, 'index.html': stripHonestyBanner(index) };
    expect(buildReactPreview(VirtualFileSystem.fromRecord(clean))).not.toContain('nbai-honesty');
    expect(extractHonestyBanner(index)).toContain(HONESTY_MARK);
    expect(extractHonestyBanner('<html></html>')).toBe('');
  });

  it('a summary that sells the demo as working is corrected; one that admits the demo is not', () => {
    const facts = { consoleCaptured: false, screenshotTaken: false, previewVerified: false } as const;
    const sold = auditSummaryClaims('✅ Login with Google is implemented\nPayments are integrated with checkout.', { ...facts, fakeFeatures: ['oauth-button', 'payment'] });
    expect(sold.map((c) => c.kind)).toEqual(['feature-claimed-but-demo', 'feature-claimed-but-demo']);
    expect(claimCorrection(sold)).toContain('demo until the real provider');
    expect(auditSummaryClaims('Login is a demo until you add a key.', { ...facts, fakeFeatures: ['login'] })).toEqual([]);
    expect(auditSummaryClaims('✅ Login with Google is implemented', { ...facts })).toEqual([]);
    expect(auditSummaryClaims('✅ Login with Google is implemented', { ...facts, fakeFeatures: ['payment'] })).toEqual([]);
  });

  it('the feature-presence heal and the completion heal carry the rule, and so does every writing specialist', () => {
    const heal = featurePresenceRepairPrompt({ probes: [], missing: ['Login / authentication'], present: [] });
    expect(heal).toContain('NO FAKE BUTTON');
    expect(authenticityRepairInstruction([{ file: 'src/a.tsx', line: 1, kind: 'coming-soon', severity: 'high', snippet: 'Login coming soon' }])).toContain('RED line');
    expect(readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8')).toMatch(/NO_FAKED_RESULT_RULE\}\\n\$\{NO_FAKE_FEATURE_RULE\}/);
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('fakeFeatures: fakeFeatures.map((f) => f.kind)');
  });
});
