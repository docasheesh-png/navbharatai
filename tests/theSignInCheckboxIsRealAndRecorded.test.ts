// THE SIGN-IN CHECKBOX: "I am 18 years or older, and I agree to the Terms of Service and Privacy Policy"
// (admin 2026-10-21). Both documents bind a person "by creating an account", and Terms Section 1 requires 18+,
// yet the sign-in screen asked for neither. This suite holds what makes the box REAL rather than decorative:
//
//   1. ONE box carries both statements, with both links, each opening in a new tab / the phone's browser.
//   2. EVERY way in is behind it — the buttons are disabled while it is unticked AND every handler refuses
//      without it (the Enter key and any future path reach the handler, not the button). A census, so a NEW
//      sign-in method added to the screen without the gate fails here.
//   3. The evidence is held on the device, shape-checked, and posted once an account exists; the marker is
//      cleared ONLY on a real `{ ok: true }`.
//   4. The server stores the versions and its own clock, idempotently, and never touches other profile fields.
//   5. Nothing is recorded for a request that lacks the age confirmation.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PENDING_ACCEPTANCE_KEY, TERMS_URL, PRIVACY_URL, ACCEPTANCE_REFUSAL,
  isVersionLabel, buildPendingAcceptance, parsePendingAcceptance, holdAcceptance, heldAcceptance, clearHeldAcceptance,
  type MiniStorage,
} from '../src/lib/signupAcceptance';
import { parseAcceptanceRequest, nextAcceptance, recordTermsAcceptance } from '../src/server/lib/termsAcceptance';
import { LEGAL_META } from '../src/content/legal/meta';
import { TERMS_OF_SERVICE_UPDATED } from '../src/content/legal/termsOfService';
import { PRIVACY_POLICY_UPDATED } from '../src/content/legal/privacyPolicy';
import { braceBlock } from './helpers/sourceSlice';
import { captureRoutes, mockRes } from './helpers/routeTestUtils';

vi.mock('../src/server/lib/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/lib/authMiddleware')>();
  return {
    ...real,
    rateLimiter: () => (_req: any, _res: any, next: () => void) => next(),
    verifyFirebaseToken: async (req: any) => (req.headers?.authorization === 'Bearer good' ? 'u_route' : null),
  };
});

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments removed, so a prose mention never satisfies a code assertion. */
const code = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function memStorage(): MiniStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}

describe('1 — the pure half: what is held, and how it is read back', () => {
  it('a version label is the date the documents print — and nothing else', () => {
    for (const ok of ['21 October 2026', '5 October 2026', '8 August 2026']) expect(isVersionLabel(ok), ok).toBe(true);
    for (const bad of ['', 'latest', '2026-10-21', '21/10/2026', '21 oct 2026', 42, null, undefined, '21 October 2026; DROP']) expect(isVersionLabel(bad as unknown), String(bad)).toBe(false);
  });

  it('the versions the app sends are the documents\' own "last updated" labels (meta ↔ document held equal)', () => {
    const meta = (id: string) => LEGAL_META.find((m) => m.id === id)!.updated;
    expect(meta('legal_terms')).toBe(TERMS_OF_SERVICE_UPDATED);
    expect(meta('legal_privacy')).toBe(PRIVACY_POLICY_UPDATED);
    expect(isVersionLabel(meta('legal_terms'))).toBe(true);
    expect(isVersionLabel(meta('legal_privacy'))).toBe(true);
  });

  it('holds, reads back and clears a marker', () => {
    const s = memStorage();
    const p = buildPendingAcceptance('21 October 2026', '21 October 2026', 1234)!;
    expect(p).toEqual({ termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: true, at: 1234 });
    expect(holdAcceptance(s, p)).toBe(true);
    expect(s.map.has(PENDING_ACCEPTANCE_KEY)).toBe(true);
    expect(heldAcceptance(s)).toEqual(p);
    clearHeldAcceptance(s);
    expect(heldAcceptance(s)).toBeNull();
  });

  it('a damaged or hand-edited marker is NO marker — never a half-record posted to the server', () => {
    const s = memStorage();
    for (const raw of [
      'not json', '{}', '[]', 'null', '"x"',
      JSON.stringify({ termsVersion: 'whenever', privacyVersion: '21 October 2026', ageConfirmed: true, at: 1 }),
      JSON.stringify({ termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: false, at: 1 }),
      JSON.stringify({ termsVersion: '21 October 2026', privacyVersion: '21 October 2026', at: 1 }),
    ]) {
      s.map.set(PENDING_ACCEPTANCE_KEY, raw);
      expect(heldAcceptance(s), raw).toBeNull();
    }
  });

  it('refuses to build a marker from an unknown version, and survives a storage that throws', () => {
    expect(buildPendingAcceptance('', '21 October 2026', 1)).toBeNull();
    expect(holdAcceptance(null, null)).toBe(false);
    const broken: MiniStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(holdAcceptance(broken, buildPendingAcceptance('21 October 2026', '21 October 2026', 1))).toBe(false);
    expect(heldAcceptance(broken)).toBeNull();
    expect(() => clearHeldAcceptance(broken)).not.toThrow();
  });

  it('the two links are absolute https addresses on the real site (a relative one is https://localhost in the phone app)', () => {
    expect(TERMS_URL).toBe('https://navbharatai.com/terms');
    expect(PRIVACY_URL).toBe('https://navbharatai.com/privacy');
  });
});

describe('2 — the screen: one box, both statements, both links, every way in behind it', () => {
  const AUTH = read('src/components/AuthComponent.tsx');
  const AUTH_CODE = code(AUTH);

  it('there is exactly ONE checkbox, and its sentence states the age AND the agreement', () => {
    expect(AUTH_CODE.match(/type="checkbox"/g)?.length).toBe(1);
    expect(AUTH).toContain('I am 18 years or older, and I agree to the');
    expect(AUTH_CODE).toContain('Terms of Service');
    expect(AUTH_CODE).toContain('Privacy Policy');
  });

  it('both links open in a new tab and fall back to the phone\'s own browser, using the absolute addresses', () => {
    // Whole <a …>…</a> elements (a bare `>` inside the onClick arrow would end a naive tag match early).
    const anchors = (AUTH_CODE.match(/<a\b[\s\S]*?<\/a>/g) ?? []).filter((a) => /href=\{(?:TERMS_URL|PRIVACY_URL)\}/.test(a));
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
      expect(a).toMatch(/openExternalUrl\((TERMS_URL|PRIVACY_URL)\)/);
    }
  });

  it('it starts UNTICKED on every open — a remembered tick would be agreement nobody gave today', () => {
    expect(AUTH_CODE).toMatch(/const \[accepted, setAccepted\] = useState\(false\)/);
    expect(AUTH_CODE).not.toMatch(/localStorage\.getItem\([^)]*accept/i);
  });

  // The census: every function in the file that STARTS a sign-in or SENDS a sign-in code must pass the gate first.
  const START_SIGN_IN = /socialSignIn\(|signInWithEmailAndPassword\(|createUserWithEmailAndPassword\(|signInWithPhoneNumber\(|FirebaseAuthentication\.signInWithPhoneNumber|signInWithCustomToken\(|\.confirm\(/;
  const HANDLERS = ['handleSendOtp', 'handleVerifyOtp', 'handleSubmit', 'handleGoogleSignIn', 'handleAppleSignIn', 'handleGithubSignIn'];

  it.each(HANDLERS)('%s refuses without the box — the gate is the first thing it does that matters', (name) => {
    const body = braceBlock(AUTH, `const ${name} = async`);
    expect(body.length, `${name} not found`).toBeGreaterThan(50);
    expect(code(body)).toContain('requireAcceptance()');
  });

  it('🔒 NO OTHER FUNCTION STARTS A SIGN-IN: every one that does is on the gated list', () => {
    const blocks = [...AUTH.matchAll(/^  const ([A-Za-z]+) = async[^\n]*=> \{/gm)].map((m) => m[1]);
    const offenders: string[] = [];
    for (const name of blocks) {
      const body = code(braceBlock(AUTH, `const ${name} = async`));
      if (START_SIGN_IN.test(body) && !HANDLERS.includes(name)) offenders.push(name);
    }
    // finishNativePhoneSession / socialSignIn helpers run AFTER a gated handler; they are the second half of a flow
    // that already passed the gate, and are listed so a NEW first-half handler cannot hide among them.
    // linkGithubToExistingAccount runs only from handleGithubSignIn's account-exists branch (asserted below).
    const SECOND_HALVES = new Set(['finishNativePhoneSession', 'linkGithubToExistingAccount']);
    expect(offenders.filter((n) => !SECOND_HALVES.has(n))).toEqual([]);
  });

  it('the second-half helpers are reached ONLY from a gated handler', () => {
    const callers = (fn: string) => [...AUTH_CODE.matchAll(new RegExp(`${fn}\\(`, 'g'))].length;
    // one definition-less call site each: the call inside the gated handler (the definition is `const fn = async`)
    expect(braceBlock(AUTH, 'const handleGithubSignIn = async')).toContain('linkGithubToExistingAccount(');
    expect(callers('linkGithubToExistingAccount')).toBe(1);
  });

  it('every button that starts a sign-in is disabled while the box is unticked', () => {
    for (const handler of ['handleSendOtp', 'handleGoogleSignIn', 'handleAppleSignIn', 'handleGithubSignIn']) {
      const re = new RegExp(`onClick=\\{${handler}\\}[\\s\\S]{0,60}?disabled=\\{[^}]*!accepted[^}]*\\}`);
      expect(AUTH_CODE, handler).toMatch(re);
    }
    expect(AUTH_CODE).toMatch(/type="submit"[\s\S]{0,60}?disabled=\{[^}]*!accepted[^}]*\}/);
    // …and the "Send OTP" button appears in both layouts, both gated.
    expect(AUTH_CODE.match(/onClick=\{handleSendOtp\}[\s\S]{0,60}?disabled=\{[^}]*!accepted/g)?.length).toBe(2);
  });

  it('the refusal is in words, and it uses the shared sentence', () => {
    expect(ACCEPTANCE_REFUSAL).toMatch(/18 or older/);
    expect(ACCEPTANCE_REFUSAL).toMatch(/Terms of Service and Privacy Policy/);
    expect(AUTH_CODE).toContain('setError(ACCEPTANCE_REFUSAL)');
  });

  it('forgot-password is NOT gated (it signs nobody in), and uses no colour literal in the new block', () => {
    expect(code(braceBlock(AUTH, 'const handleForgotPassword = async'))).not.toContain('requireAcceptance');
    const box = AUTH.slice(AUTH.indexOf('THE ONE CHECKBOX'), AUTH.indexOf('<form onSubmit={handleSubmit}'));
    expect(box.length).toBeGreaterThan(200);
    expect(code(box)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|text-white|bg-white|\b(?:bg|text|border)-(?:red|green|blue|gray|slate|indigo|emerald)-\d{2,3}\b/);
  });

  it('the app records it as soon as an account exists', () => {
    const APP = code(read('src/App.tsx'));
    expect(APP).toMatch(/useRecordTermsAcceptance\(user\?\.uid \?\? null\)/);
    const hook = code(read('src/hooks/useRecordTermsAcceptance.ts'));
    expect(hook).toContain("'/api/profile/terms-acceptance'");
    // cleared ONLY on a real ok
    expect(hook).toMatch(/if \(res\.ok && body\?\.ok === true\) clearHeldAcceptance/);
    expect(hook.match(/clearHeldAcceptance\(/g)?.length).toBe(1);
  });
});

describe('the Privacy Policy tells people this record exists', () => {
  it('names what is recorded, and that it lives with the account', async () => {
    const { PRIVACY_POLICY } = await import('../src/content/legal/privacyPolicy');
    expect(PRIVACY_POLICY).toMatch(/Your agreement to our documents/);
    expect(PRIVACY_POLICY).toMatch(/confirmed it, which version of each document you agreed to, and when/);
    expect(PRIVACY_POLICY).toMatch(/kept with your account/);
  });
});

describe('3 — the server stores the versions and its own clock, idempotently', () => {
  it('accepts only the two version labels and the age confirmation — and nothing else is read', () => {
    const ok = parseAcceptanceRequest({ termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: true, isAdmin: true, userId: 'someone-else' });
    expect(ok).toEqual({ ok: true, value: { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' } });
  });

  it.each([
    ['no age confirmation', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' }],
    ['an age confirmation that is not literally true', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: 'yes' }],
    ['age false', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: false }],
    ['a bad Terms version', { termsVersion: 'v2', privacyVersion: '21 October 2026', ageConfirmed: true }],
    ['a bad Privacy version', { termsVersion: '21 October 2026', privacyVersion: '', ageConfirmed: true }],
    ['not an object', 'x'],
    ['nothing', undefined],
  ])('refuses %s', (_why, body) => {
    expect(parseAcceptanceRequest(body).ok).toBe(false);
  });

  it('records the server time, keeps the FIRST agreement time, and a repeat changes nothing', () => {
    const first = nextAcceptance(null, { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' }, '2026-10-21T10:00:00.000Z');
    expect(first).toEqual({ termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: true, acceptedAt: '2026-10-21T10:00:00.000Z', firstAcceptedAt: '2026-10-21T10:00:00.000Z' });
    const again = nextAcceptance(first, { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' }, '2026-10-22T10:00:00.000Z');
    expect(again).toEqual(first);
    const newer = nextAcceptance(first, { termsVersion: '3 December 2026', privacyVersion: '21 October 2026' }, '2026-12-03T10:00:00.000Z');
    expect(newer.termsVersion).toBe('3 December 2026');
    expect(newer.acceptedAt).toBe('2026-12-03T10:00:00.000Z');
    expect(newer.firstAcceptedAt).toBe('2026-10-21T10:00:00.000Z');
  });

  it('writes a MERGE onto the profile and never clobbers the display name or the +18 setting', async () => {
    const store = new Map<string, any>([['user_profiles/u1', { userId: 'u1', displayName: 'Asha', adultOptIn: true, bio: 'hi' }]]);
    const db = {
      doc: (path: string) => ({
        path,
        get: async () => ({ exists: store.has(path), data: () => ({ ...store.get(path) }), id: 'u1', ref: { path }, get: () => undefined }),
        set: async (data: any, opts?: { merge?: boolean }) => { store.set(path, opts?.merge ? { ...store.get(path), ...data } : { ...data }); },
      }),
    };
    expect(await recordTermsAcceptance(db, 'u1', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' }, '2026-10-21T10:00:00.000Z')).toBe(true);
    const p = store.get('user_profiles/u1');
    expect(p.displayName).toBe('Asha');
    expect(p.adultOptIn).toBe(true);
    expect(p.bio).toBe('hi');
    expect(p.termsAcceptance).toMatchObject({ termsVersion: '21 October 2026', ageConfirmed: true, acceptedAt: '2026-10-21T10:00:00.000Z' });
  });

  it('says false when the write fails — so the app keeps its marker and retries', async () => {
    const failing = { doc: () => ({ get: async () => ({ exists: () => false, data: () => ({}) }), set: async () => { throw new Error('down'); } }) };
    expect(await recordTermsAcceptance(failing, 'u1', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' })).toBe(false);
    expect(await recordTermsAcceptance(null, 'u1', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' })).toBe(false);
    expect(await recordTermsAcceptance({}, '', { termsVersion: '21 October 2026', privacyVersion: '21 October 2026' })).toBe(false);
  });
});

describe('4 — the route: signed in, shape-checked, and honest about whether it was saved', () => {
  const body = { termsVersion: '21 October 2026', privacyVersion: '21 October 2026', ageConfirmed: true };

  it('401 without a signed-in user, 400 for a bad body, 503 when nothing could be written, ok only when written', async () => {
    const { registerProfileRoutes } = await import('../src/server/routes/profile');
    const { setServerDb } = await import('../src/server/lib/serverDb');
    const routes = captureRoutes(registerProfileRoutes);
    const post = routes.get('POST /api/profile/terms-acceptance')!;
    expect(post).toBeTruthy();

    const anon = mockRes(); await post({ headers: {}, body }, anon);
    expect(anon.statusCode).toBe(401);

    const bad = mockRes(); await post({ headers: { authorization: 'Bearer good' }, body: { ...body, ageConfirmed: false } }, bad);
    expect(bad.statusCode).toBe(400);

    setServerDb(null);
    const noDb = mockRes(); await post({ headers: { authorization: 'Bearer good' }, body }, noDb);
    expect(noDb.statusCode).toBe(503);
    expect(noDb.body).not.toHaveProperty('ok');

    const store = new Map<string, any>();
    setServerDb({ doc: (path: string) => ({ get: async () => ({ exists: store.has(path), data: () => store.get(path) }), set: async (d: any) => { store.set(path, d); } }) } as any);
    const ok = mockRes(); await post({ headers: { authorization: 'Bearer good' }, body }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(store.get('user_profiles/u_route').termsAcceptance.ageConfirmed).toBe(true);
    setServerDb(null);
  });
});
