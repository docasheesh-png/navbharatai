import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';
import { LOCAL_LOGIN_LIMITS, provenLocalLoginPath } from '../src/server/AgentV3/localLoginPath';
import { LOCAL_LOGIN_NOTICE } from '../src/server/AgentV3/localLoginNotice';
import {
  findFakeFeatures, fakeFeatureNotice, fakeFeatureReportLine, honestyBannerLines,
  impliedRequirementsFor, keysForFinding, withHonestyBanner, fakeFeatureWriteNote,
} from '../src/server/AgentV3/fakeFeatureScan';

const PROVIDER = "import { createClient } from '@supabase/supabase-js'; export const supabase = createClient(url, key);";
const LOCAL_LOGIN = `import { useState } from 'react';
const DEMO_USER = { email: 'demo@example.test', password: 'demo123' };
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const submit = (event) => { event.preventDefault();
    if (email === DEMO_USER.email && password === DEMO_USER.password) {
      localStorage.setItem('token', 'ok');
      setIsAuthenticated(true);
    }
  };
  return isAuthenticated ? <main>Signed in</main> : <form onSubmit={submit}>
    <input value={email} onChange={(e) => setEmail(e.target.value)} />
    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <button>Login</button>
  </form>;
}`;
const scan = (source = LOCAL_LOGIN, prompt = '') => findFakeFeatures({
  'src/Login.tsx': source, 'src/lib/supabase.ts': PROVIDER,
}, prompt);

// Current sibling evidence only. These fixtures are not a reconstruction of a historical build.
describe('a provider import cannot erase a proven local credential-to-success path', () => {
  it('keeps a local credential/token/auth-state path visible beside a disconnected provider', () => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'login', file: 'src/Login.tsx', evidence: 'local-login-path' });
    expect(hits[0].snippet).toContain('password === DEMO_USER.password');
    expect(hits[0].line).toBe(8);
  });

  it('does not confuse a genuine sibling register handler with this login handler', () => {
    const mixed = LOCAL_LOGIN.replace('  const submit =', `  const register = async () => {
      await supabase.auth.signUp({ email, password });
    };
  const submit =`);
    expect(scan(mixed).map((f) => f.kind)).toEqual(['login']);
  });

  it('handles a fixed literal comparison and sessionStorage without depending on names of demo accounts', () => {
    const source = LOCAL_LOGIN.replace('password === DEMO_USER.password', "password === 'fixed-pass'")
      .replace('localStorage', 'sessionStorage');
    expect(scan(source).map((f) => f.kind)).toEqual(['login']);
  });

  it.each([
    ['awaited provider before the local branch', "await supabase.auth.signInWithPassword({ email, password });"],
    ['context-backed authentication before the local branch', 'await signIn(email, password);'],
    ['opaque callback before the local branch', 'onLogin();'],
  ])('stands down for %s', (_name, before) => {
    const source = LOCAL_LOGIN.replace('const submit = (event) => {', `const submit = async (event) => { ${before}`);
    expect(scan(source)).toEqual([]);
  });

  it('stands down when the credential check precedes genuine provider auth before session success', () => {
    const source = LOCAL_LOGIN.replace('const submit = (event) => {', 'const submit = async (event) => {')
      .replace("localStorage.setItem('token', 'ok');", "await supabase.auth.signInWithPassword({ email, password }); localStorage.setItem('token', 'ok');");
    expect(scan(source)).toEqual([]);
  });

  it('stands down for an opaque onLogin callback, including one bound to real OAuth in a parent', () => {
    const opaque = LOCAL_LOGIN.replace('function LoginPage()', 'function LoginPage({ onLogin })')
      .replace('setIsAuthenticated(true);', 'onLogin();');
    expect(scan(opaque)).toEqual([]);
    expect(findFakeFeatures({
      'src/Login.tsx': opaque,
      'src/App.tsx': `import LoginPage from './Login'; import { supabase } from './lib/supabase';
export default function App() { return <LoginPage onLogin={() => supabase.auth.signInWithOAuth({ provider: 'google' })} />; }`,
      'src/lib/supabase.ts': PROVIDER,
    })).toEqual([]);
  });

  it('does not label an ordinary context/provider-backed login as local authentication', () => {
    const source = LOCAL_LOGIN.replace('const submit = (event) => {', 'const submit = async (event) => {')
      .replace("if (email === DEMO_USER.email && password === DEMO_USER.password)", 'if (await signIn(email, password))')
      .replace("localStorage.setItem('token', 'ok');", "localStorage.setItem('token', session.access_token);");
    expect(findFakeFeatures({ 'src/Login.tsx': source,
      'src/AuthContext.tsx': `import { supabase } from './supabase'; export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });`,
    })).toEqual([]);
  });

  it.each(['a shop with demo login', 'a shop with offline login', 'make a demo app',
    'a diary with a PIN lock', 'a password vault app'])('preserves the explicit local exemption: %s', (prompt) => {
    expect(scan(LOCAL_LOGIN, prompt)).toEqual([]);
  });

  it('does not label a personal PIN unlock as account authentication', () => {
    const pin = LOCAL_LOGIN.replaceAll('password', 'pin').replaceAll('Password', 'Pin')
      .replaceAll('isAuthenticated', 'isUnlocked').replaceAll('IsAuthenticated', 'IsUnlocked')
      .replace('Signed in', 'Unlocked').replace('>Login<', '>Unlock<');
    expect(scan(pin)).toEqual([]);
  });

  it.each([
    ['unused handler', 'onSubmit={submit}', 'onSubmit={signIn}'],
    ['unknown state setter', 'setIsAuthenticated(true);', 'setSession(true);'],
    ['network token value', "'token', 'ok'", "'token', session.access_token"],
    ['conditional provider branch', "localStorage.setItem('token', 'ok');", "if (connected) return signIn(); localStorage.setItem('token', 'ok');"],
    ['unknown follow-on auth call', 'setIsAuthenticated(true);', 'setIsAuthenticated(true); onLogin();'],
    ['non-auth preference storage', "'token', 'ok'", "'theme', 'dark'"],
    ['password confirmation, not a fixed credential', 'password === DEMO_USER.password', 'password === confirmation'],
    ['mutable credential alias', "const DEMO_USER =", 'let DEMO_USER ='],
    ['success not asserted', '<main>Signed in</main>', '<main>Continue</main>'],
    ['unknown component in success view', '<main>Signed in</main>', '<AuthProvider>Signed in</AuthProvider>'],
    ['custom hook shadow', 'function LoginPage()', 'function LoginPage({ useState })'],
    ['overridden browser storage', 'function LoginPage()', 'function LoginPage({ localStorage })'],
    ['mutated object credential', '  const submit =', "  DEMO_USER.password = loadedPassword; const submit ="],
    ['escaped object credential', '  const submit =', '  hydrateFromProvider(DEMO_USER); const submit ='],
    ['generator handler never executes', 'const submit = (event) => {', 'const submit = function* (event) {'],
    ['generator component never renders', 'default function LoginPage', 'default function* LoginPage'],
    ['function expression shadows browser storage', 'const submit = (event) => {', 'const submit = function localStorage(event) {'],
    ['named handler shadows password', 'const submit = (event) => {', 'const submit = function password(event) {'],
    ['named handler shadows auth setter', 'const submit = (event) => {', 'const submit = function setIsAuthenticated(event) {'],
    ['class shadows storage', '  const submit =', '  class localStorage { static setItem() { signIn(); } } const submit ='],
    ['namespace shadows storage', 'const DEMO_USER =', 'namespace localStorage { export const setItem = signIn; } const DEMO_USER ='],
    ['import equals shadows storage', 'const DEMO_USER =', "import localStorage = require('./authStorage'); const DEMO_USER ="],
    ['render-time auth expression', '<button>Login</button>', '{signIn()}<button>Login</button>'],
    ['nested real submit route', '<button>Login</button>', '<form onSubmit={signIn}><button>Login</button></form>'],
    ['source-visible browser storage mutation', '  const submit =', '  localStorage.setItem = signIn; const submit ='],
    ['browser storage escapes', '  const submit =', '  configureStorage(localStorage); const submit ='],
    ['contradictory credential checks', 'password === DEMO_USER.password', "password === DEMO_USER.password && password === 'other-password'"],
    ['duplicate credential properties', "password: 'demo123'", "password: 'demo123', password: 'different'"],
    ['escaped duplicate credential properties', "password: 'demo123'", "password: 'demo123', p\\u0061ssword: 'different'"],
    ['credential contains a line break stripped by text controls', "password: 'demo123'", "password: 'demo\\n123'"],
    ['render-time early return hides success', '  return isAuthenticated', '  if (isAuthenticated) return null; return isAuthenticated'],
    ['eager provider authentication in renderer', '  const submit =', '  const session = signIn(); const submit ='],
    ['eager binding default performs auth', '  const submit =', '  const { authenticated = signIn() } = {}; const submit ='],
    ['unvalidated array binding default', '  const submit =', '  const [authenticated = signIn()] = []; const submit ='],
    ['declaration after the return', '  </form>;\n}', '  </form>; const unreachable = signIn();\n}'],
    ['hidden success label', '<main>Signed in</main>', '<main hidden>Signed in</main>'],
    ['inert success template', '<main>Signed in</main>', '<template>Signed in</template>'],
    ['module prototype replacement', 'const DEMO_USER =', 'Storage.prototype.setItem = signIn; const DEMO_USER ='],
    ['computed module storage replacement', 'const DEMO_USER =', "window['localStorage'].setItem = signIn; const DEMO_USER ="],
    ['global storage definition replacement', 'const DEMO_USER =', "Object.defineProperty(globalThis, 'localStorage', { value: { setItem: signIn } }); const DEMO_USER ="],
    ['module initializer performs auth', 'const DEMO_USER =', 'const session = signIn(); const DEMO_USER ='],
    ['missing email writer', '<input value={email} onChange={(e) => setEmail(e.target.value)} />', ''],
    ['disabled password writer', '<input type="password"', '<input disabled type="password"'],
    ['read-only password writer', '<input type="password"', '<input readOnly type="password"'],
    ['disabled ancestor fieldset', '<input value={email} onChange={(e) => setEmail(e.target.value)} />', '<fieldset disabled><input value={email} onChange={(e) => setEmail(e.target.value)} /></fieldset>'],
    ['native pattern constraint', '<input type="password"', '<input pattern="never-matches-demo-pass" type="password"'],
    ['native length constraint', '<input type="password"', '<input minLength="99" type="password"'],
    ['native email validation is outside the proof', '<input value={email}', '<input type="email" value={email}'],
    ['unrelated native required control', '<button>Login</button>', '<input required /><button>Login</button>'],
    ['no submit control', '<button>Login</button>', '<button type="button">Login</button>'],
    ['duplicate type attributes', '<input value={email}', '<input type="text" type="email" value={email}'],
    ['case-variant native validation type', '<input value={email}', '<input TYPE="email" value={email}'],
    ['case-variant readonly control', '<input type="password"', '<input readonly="true" type="password"'],
    ['submit reassociated with another form', '<button>Login</button>', '<button form="provider-form">Login</button>'],
    ['password field updates a different state', 'setPassword(e.target.value)', 'setEmail(e.target.value)'],
    ['opaque custom element', '<button>Login</button>', '<auth-login></auth-login><button>Login</button>'],
    ['customized built-in form', '<form onSubmit', '<form is="auth-form" onSubmit'],
    ['embedded auth document', '<button>Login</button>', '<iframe src="/auth"></iframe><button>Login</button>'],
    ['executable script element', '<button>Login</button>', '<script src="/auth.js"></script><button>Login</button>'],
    ['network-capable input', '<button>Login</button>', '<input type="image" src="/auth" /><button>Login</button>'],
    ['negative success label', '<main>Signed in</main>', '<main>Not signed in</main>'],
    ['success exists only in an attribute', '<main>Signed in</main>', '<main title="Signed in">Please sign in</main>'],
    ['input callback performs real auth first', 'setPassword(e.target.value)', '{ signIn(e.target.value); setPassword(e.target.value); }'],
    ['default handler parameter', 'const submit = (event) => {', 'const submit = (event = signIn()) => {'],
    ['extra handler parameter', 'const submit = (event) => {', 'const submit = (event, user = signIn()) => {'],
    ['type-only hook import', 'import { useState }', 'import type { useState }'],
    ['duplicated submit handler', 'onSubmit={submit}', 'onSubmit={submit} onSubmit={realSignIn}'],
    ['button-level provider auth', '<button>Login', '<button onClick={realSignIn}>Login'],
    ['server form action', '<form onSubmit', '<form action="/api/login" onSubmit'],
    ['imported storage override', "import { useState } from 'react';", "import { useState } from 'react'; import { localStorage } from './auth';"],
  ])('stands down rather than guessing: %s', (_label, from, to) => {
    expect(scan(LOCAL_LOGIN.replace(from, to))).toEqual([]);
  });

  it('does not interpret the special object prototype key as a literal credential', () => {
    const source = LOCAL_LOGIN.replace("password: 'demo123'", "__proto__: 'demo123'")
      .replace('DEMO_USER.password', 'DEMO_USER.__proto__');
    expect(scan(source)).toEqual([]);
  });

  it('rejects malformed, oversized and excessively nested candidate sources', () => {
    expect(scan(LOCAL_LOGIN.replace('export default', 'export default !'))).toEqual([]);
    expect(scan(`${' '.repeat(70_000)}${LOCAL_LOGIN}`)).toEqual([]);
    expect(scan(`const deeplyNested = ${'('.repeat(300)}true${')'.repeat(300)};\n${LOCAL_LOGIN}`)).toEqual([]);
  });
});

describe('a proven mixed-provider finding asks for wiring, not invented missing credentials', () => {
  it('retains the login finding without implying extra provider keys', () => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    expect(keysForFinding(hits[0])).toEqual([]);
    expect(impliedRequirementsFor(hits)).toEqual([]);
    const notice = fakeFeatureNotice(hits, 'en');
    expect(notice).toContain('Connect this sign-in handler');
    expect(notice).not.toContain('VITE_SUPABASE');
    expect(notice).not.toContain('Once the key is saved');
    expect(fakeFeatureReportLine(hits)).not.toContain('no provider anywhere');
    expect(fakeFeatureReportLine(hits)).toContain('local sign-in');
    expect(honestyBannerLines(hits, 'en')[0]).toContain('Connect this sign-in handler');
    expect(withHonestyBanner('<body></body>', hits, 'en')).toContain('nbai-honesty');
  });

  it.each(['en', 'hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar', 'ur'])('has a key-free red disclosure in %s', (lang) => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    const notice = fakeFeatureNotice(hits, lang);
    expect(LOCAL_LOGIN_NOTICE[lang]).toBeTruthy();
    expect(notice).toContain(LOCAL_LOGIN_NOTICE[lang]);
    if (lang !== 'en') expect(LOCAL_LOGIN_NOTICE[lang]).not.toBe(LOCAL_LOGIN_NOTICE.en);
    expect(notice).toContain('🔴');
    expect(notice).toContain('src/Login.tsx');
    expect(notice).not.toContain('VITE_SUPABASE');
    expect(honestyBannerLines(hits, lang)[0]).toContain('⚠️');
    expect(withHonestyBanner('<body></body>', hits, lang)).toContain(`"lang","${lang}"`);
  });
});


describe('bounded analysis and independent finding consumers', () => {
  it('accepts inline submit handlers and a harmless event preventDefault', () => {
    const inline = LOCAL_LOGIN.replace('onSubmit={submit}', `onSubmit={(event) => { event.preventDefault();
      if (email === DEMO_USER.email && password === DEMO_USER.password) {
        localStorage.setItem('token', 'ok'); setIsAuthenticated(true);
      }
    }}`);
    expect(scan(inline)).toHaveLength(1);
    expect(scan(LOCAL_LOGIN)).toHaveLength(1);
    expect(scan(LOCAL_LOGIN.replace('event.preventDefault();', ''))).toEqual([]);
  });

  it('stands down on source, token, node, nesting and elapsed-time limits', () => {
    expect(provenLocalLoginPath('src/Login.tsx', ' '.repeat(LOCAL_LOGIN_LIMITS.chars) + LOCAL_LOGIN)).toBeNull();
    expect(provenLocalLoginPath('src/Login.tsx', ';'.repeat(LOCAL_LOGIN_LIMITS.tokens) + LOCAL_LOGIN)).toBeNull();
    expect(provenLocalLoginPath('src/Login.tsx', `const wide = ${Array(4_500).fill('x').join('+')};\n${LOCAL_LOGIN}`)).toBeNull();
    expect(provenLocalLoginPath('src/Login.tsx', `const deep = ${'('.repeat(LOCAL_LOGIN_LIMITS.nesting + 1)}true${')'.repeat(LOCAL_LOGIN_LIMITS.nesting + 1)};\n${LOCAL_LOGIN}`)).toBeNull();
    let time = 0;
    expect(provenLocalLoginPath('src/Login.tsx', LOCAL_LOGIN, () => time += LOCAL_LOGIN_LIMITS.milliseconds + 1)).toBeNull();
  });

  it('caps additional per-project AST attempts without changing non-auth scanning', () => {
    const files = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`src/Login${i}.tsx`,
      `const Login = ; localStorage.setItem('token', 'ok'); const password = '';`]));
    expect(findFakeFeatures({ ...files, 'src/LastLogin.tsx': LOCAL_LOGIN, 'src/provider.ts': PROVIDER })).toEqual([]);
  });

  it('keeps normal missing-key findings and mixed payment/email consumers unchanged', () => {
    const local = scan();
    const others = findFakeFeatures({
      'src/Checkout.tsx': `export function Checkout() { const handlePay = () => setPaid(true); return <button onClick={handlePay}>Pay now</button>; }`,
      'src/Mail.tsx': `export function Contact() { return <button onClick={() => alert('Email sent')}>Send</button>; }`,
    });
    expect(others.map((f) => f.kind)).toEqual(['payment', 'email']);
    const mixed = [...local, ...others];
    expect(impliedRequirementsFor(mixed)).toEqual(impliedRequirementsFor(others));
    expect(fakeFeatureNotice(mixed)).toContain('RAZORPAY_KEY_ID');
    expect(fakeFeatureNotice(mixed)).toContain('Connect this sign-in handler');
    expect(honestyBannerLines(mixed)).toHaveLength(3);
    expect(fakeFeatureReportLine(mixed)).toContain('payment only pretends');
    const withoutProvider = findFakeFeatures({ 'src/Login.tsx': LOCAL_LOGIN });
    expect(withoutProvider).toHaveLength(1);
    expect(withoutProvider[0].evidence).toBeUndefined();
    expect(keysForFinding(withoutProvider[0])).toContain('VITE_SUPABASE_URL');
    expect(impliedRequirementsFor([...local, ...withoutProvider])).toEqual(impliedRequirementsFor(withoutProvider));
  });

  it('gives the builder wiring advice without claiming a known provider is missing', () => {
    const note = fakeFeatureWriteNote('src/Login.tsx', `import { createClient } from '@supabase/supabase-js';\n${LOCAL_LOGIN}`);
    expect(note).toContain('Connect this sign-in handler');
    expect(note).not.toContain('request_secrets');
    expect(note).not.toContain('which key makes it real');
  });
});


describe('claim-audit preserves the precise local-path evidence', () => {
  const facts = { consoleCaptured: false, screenshotTaken: false, previewVerified: false } as const;
  it('corrects a working-login claim with wiring advice, without inventing missing keys', () => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    const result = auditSummaryClaims('Login is fully working and integrated.', {
      ...facts, fakeFeatures: hits.map((f) => f.kind), fakeFeatureEvidence: hits,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('feature-claimed-but-demo');
    expect(claimCorrection(result)).toContain('needs real authentication wiring');
    expect(claimCorrection(result)).not.toContain("provider's key is added");
    expect(claimCorrection(result)).not.toContain('red line');
  });

  it('preserves ordinary and mixed non-auth corrections and forwards evidence at the production callsite', () => {
    const local = scan();
    const result = auditSummaryClaims('Login is working.\nPayments are integrated.', {
      ...facts, fakeFeatures: ['login', 'payment'], fakeFeatureEvidence: local,
    });
    expect(result).toHaveLength(2);
    expect(result[0].measured).toContain('needs real authentication wiring');
    expect(result[1].measured).toContain("provider's key is added");
    expect(auditSummaryClaims('Login is working.', { ...facts, fakeFeatures: ['login'] })[0].measured)
      .toContain("provider's key is added");
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('fakeFeatures: fakeFeatures.map((f) => f.kind),\n          fakeFeatureEvidence: fakeFeatures,');
  });
});
