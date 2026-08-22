/**
 * P0a/P0b — Reusable Firebase ID-token verification + rate-limiting helpers.
 *
 * verifyFirebaseToken(req) — resolves to the decoded token's uid, or null if
 *   no/invalid Bearer token is provided. Best-effort: never throws.
 *
 * requireUserMatch(paramName) — Express middleware that:
 *   1. Reads Authorization: Bearer <idToken>
 *   2. Verifies with firebase-admin (skipped in VITEST)
 *   3. Asserts decoded uid === req.params[paramName]
 *   Returns 401 (missing/invalid token) or 403 (uid mismatch).
 *
 * buildRateLimiter() — Express middleware for hot build endpoints:
 *   - Authenticated users (valid Bearer token): 10 builds per hour
 *   - Anonymous (no token): 5 builds per hour (keyed by IP)
 *   Returns 429 when over limit. VITEST-skipped.
 */
import type { Request, Response, NextFunction } from 'express';
import { consumeDurableRate } from './DurableRateLimit';
import { loadFirebaseAdmin } from './firebaseAdminModule';
import { getServerDb, doc, getDoc } from './serverDb';
import { readBanStatus, suspendedMessage } from './banGate';
import { audit } from './audit';

/**
 * firebase-admin init options. Passes an EXPLICIT projectId when the environment provides one, so the
 * admin SDK can never mis-detect the project it verifies ID tokens against (a wrong/auto-detected
 * project makes `verifyIdToken` reject every genuinely-valid token → the user silently becomes 'anon').
 * Falls back to `{}` (today's auto-detect) when no project env is set, so this is purely additive.
 */
export function adminAppOptions(env: NodeJS.ProcessEnv = process.env): { projectId?: string } {
  const projectId = (env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '').trim();
  return projectId ? { projectId } : {};
}

async function getAdminAuth(): Promise<import('firebase-admin/auth').Auth | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp(adminAppOptions());
    return admin.auth();
  } catch (err) {
    // HONESTY (2026-07-09): this catch used to swallow the error silently, so an
    // 'admin-unavailable' fallback had detail:null and the real init failure was invisible
    // for months. Log it so a broken admin SDK can never again hide behind a null.
    console.error('[AUTH] getAdminAuth failed to initialize firebase-admin:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Why a token verification produced (or failed to produce) an identity — so an 'anon' fallback on the
 * build path is never SILENT. `no-bearer` = the request carried no Bearer token; `admin-unavailable` =
 * the firebase-admin SDK could not initialize (missing creds / cold-start); `verify-error` =
 * `verifyIdToken` threw (expired/invalid token, OR — the systematic case — the server cannot reach
 * Google's signing certs, which rejects EVERY real token). `ok` = a real verified identity.
 */
export type IdentityReason = 'ok' | 'no-bearer' | 'admin-unavailable' | 'verify-error';
export interface IdentityWithReason {
  identity: { uid: string; email: string | null } | null;
  reason: IdentityReason;
  /** The thrown error's message when reason === 'verify-error' (for honest server-side diagnostics). */
  detail?: string;
}

/** Minimal shape of the admin auth we depend on — injectable so this is unit-testable without GCP. */
export interface VerifierAuth { verifyIdToken(token: string): Promise<{ uid: string; email?: string | null }>; }

/**
 * Testable CORE of identity verification with an honest failure reason. Deps (the Authorization header
 * + an auth-provider factory) are injected so a fake can exercise every branch. On a transient throw it
 * RETRIES ONCE (a cold-start cert-fetch race is the common false negative), then reports `verify-error`.
 */
export async function verifyIdentityWithReason(
  authHeader: string | undefined,
  getAuth: () => Promise<VerifierAuth | null>,
): Promise<IdentityWithReason> {
  if (!authHeader?.startsWith('Bearer ')) return { identity: null, reason: 'no-bearer' };
  const token = authHeader.slice(7);
  const auth = await getAuth();
  if (!auth) return { identity: null, reason: 'admin-unavailable' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const decoded = await auth.verifyIdToken(token);
      return { identity: { uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email : null }, reason: 'ok' };
    } catch (err) {
      if (attempt === 1) return { identity: null, reason: 'verify-error', detail: err instanceof Error ? err.message : String(err) };
    }
  }
  return { identity: null, reason: 'verify-error' };
}

/** Request-level identity + honest reason (build path uses this to log an 'anon' fallback's true cause). */
export async function verifyFirebaseIdentityDiag(req: Request): Promise<IdentityWithReason> {
  if (process.env.VITEST) return { identity: null, reason: 'no-bearer' };
  return verifyIdentityWithReason(req.headers.authorization, getAdminAuth as unknown as () => Promise<VerifierAuth | null>);
}

export async function verifyFirebaseToken(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * The phone number FIREBASE ITSELF vouches for on this request, or null.
 *
 * ⚠️ THE ONLY ACCEPTABLE SOURCE OF A PHONE NUMBER ON A MONEY PATH. `phone_number` is present in the
 * decoded ID token only when a phone credential is genuinely linked to the account, i.e. only after a
 * real OTP was delivered and entered. A number taken from the request BODY would let anyone type any
 * number and claim the verified bonus, which is the entire scheme defeated — so the gift claim reads
 * this and never the body. Best-effort, like the helpers around it: never throws.
 */
export async function verifiedPhoneNumber(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(header.slice(7)) as { phone_number?: string | null };
    const phone = typeof decoded.phone_number === 'string' ? decoded.phone_number.trim() : '';
    return phone || null;
  } catch {
    return null;
  }
}

/**
 * Like verifyFirebaseToken, but returns the VERIFIED uid AND email from the decoded token (or null
 * when no valid Bearer token). Use this where the email also drives an authorization decision (e.g.
 * an allowlist) so the check can't be spoofed by a client-supplied `email` body field.
 */
export async function verifyFirebaseIdentity(req: Request): Promise<{ uid: string; email: string | null } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email : null };
  } catch {
    return null;
  }
}

/**
 * Resolve a VERIFIED user's email from the Firebase Admin user record when the ID token itself omitted
 * the email claim. Some providers / custom tokens don't carry `email`, and a null email silently drops a
 * free-list user to BILLED (the exact cause of the admin's -1,22,330-token wallet, deep-test 2026-07-13:
 * free-list exemption matches by email, so a token without one → uid-only match → not exempt → debited).
 * The uid is ALREADY verified, so the account email returned here is trustworthy (T0-9 — it is the real
 * account email from Firebase, never a client-claimed one). Best-effort: returns null on any failure so
 * the caller degrades EXACTLY as before this fallback existed. VITEST-skipped.
 */
/** Minimal shape we depend on for the account lookup — injectable so the core is unit-testable. */
export interface UserLookupAuth { getUser(uid: string): Promise<{ email?: string | null; displayName?: string | null }>; }

/** Testable CORE: resolve the account email for an ALREADY-verified uid via an injected auth provider.
 *  Best-effort — returns null on a missing provider, a lookup throw, or an empty/absent email. Pure of
 *  the process.env.VITEST short-circuit (the wrapper below owns that) so every branch can be exercised. */
export async function resolveVerifiedEmailWith(
  uid: string,
  getAuth: () => Promise<UserLookupAuth | null>,
): Promise<string | null> {
  if (!uid) return null;
  try {
    const auth = await getAuth();
    if (!auth) return null;
    const user = await auth.getUser(uid);
    return typeof user.email === 'string' && user.email ? user.email : null;
  } catch {
    return null; // admin SDK unavailable / user lookup failed → degrade to no-email (today's behavior)
  }
}

export async function resolveVerifiedEmail(uid: string): Promise<string | null> {
  if (process.env.VITEST || !uid) return null;
  return resolveVerifiedEmailWith(uid, getAdminAuth as unknown as () => Promise<UserLookupAuth | null>);
}

/**
 * The admin Auth handle, exported for the phone gate (`phoneGate.ts`).
 *
 * Exported rather than re-created there so there is exactly ONE place that initialises firebase-admin
 * — a second initialiser is how two slightly different app configs end up in one process, and this
 * file's own history (the `FIREBASE_PROJECT_ID` mix-up recorded in CLAUDE.md) is what that costs.
 */
export const getAdminAuthForPhone = getAdminAuth as unknown as () => Promise<import('./phoneGate').PhoneLookupAuth | null>;

/** Testable CORE: resolve the account DISPLAY NAME for an already-verified uid. Best-effort — null on a
 *  missing provider, a lookup throw, or an empty/absent name. Mirrors resolveVerifiedEmailWith so the
 *  admin build-report inbox can show WHO sent a report, not just their email. */
export async function resolveVerifiedNameWith(
  uid: string,
  getAuth: () => Promise<UserLookupAuth | null>,
): Promise<string | null> {
  if (!uid) return null;
  try {
    const auth = await getAuth();
    if (!auth) return null;
    const user = await auth.getUser(uid);
    return typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName.trim() : null;
  } catch {
    return null;
  }
}

export async function resolveVerifiedName(uid: string): Promise<string | null> {
  if (process.env.VITEST || !uid) return null;
  return resolveVerifiedNameWith(uid, getAdminAuth as unknown as () => Promise<UserLookupAuth | null>);
}

export function requireUserMatch(paramName = 'userId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // VITEST: skip auth checks entirely
    if (process.env.VITEST) { next(); return; }

    const uid = await verifyFirebaseToken(req);
    if (!uid) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (uid !== req.params[paramName]) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    next();
  };
}

// In-memory rate-limit buckets — keyed by "<bucketName>:<uid|IP>" so DIFFERENT
// limiters (build vs workspace) never share a counter for the same user. Map is
// periodically self-pruning to prevent unbounded growth.
const _rateBuckets = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface RateLimitOptions {
  /** Namespace so each limiter has its own counters (e.g. 'build', 'workspace'). */
  name: string;
  /** Max requests per hour for an authenticated user. */
  authed: number;
  /** Max requests per hour for an anonymous caller (keyed by IP). */
  anon: number;
  /** Noun shown in the 429 message (e.g. 'builds', 'requests'). Default 'requests'. */
  noun?: string;
  /**
   * SECURITY Phase 1.4 — GLOBAL anonymous ceiling: the max anonymous requests per hour across the
   * WHOLE platform (all IPs, all instances), enforced via one shared durable bucket. Caps abuse a
   * per-IP limit can't (a botnet rotating IPs). Omit to disable the global ceiling.
   */
  anonGlobalPerHour?: number;
  /**
   * FIRESTORE-WRITE FIX (2026-07-11): when false, the limiter uses ONLY the in-memory per-instance
   * bucket (Layer 1) and skips the durable Firestore read+write (Layer 2). Set this for HIGH-FREQUENCY,
   * NO-COST endpoints (e.g. the in-browser preview render, hit up to 1200×/hr on every poll/edit) where
   * a per-request Firestore write was the dominant source of daily write-quota exhaustion — and where
   * per-instance limiting is enough because the endpoint has no spend to protect. Default true (durable).
   */
  durable?: boolean;
}

/**
 * Generic per-hour rate limiter. Authenticated callers (valid Bearer token) are keyed by uid and get
 * the `authed` limit; anonymous callers are keyed by IP and get the `anon` limit.
 *
 * SECURITY Phase 1.4 — the count is now DURABLE (Firestore, shared across Cloud Run instances and
 * surviving cold starts) so the limit actually holds; the in-memory bucket stays as a fast
 * per-instance pre-filter. Both layers FAIL-OPEN (a Firestore hiccup never blocks a real request).
 * VITEST-skipped. Returns 429 when over the limit.
 */
export function rateLimiter(opts: RateLimitOptions) {
  const noun = opts.noun ?? 'requests';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }

    const uid = await verifyFirebaseToken(req);
    const key = `${opts.name}:${uid ?? (req.ip || 'anon')}`;
    const limit = uid ? opts.authed : opts.anon;
    const now = Date.now();

    // Self-prune when the map gets large (evict windows that have expired).
    if (_rateBuckets.size > 5000) {
      for (const [k, v] of _rateBuckets) {
        if (now - v.windowStart > RATE_WINDOW_MS) _rateBuckets.delete(k);
      }
    }

    // Layer 1 — fast in-memory pre-filter (per instance). A local over-limit short-circuits the
    // durable read entirely (cheap denial for a hammering client already hot on THIS instance).
    const bucket = _rateBuckets.get(key);
    if (bucket && now - bucket.windowStart <= RATE_WINDOW_MS) {
      if (bucket.count >= limit) {
        res.status(429).json({ error: `Rate limit exceeded: max ${limit} ${noun} per hour. Try again later.` });
        return;
      }
      bucket.count++;
    } else {
      _rateBuckets.set(key, { count: 1, windowStart: now });
    }

    // In-memory-only limiters (opts.durable === false) stop here: no per-request Firestore write. Used
    // for high-frequency no-cost endpoints (in-browser preview) where the durable write was the #1
    // source of daily write-quota exhaustion and per-instance limiting is sufficient (nothing to spend).
    if (opts.durable === false) { next(); return; }

    // Layer 2 — DURABLE cross-instance enforcement (bounded + fail-open). This is what makes the
    // limit real on min-instances=0. A global anon ceiling caps total anonymous volume platform-wide.
    const durable = await Promise.race([
      (async () => {
        const per = await consumeDurableRate(opts.name, uid ?? (req.ip || 'anon'), limit, RATE_WINDOW_MS, now);
        if (!per.allowed) return { ok: false, limit: per.limit };
        if (!uid && opts.anonGlobalPerHour && opts.anonGlobalPerHour > 0) {
          const global = await consumeDurableRate(opts.name, 'GLOBAL_ANON', opts.anonGlobalPerHour, RATE_WINDOW_MS, now);
          if (!global.allowed) return { ok: false, limit: global.limit, global: true };
        }
        return { ok: true, limit };
      })(),
      new Promise<{ ok: true }>((resolve) => setTimeout(() => resolve({ ok: true }), 2_000)),
    ]).catch(() => ({ ok: true as const }));

    if (!durable.ok) {
      const isGlobal = 'global' in durable && durable.global;
      res.status(429).json({
        error: isGlobal
          ? `The platform's hourly limit for anonymous ${noun} has been reached. Sign in or try again later.`
          : `Rate limit exceeded: max ${'limit' in durable ? durable.limit : limit} ${noun} per hour. Try again later.`,
      });
      return;
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P-SEC.1 — RBAC (Role-Based Access Control)
// Roles live in Firestore `users/{uid}.role`. CRITICAL backward-compat rule: a user
// with NO role set defaults to `owner` (full access), so this is purely additive —
// no existing single-user account is ever locked out. Granularity only kicks in once
// a role is explicitly assigned (e.g. team members get `editor`/`viewer`).
// ─────────────────────────────────────────────────────────────────────────────
export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'billing_only';

/** Higher rank = more privilege. `billing_only` is a side-grant (billing actions), low general rank. */
export const ROLE_RANK: Record<UserRole, number> = { viewer: 1, billing_only: 1, editor: 2, admin: 3, owner: 4 };

/** Pure, testable access decision. owner/admin are superusers (always allowed). */
export function isRoleAllowed(role: UserRole, allowed: UserRole[]): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return allowed.includes(role);
}

async function getAdminFirestore(): Promise<import('firebase-admin/firestore').Firestore | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp(adminAppOptions());
    // Collision-free shared handle targeting navbharat-prod (not the (default) DB the client can't read).
    return getServerDb();
  } catch (err) {
    console.error('[AUTH] getAdminFirestore failed to initialize firebase-admin:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Read a user's role from Firestore. Defaults to `owner` (backward-compatible) when unset/unreadable. */
export async function getUserRole(uid: string): Promise<UserRole> {
  if (process.env.VITEST) return 'owner';
  try {
    const db = await getAdminFirestore();
    if (!db) return 'owner';
    const snap = await db.collection('users').doc(uid).get();
    const role = snap.exists ? (snap.data()?.role as UserRole | undefined) : undefined;
    return role && ROLE_RANK[role] ? role : 'owner';
  } catch {
    return 'owner';
  }
}

/** Assign a user's role (admin/owner operation). Best-effort; throws only on hard Firestore error. */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  if (process.env.VITEST) return;
  const db = await getAdminFirestore();
  if (!db) return;
  await db.collection('users').doc(uid).set({ role }, { merge: true });
}

/**
 * Express middleware: require the authenticated user to hold one of `allowed` roles
 * (owner/admin always pass). 401 if unauthenticated, 403 if role insufficient.
 * VITEST-skipped. Attaches the resolved role to `req.userRole`.
 */
export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const role = await getUserRole(uid);
    if (!isRoleAllowed(role, allowed)) {
      res.status(403).json({ error: 'Forbidden: insufficient role for this action.' });
      return;
    }
    (req as Request & { userRole?: UserRole }).userRole = role;
    next();
  };
}

/** Hot build endpoint (`/chat`): 10 builds/hr authed, 5/hr per anon IP, and a durable 100/hr GLOBAL
 *  anon ceiling so a botnet rotating IPs still can't exceed the whole-platform anonymous budget. */
export function buildRateLimiter() {
  return rateLimiter({ name: 'build', authed: 10, anon: 5, noun: 'builds', anonGlobalPerHour: 100 });
}

/**
 * enforceNotBanned() — Express middleware that refuses a build/spend request from a user the admin has
 * BLOCKED (POST /api/admin/users/:userId/ban). This is what makes the admin "Block" action REAL: the
 * `banned` flag on the wallet doc is now ENFORCED at every build/spend entry point, not merely stored
 * (previously a banned user could still build and spend NavBharatAI's provider budget — a fake feature).
 *
 * Identity is the VERIFIED token uid ONLY, so a banned user cannot evade by claiming another uid.
 * FAIL-OPEN + bounded: an anonymous caller, a missing token, or any Firestore error/timeout passes
 * through (readBanStatus returns not-banned, and the read is capped at 3s), so a degraded Firestore can
 * never lock out every legitimate user. VITEST-skipped, like the other auth middleware.
 */
export function enforceNotBanned() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.VITEST) return next();
    try {
      const uid = await verifyFirebaseToken(req);
      if (uid) {
        const reader = async (u: string): Promise<unknown | null> => {
          const snap = await getDoc(doc(getServerDb() as any, 'user_token_wallets', u));
          return snap.exists() ? snap.data() : null;
        };
        // Bound the Firestore read so a hung/slow read can't stall the request; a timeout resolves to
        // not-banned (fail-open), matching readBanStatus's own error posture.
        const ban = await Promise.race([
          readBanStatus(reader, uid),
          new Promise<{ banned: false }>((resolve) => setTimeout(() => resolve({ banned: false }), 3_000)),
        ]);
        if (ban.banned) {
          audit('BANNED_USER_REQUEST_REFUSED', { uid, path: req.path, reason: ban.reason ?? null }, 'warn');
          res.status(403).json({ error: suspendedMessage(ban), code: 'ACCOUNT_SUSPENDED' });
          return;
        }
      }
    } catch { /* fail-open — a ban-check error never blocks a legitimate request */ }
    next();
  };
}

/**
 * Workspace endpoints (`/restore`, `/import-files`, `/workspace-files`, `/checkpoints`, …):
 * cheaper than a full build but still hit the sandbox / Firestore, so they get a real ceiling.
 *
 * ROOT CAUSE OF THE 2026-08-21 PUBLISH 429 (admin: "1 publish kiya isi me rate limit", with 12 total
 * users and 1 active). ~54 routes share this ONE bucket, and two of them were TIMER POLLS: the App
 * Logs pane polls `/runtime-logs` every 2.5s (1440/hr) and `/services` every 6s (600/hr). Opening
 * that tab therefore spent the WHOLE hourly budget in about 35 seconds, and from then on every other
 * workspace route was dead for the rest of the hour — the user only found out when Publish, which had
 * made exactly one request, came back "max 60 requests per hour". The publish was never the 61st
 * anything; it was the first request after a poller had eaten the hour.
 *
 * Both fixes are below: the pollers moved to `workspacePollRateLimiter` (a poll must never share a
 * bucket with a user action), and this ceiling was raised to a number a real IDE session actually
 * needs. 60/hr across 54 routes was under one request a minute for the entire workspace surface —
 * an afternoon of building spends that on checkpoint lists, git status, file reads and restores
 * before the user ever reaches for a button. Nothing on this bucket costs provider money: the AI
 * routes (`/api/debug`, `/api/app-debug/*`) debit the user's wallet, the `/api/workspace/*` analysers
 * are deterministic and free, builds have their own 10/hr bucket, and publish/deploy now have theirs.
 */
export const WORKSPACE_RATE: RateLimitOptions = { name: 'workspace', authed: 240, anon: 120, noun: 'requests' };
export function workspaceRateLimiter() {
  return rateLimiter(WORKSPACE_RATE);
}

/**
 * THE APP LOGS PANE (`/api/agentv3/runtime-logs`, `/api/agentv3/services`) — its own bucket, sized to
 * the interval the client actually polls at. Fifth instance of the same lesson (zip chunks, terminal
 * keystrokes, domain ops, preview polling, now this one).
 *
 * A limiter's budget has to be at least the rate the product itself generates, or the feature is
 * fiction — and worse than fiction here, because the two pollers were spending a bucket that 52 OTHER
 * routes needed. `pollBudgetPerHour` below is the arithmetic, and a test holds these numbers against
 * the client's real interval constants so a future 1-second poll fails CI instead of a user's publish.
 *
 * `durable: false` for the same reason as the preview render: a Firestore write every 2.5 seconds is
 * pure write-quota burn for a read that spends nothing. The real cost guard on these is the `active`
 * flag in the hooks — a closed pane polls zero times.
 */
export const WORKSPACE_POLL_RATE: RateLimitOptions = { name: 'workspace-poll', authed: 3000, anon: 1500, noun: 'status checks', durable: false };
export function workspacePollRateLimiter() {
  return rateLimiter(WORKSPACE_POLL_RATE);
}

/** Requests per hour a client timer at `intervalMs` generates. The sizing arithmetic, in one place. */
export function pollBudgetPerHour(intervalMs: number): number {
  return Math.ceil(3_600_000 / intervalMs);
}

/**
 * PUBLISH / BACKEND DEPLOY (`/api/agentv3/publish`, `/api/agentv3/deploy-backend`) — their own bucket.
 *
 * These are the expensive, outward-facing ones (a real build plus a real Hosting/Render deploy), and
 * they are also the ones a user most needs to work on the first try. Sharing the general workspace
 * bucket got them both wrong at once: they could be starved by cheap metadata calls, and they could
 * starve those calls in return. A small dedicated budget nothing else can spend is strictly better in
 * both directions — 30/hr is far more publishing than any real session does, and it is now 30 that
 * belong to publishing alone. Durable (cross-instance), because unlike a poll this one is worth
 * a Firestore write to enforce honestly.
 */
export const DEPLOY_OPS_RATE: RateLimitOptions = { name: 'deploy-ops', authed: 30, anon: 10, noun: 'publish requests' };
export function deployOpsRateLimiter() {
  return rateLimiter(DEPLOY_OPS_RATE);
}

/**
 * The IN-BROWSER preview render (`/api/agentv3/inbrowser-preview`) needs its OWN, generous limiter —
 * NOT the tight 60/30-per-hour `workspaceRateLimiter`. Why: it is the ALWAYS-available preview path
 * (a self-contained HTML render built locally from the workspace files — no AI, no external API, no
 * cost, and server-side CACHED), yet the client re-renders it on many normal interactions (tab open,
 * edit, poll). Sharing the general workspace bucket meant an active builder hit "Rate limit exceeded:
 * max 30 requests per hour" on the CORE preview after only a few apps (admin evidence, 2026-07-06).
 * This endpoint authenticates by body `userId` (not a Bearer header), so the limiter can't see the
 * signed-in user and would otherwise apply the ANON limit — hence both tiers are generous. Still
 * bounded (the render is CPU work) so a runaway client can't hammer the bundler unboundedly.
 */
export const INBROWSER_PREVIEW_RATE: RateLimitOptions = { name: 'inbrowser-preview', authed: 1200, anon: 600, noun: 'preview renders', durable: false };
export function inbrowserPreviewRateLimiter() {
  return rateLimiter(INBROWSER_PREVIEW_RATE);
}

/**
 * TERMINAL KEYSTROKES (`/api/agentv3/shell/input`, `/shell/resize`) — their own bucket, sized to the
 * real work, exactly the zip-chunk lesson over again.
 *
 * ROOT CAUSE (admin 2026-08-05, "terminal bahut slow hai"): shell input sat on `workspaceRateLimiter`
 * — 60 requests per HOUR, shared with ~44 other workspace routes. A terminal keystroke is one
 * request, so the "real Replit-style shell" died 429 after about one minute of typing, and every
 * rotation of the phone spent more of the same bucket on resize events. A rate ceiling that makes
 * the advertised feature impossible is fiction, not protection.
 *
 * Sized to reality: the client coalesces bursts (one in-flight batch at a time), so even frantic
 * typing lands well under 2 requests/second. 7200/hr sustains exactly that ceiling; the shell itself
 * is memory-write cheap (PTY append), and the true resource guards are MAX_SHELLS_PER_WORKSPACE and
 * the PTY input cap in ShellSessions. Anonymous is lower but real — anon workspaces are a legitimate
 * capability (unguessable sid) and their terminal must type too.
 */
export const SHELL_INPUT_RATE: RateLimitOptions = { name: 'shell-input', authed: 7200, anon: 1800, noun: 'terminal keystrokes', durable: false };
export function shellInputRateLimiter() {
  return rateLimiter(SHELL_INPUT_RATE);
}

/**
 * CUSTOM-DOMAIN OPERATIONS (`/api/domains/nbai/*`) — their own bucket, the third instance of the
 * same lesson (zip chunks, then terminal keystrokes, now domains).
 *
 * ROOT CAUSE (admin screenshot 2026-08-06): every domain route sat on `buildRateLimiter` — 10/hour,
 * the bucket for AI BUILDS — so one live setup session (connect, apply taps, status checks, plus the
 * rehydration call on every page open) exhausted it and the whole domain flow died for an hour with
 * a message about "builds" the user never ran. Setting up a domain is a handful of cheap metadata
 * calls, not an AI build. Bounded still — these fan out to external DNS/hosting APIs with their own
 * quotas — but sized to a real setup session, and the message names the right noun.
 */
export const DOMAIN_OPS_RATE: RateLimitOptions = { name: 'domain-ops', authed: 240, anon: 30, noun: 'domain requests', durable: false };
export function domainOpsRateLimiter() {
  return rateLimiter(DOMAIN_OPS_RATE);
}

/**
 * CHUNKED UPLOAD TRANSPORT (`/api/zip-upload/chunk`) — its own bucket, sized to the real work.
 *
 * ROOT CAUSE (admin question 2026-08-04, "60 per hour — per user or for the whole app?"): the chunk
 * endpoint sat on `workspaceRateLimiter` (60 requests/hour, a bucket SHARED with ~44 other workspace
 * routes). A chunk is 8 MB, so the advertised 5 GB import needs **640 chunk requests** — it would 429
 * at chunk ~60, i.e. after roughly 470 MB, and sooner still because preview polling and file
 * operations spend the same 60. The 5 GB ceiling shipped the same morning was therefore FICTION in
 * production: exactly the "advertised but not real" failure the second absolute rule forbids.
 *
 * Sized at 2000/hr so a full 5 GB upload (640) plus retries and a second upload all fit. This is NOT a
 * loosening of abuse control: total bytes are bounded by MAX_ARCHIVE_BYTES + the free-disk preflight
 * (an upload cannot exceed 5 GB no matter how many requests it splits into), so the request count was
 * never the thing protecting us. `durable: false` for the same reason as the preview render — a
 * per-chunk Firestore write would be 640 writes per import, for no protection at all.
 */
export const ZIP_CHUNK_RATE: RateLimitOptions = { name: 'zip-chunk', authed: 2000, anon: 0, noun: 'upload chunks', durable: false };
export function zipChunkRateLimiter() {
  return rateLimiter(ZIP_CHUNK_RATE);
}

/**
 * PREVIEW POLLING (`/api/agentv3/preview-health`, `/api/agentv3/preview-error`) — its own bucket.
 *
 * Same root cause as above, felt by the user as "the preview just doesn't work". The preview watchdog
 * re-probes every 150s AND on every window focus/visibility change, and each browser console error is
 * reported — all on the shared 60/hr workspace bucket. A user with the tab open through an afternoon
 * exhausts it, and from then on the health probe 429s: the preview is fine, but NavBharatAI reports it
 * as down. Polling is cheap (a durable file count + a `curl` against an ALREADY-warm sandbox; it never
 * spins one up), so it gets a generous, in-memory bucket of its own.
 *
 * `preview-diagnose` deliberately KEEPS the tight workspace limiter: it genuinely boots a sandbox and
 * installs dependencies — real spend that must stay bounded.
 */
export const PREVIEW_POLL_RATE: RateLimitOptions = { name: 'preview-poll', authed: 600, anon: 300, noun: 'preview checks', durable: false };
export function previewPollRateLimiter() {
  return rateLimiter(PREVIEW_POLL_RATE);
}

/**
 * P-SEC.13 — Device binding for sensitive operations. Records the caller's device fingerprint
 * (hashed UA + IP) against the user and DETECTS anomalies. Non-blocking by design (a UA bump or
 * mobile IP change must never lock a real user out — see sessionTracker.ts): on a first-seen
 * device it audits the access and sets an honest `X-Device-New: true` response header that the
 * client can surface, then lets the request proceed. Must run AFTER an auth middleware that has
 * established the uid (e.g. `requireUserMatch`). VITEST/DB-outage safe — degrades to a no-op.
 */
export function trackDevice(paramName = 'userId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    try {
      const uid = req.params[paramName] || (await verifyFirebaseToken(req));
      if (uid) {
        const { recordAndEvaluateDevice } = await import('./sessionTracker');
        const evaluation = await recordAndEvaluateDevice(
          uid, req.headers['user-agent'] as string | undefined, req.ip, new Date().toISOString(),
        );
        if (evaluation.risk === 'high') {
          res.setHeader('X-Device-New', 'true');
          const { audit } = await import('./audit');
          audit('SENSITIVE_ACCESS_NEW_DEVICE', { uid, ip: req.ip, path: req.path }, 'warn');
        }
      }
    } catch (err) {
      // Never let device tracking break a legitimate request.
      console.error('[trackDevice] non-fatal:', err);
    }
    next();
  };
}
