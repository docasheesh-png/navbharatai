// P-CGE.8 — Auth Code Generator (JWT + Firebase).
//
// FilePlanningEngine planned an authService file but only emitted a stub — no real token issuance,
// validation, or middleware. This generates REAL, working auth code for a generated app:
//   • type 'jwt' (default): a dependency-free HS256 JWT module (Node `crypto`) + Bearer middleware —
//     it runs immediately with NO install, so it can never break the user's app at runtime.
//   • type 'firebase': client auth helpers (signIn/signUp/signOut/onAuthChange) over the Firebase SDK
//     the user already brings (BYO Firebase).
//   • type 'supabase' (ROADMAP #1 Phase 1.3): the ZERO-SETUP path. A Supabase project already carries
//     a full auth service, so once one-click provisioning has run there is nothing left to configure —
//     the generated code reads the SAME VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the provisioner
//     already wrote into the user's vault, and login works on the first build with no keys to paste.
//
// Pure (returns the files; the caller writes them) → unit-tested. The JWT path is HS256 over a
// JWT_SECRET env var; swap for jsonwebtoken/RS256 if the app needs asymmetric keys.

export type AuthType = 'jwt' | 'firebase' | 'supabase';

export interface AuthFile {
  path: string;
  content: string;
  wiring: string;
}

export interface AuthCodeResult {
  files: AuthFile[];
  /** Dependencies the generated code needs (empty for the dependency-free JWT path). */
  dependencies: string[];
  summary: string;
}

/** Dependency-free HS256 JWT module (sign + verify) using Node crypto. */
function jwtModule(): string {
  return [
    "// Dependency-free HS256 JWT — sign + verify using Node's crypto (no install needed).",
    "// Set JWT_SECRET in the environment. For asymmetric keys, swap in `jsonwebtoken` with RS256.",
    "import crypto from 'crypto';",
    '',
    'export interface JwtPayload {',
    '  sub?: string;',
    '  iat?: number;',
    '  exp?: number;',
    '  [key: string]: unknown;',
    '}',
    '',
    'function secret(): string {',
    "  return process.env.JWT_SECRET || 'dev-insecure-secret-change-me';",
    '}',
    '',
    'function b64url(input: Buffer | string): string {',
    "  return Buffer.from(input).toString('base64url');",
    '}',
    '',
    '/** Sign a payload into an HS256 JWT that expires in `expiresInSec` (default 1h). */',
    'export function signToken(payload: JwtPayload, expiresInSec = 3600): string {',
    "  const header = { alg: 'HS256', typ: 'JWT' };",
    '  const now = Math.floor(Date.now() / 1000);',
    '  const body: JwtPayload = { ...payload, iat: now, exp: now + expiresInSec };',
    '  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;',
    "  const sig = b64url(crypto.createHmac('sha256', secret()).update(data).digest());",
    '  return `${data}.${sig}`;',
    '}',
    '',
    '/** Verify an HS256 JWT. Returns the payload, or null if invalid/expired/tampered. */',
    'export function verifyToken(token: string): JwtPayload | null {',
    "  const parts = String(token || '').split('.');",
    '  if (parts.length !== 3) return null;',
    '  const [h, p, sig] = parts;',
    "  const expected = b64url(crypto.createHmac('sha256', secret()).update(`${h}.${p}`).digest());",
    '  const a = Buffer.from(sig);',
    '  const b = Buffer.from(expected);',
    '  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;',
    '  try {',
    "    const body = JSON.parse(Buffer.from(p, 'base64url').toString()) as JwtPayload;",
    "    if (typeof body.exp === 'number' && Math.floor(Date.now() / 1000) >= body.exp) return null;",
    '    return body;',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
    '',
  ].join('\n');
}

/** Express Bearer-token middleware that validates the JWT and attaches req.user. */
function authMiddlewareModule(): string {
  return [
    '// Express Bearer-token auth middleware — validates the JWT and attaches req.user.',
    "import type { Request, Response, NextFunction } from 'express';",
    "import { verifyToken, type JwtPayload } from '../server/auth/jwt';",
    '',
    'export interface AuthedRequest extends Request {',
    '  user?: JwtPayload;',
    '}',
    '',
    'export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {',
    "  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';",
    "  const token = header.startsWith('Bearer ') ? header.slice(7) : '';",
    '  const payload = token ? verifyToken(token) : null;',
    '  if (!payload) {',
    "    res.status(401).json({ error: 'Unauthorized' });",
    '    return;',
    '  }',
    '  req.user = payload;',
    '  next();',
    '}',
    '',
  ].join('\n');
}

/** Firebase client auth helpers over the Firebase SDK the user already configures. */
function firebaseAuthModule(): string {
  return [
    '// Firebase Authentication helpers (client). Requires `firebase` installed and an initialized app.',
    "import {",
    '  getAuth,',
    '  signInWithEmailAndPassword,',
    '  createUserWithEmailAndPassword,',
    '  signOut as firebaseSignOut,',
    '  onAuthStateChanged,',
    '  type User,',
    "} from 'firebase/auth';",
    '',
    'export function auth() {',
    '  return getAuth();',
    '}',
    '',
    'export function signIn(email: string, password: string) {',
    '  return signInWithEmailAndPassword(auth(), email, password);',
    '}',
    '',
    'export function signUp(email: string, password: string) {',
    '  return createUserWithEmailAndPassword(auth(), email, password);',
    '}',
    '',
    'export function signOut() {',
    '  return firebaseSignOut(auth());',
    '}',
    '',
    'export function onAuthChange(callback: (user: User | null) => void) {',
    '  return onAuthStateChanged(auth(), callback);',
    '}',
    '',
  ].join('\n');
}

/**
 * Supabase auth client (ROADMAP #1 Phase 1.3 — zero setup).
 *
 * Deliberately uses the ANON key only. It is the public, row-level-security-scoped key and is safe in
 * a client bundle; the service-role key bypasses RLS entirely and must never reach a browser.
 *
 * `getSession` is awaited before any redirect decision because Supabase restores a session
 * asynchronously — reading it synchronously on mount is the classic bug that logs a returning user
 * straight back out on refresh.
 */
function supabaseAuthModule(): string {
  return [
    "// Auth backed by YOUR OWN Supabase project — created for you by NavBharatAI.",
    "// The URL and anon key are already in your environment; there is nothing to configure.",
    "//",
    "// The ANON key is the PUBLIC, row-level-security-scoped key and is safe in a browser bundle.",
    "// Never put the service-role key here — it bypasses RLS entirely.",
    "import { createClient, type Session, type User } from '@supabase/supabase-js';",
    '',
    "const url = import.meta.env.VITE_SUPABASE_URL as string;",
    "const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;",
    '',
    'if (!url || !anonKey) {',
    "  // Fail loudly in development rather than shipping a login screen that silently never works.",
    "  console.error('[auth] Supabase is not configured — connect a database in NavBharatAI Settings.');",
    '}',
    '',
    'export const supabase = createClient(url, anonKey);',
    '',
    '/** Create an account. Supabase may require email confirmation before the session becomes active. */',
    'export async function signUp(email: string, password: string): Promise<{ user: User | null; needsConfirmation: boolean }> {',
    '  const { data, error } = await supabase.auth.signUp({ email, password });',
    '  if (error) throw error;',
    '  // A null session with a real user means "check your email" — telling the user they are signed',
    '  // in at this point would be wrong, and is why this is surfaced instead of swallowed.',
    '  return { user: data.user, needsConfirmation: !data.session && !!data.user };',
    '}',
    '',
    '/** Sign in with email + password. */',
    'export async function signIn(email: string, password: string): Promise<Session> {',
    '  const { data, error } = await supabase.auth.signInWithPassword({ email, password });',
    '  if (error) throw error;',
    '  return data.session;',
    '}',
    '',
    'export async function signOut(): Promise<void> {',
    '  const { error } = await supabase.auth.signOut();',
    '  if (error) throw error;',
    '}',
    '',
    '/** Send a password-reset email. Always resolves — never reveal whether an address exists. */',
    'export async function resetPassword(email: string): Promise<void> {',
    '  await supabase.auth.resetPasswordForEmail(email, {',
    '    redirectTo: `${window.location.origin}/reset-password`,',
    '  });',
    '}',
    '',
    '/**',
    ' * The current session, or null.',
    ' *',
    ' * MUST be awaited before deciding what to render. Supabase restores a stored session',
    ' * asynchronously, so a synchronous read on mount reports "logged out" for a user who is not —',
    ' * the classic bug that boots a returning user on every refresh.',
    ' */',
    'export async function getSession(): Promise<Session | null> {',
    '  const { data } = await supabase.auth.getSession();',
    '  return data.session;',
    '}',
    '',
    '/** Subscribe to sign-in/sign-out. Returns an unsubscribe function — call it on unmount. */',
    'export function onAuthChange(cb: (session: Session | null) => void): () => void {',
    '  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));',
    '  return () => data.subscription.unsubscribe();',
    '}',
  ].join('\n');
}

/**
 * Generate real auth code for a generated app. `type` 'jwt' (default) is dependency-free; 'firebase'
 * emits client helpers that need the `firebase` SDK. Pure: returns the files + any required deps.
 */
export function generateAuthCode(input: { type?: AuthType } = {}): AuthCodeResult {
  const type: AuthType = input.type === 'firebase' || input.type === 'supabase' ? input.type : 'jwt';
  if (type === 'supabase') {
    return {
      files: [
        {
          path: 'src/lib/authClient.ts',
          content: supabaseAuthModule(),
          wiring: 'Import signUp/signIn/signOut/resetPassword/getSession/onAuthChange in your auth UI. '
            + 'AWAIT getSession() before deciding what to render, or a returning user is logged out on refresh. '
            + 'No keys to set — the database NavBharatAI created for you already supplies them.',
        },
      ],
      dependencies: ['@supabase/supabase-js'],
      summary: 'Generated Supabase auth (src/lib/authClient.ts) against the database in your own Supabase '
        + 'account — signup, login, logout, password reset and session handling, with nothing to configure.',
    };
  }
  if (type === 'firebase') {
    return {
      files: [
        {
          path: 'src/lib/authClient.ts',
          content: firebaseAuthModule(),
          wiring: 'Import signIn/signUp/signOut/onAuthChange in your auth UI; requires an initialized Firebase app.',
        },
      ],
      dependencies: ['firebase'],
      summary: 'Generated Firebase client auth helpers (src/lib/authClient.ts). Install: npm i firebase.',
    };
  }
  return {
    files: [
      {
        path: 'src/server/auth/jwt.ts',
        content: jwtModule(),
        wiring: 'Use signToken(payload) on login; set JWT_SECRET in your environment.',
      },
      {
        path: 'src/middleware/authMiddleware.ts',
        content: authMiddlewareModule(),
        wiring: 'Protect routes with app.use(authMiddleware) or per-route; reads req.user after verify.',
      },
    ],
    dependencies: [],
    summary: 'Generated dependency-free HS256 JWT auth (src/server/auth/jwt.ts + src/middleware/authMiddleware.ts). Set JWT_SECRET.',
  };
}
