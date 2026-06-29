// P-CGE.8 — Auth Code Generator (JWT + Firebase).
//
// FilePlanningEngine planned an authService file but only emitted a stub — no real token issuance,
// validation, or middleware. This generates REAL, working auth code for a generated app:
//   • type 'jwt' (default): a dependency-free HS256 JWT module (Node `crypto`) + Bearer middleware —
//     it runs immediately with NO install, so it can never break the user's app at runtime.
//   • type 'firebase': client auth helpers (signIn/signUp/signOut/onAuthChange) over the Firebase SDK
//     the user already brings (BYO Firebase).
//
// Pure (returns the files; the caller writes them) → unit-tested. The JWT path is HS256 over a
// JWT_SECRET env var; swap for jsonwebtoken/RS256 if the app needs asymmetric keys.

export type AuthType = 'jwt' | 'firebase';

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
 * Generate real auth code for a generated app. `type` 'jwt' (default) is dependency-free; 'firebase'
 * emits client helpers that need the `firebase` SDK. Pure: returns the files + any required deps.
 */
export function generateAuthCode(input: { type?: AuthType } = {}): AuthCodeResult {
  const type: AuthType = input.type === 'firebase' ? 'firebase' : 'jwt';
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
