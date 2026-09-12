// WHEN DID THIS PERSON JOIN, AND WHEN WERE THEY LAST HERE? — plus the activity signals the admin
// panel needs to understand an account without reading a word the user wrote.
//
// ADMIN 2026-09-11: "user list me, user ne kab join kiya, last active kab tha bhi ana chahiye. aur
// user ke samne ek info button bhi banao, jis par click karne se user ki jitni information hamare pas
// hai woh admin sab read only dekh sake."
//
// ── WHERE THE TWO DATES COME FROM, AND WHY NOT FROM FIRESTORE ────────────────────────────────────
// Firestore holds no join date worth the name. The wallet's `createdAt` is when the WALLET was made,
// and `welcomeBonus.ts` exists precisely because a wallet document can be re-created — so a user who
// lost and regained a wallet would appear to have joined last week. The wallet's `updatedAt` is not
// "last active" either: it moves only when money moves, so a user who chatted every day for a month
// without spending would look dormant.
//
// Firebase Auth records both properly: `creationTime` is the account's real birth, and
// `lastRefreshTime` is the last time that account's session was refreshed — which happens roughly
// hourly while somebody is actually using the app. So Auth is the source, and the wallet is only a
// LABELLED fallback.
//
// ⚠️ This deliberately does NOT contradict `adminUserLookup.ts`, which refuses to take NAMES from the
// Auth API so the panel cannot show two different names for one person. Nothing else in the system
// reports these timestamps at all, so there is no second source for them to drift from.
//
// ── 🔒 A DATE WE COULD NOT READ IS NOT "NEVER" ───────────────────────────────────────────────────
// The same rule `adminUserAccount.ts` is built around. An Auth outage rendering "Joined —" is honest;
// rendering today's date, or an empty cell that reads like "never signed in", is not. Every resolved
// value therefore carries WHERE it came from, and `null` means unread, never zero.
//
// ── 🔒 COUNTS AND TIMESTAMPS ONLY — NEVER CONTENT ────────────────────────────────────────────────
// Nothing in this file returns the text of a chat, a prompt, or a clinical note. The published
// Privacy Policy says, in §3, "we do not read your projects out of curiosity — access by our team is
// restricted to what is needed to run the service, fix a defect you reported, or meet a legal duty",
// and §5 promises the Doctor AI surface is used "only to produce the assistance you asked for in that
// case, and to keep your own case history available to you". A browsable transcript viewer would
// contradict both. So the panel answers "how much, and when" — which is what a support or abuse
// decision actually turns on — and never "what did they say".

/** Everything the panel takes from a Firebase Auth user record. No name, no photo — see the note above. */
export interface AuthMeta {
  uid: string;
  /** Account creation, ms. Null when the record could not be read. */
  joinedAtMs: number | null;
  /** Last completed sign-in, ms. Null when unread or never. */
  lastSignInAtMs: number | null;
  /** Last session refresh, ms — the closest thing to "last active". Null when unread or absent. */
  lastRefreshAtMs: number | null;
  emailVerified: boolean;
  /** True when the account is disabled in Firebase Auth itself (separate from our own `banned` flag). */
  disabled: boolean;
  /** Sign-in methods actually on the account, e.g. `google.com`, `apple.com`, `phone`. */
  providers: string[];
  /** Present only when the user signed up by phone. '' when there is none. */
  phone: string;
}

/** The shape of a firebase-admin UserRecord, narrowed to what we read. Injected so this stays testable. */
export interface AuthUserRecordLike {
  uid?: unknown;
  emailVerified?: unknown;
  disabled?: unknown;
  phoneNumber?: unknown;
  providerData?: Array<{ providerId?: unknown }> | unknown;
  metadata?: { creationTime?: unknown; lastSignInTime?: unknown; lastRefreshTime?: unknown } | unknown;
}

function msFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Read one Auth record into the panel's shape. PURE. Anything unreadable becomes null/'', never a guess. */
export function parseAuthUserRecord(rec: AuthUserRecordLike | null | undefined): AuthMeta | null {
  const uid = String((rec as { uid?: unknown })?.uid ?? '').trim();
  if (!uid) return null;
  const meta = (rec?.metadata ?? {}) as { creationTime?: unknown; lastSignInTime?: unknown; lastRefreshTime?: unknown };
  const providerData = Array.isArray(rec?.providerData) ? rec.providerData : [];
  return {
    uid,
    joinedAtMs: msFrom(meta.creationTime),
    lastSignInAtMs: msFrom(meta.lastSignInTime),
    lastRefreshAtMs: msFrom(meta.lastRefreshTime),
    emailVerified: rec?.emailVerified === true,
    disabled: rec?.disabled === true,
    providers: providerData
      .map((p) => String((p as { providerId?: unknown })?.providerId ?? '').trim())
      .filter((p) => p.length > 0),
    phone: typeof rec?.phoneNumber === 'string' ? rec.phoneNumber : '',
  };
}

/**
 * Firebase Auth's `getUsers` takes at most 100 identifiers per call, so a page of users is several
 * calls. Exported because the batch size is the reason this module exists rather than a loop of
 * `getUser` — one read per user on a screen the admin refreshes is a real bill and a slow page.
 */
export const AUTH_BATCH_SIZE = 100;

/**
 * How many users one list request will enrich with Auth metadata.
 *
 * A bound rather than "all of them": the list route loads every wallet, and an unbounded enrichment
 * would turn one admin refresh into an unbounded number of Auth calls as the user base grows. Rows
 * past the cap keep their wallet-derived join date and report `lastActive` as unread — honestly
 * blank, never a fabricated date.
 */
export const AUTH_ENRICH_CAP = 500;

/** The injected Auth surface. Only `getUsers` is needed, which is what keeps this testable. */
export interface AuthBatchApi {
  getUsers(identifiers: Array<{ uid: string }>): Promise<{ users: AuthUserRecordLike[] }>;
}

/**
 * Resolve many uids to their Auth metadata, in batches.
 *
 * NEVER THROWS. A failed batch yields no entries for those uids, which the callers render as "unread"
 * — the list must still load when Auth is unreachable, exactly as it did before this existed. A
 * partial failure is partial data, not a blank page: each batch is settled on its own.
 */
export async function fetchAuthMetadata(
  uids: Array<string | null | undefined>,
  auth: AuthBatchApi | null,
  cap: number = AUTH_ENRICH_CAP,
): Promise<Map<string, AuthMeta>> {
  const out = new Map<string, AuthMeta>();
  const wanted = [...new Set(uids.map((u) => String(u ?? '').trim()).filter((u) => u.length > 0))]
    .slice(0, Math.max(0, cap));
  if (!auth || wanted.length === 0) return out;

  const batches: Array<Array<{ uid: string }>> = [];
  for (let i = 0; i < wanted.length; i += AUTH_BATCH_SIZE) {
    batches.push(wanted.slice(i, i + AUTH_BATCH_SIZE).map((uid) => ({ uid })));
  }
  const results = await Promise.allSettled(batches.map((b) => auth.getUsers(b)));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const rec of r.value?.users ?? []) {
      const parsed = parseAuthUserRecord(rec);
      if (parsed) out.set(parsed.uid, parsed);
    }
  }
  return out;
}

/** Where a resolved timestamp actually came from, so the screen can say so rather than imply precision. */
export type DateSource = 'auth' | 'wallet' | 'activity' | 'unread';

export interface ResolvedDate {
  /** ms, or null when we genuinely could not read it. Null is NOT "never". */
  atMs: number | null;
  source: DateSource;
}

/**
 * The account's join date: Auth's creation time, else the wallet's own `createdAt`.
 *
 * The wallet is second because a wallet can be re-created (see `welcomeBonus.ts`), which would make a
 * long-standing user look new. It is still offered, labelled, because a real-but-approximate date
 * beats an empty cell when Auth is unreachable.
 */
export function resolveJoinedAt(auth: AuthMeta | null | undefined, walletCreatedAt: unknown): ResolvedDate {
  if (auth?.joinedAtMs) return { atMs: auth.joinedAtMs, source: 'auth' };
  const fromWallet = msFrom(walletCreatedAt);
  if (fromWallet) return { atMs: fromWallet, source: 'wallet' };
  return { atMs: null, source: 'unread' };
}

/**
 * The account's last activity: the most recent of Auth's session refresh, Auth's last sign-in, and any
 * activity timestamp the caller already has (an AI request, say).
 *
 * The MAXIMUM rather than a priority order, deliberately: each of these is a real moment the user was
 * present, and reporting an older one because it came from a preferred source would understate the
 * account — on a screen where "dormant" is a reason to act. The wallet's `updatedAt` is accepted last
 * and only as a floor, because it moves solely when money moves.
 */
export function resolveLastActiveAt(
  auth: AuthMeta | null | undefined,
  opts: { walletUpdatedAt?: unknown; activityAtMs?: number | null } = {},
): ResolvedDate {
  const candidates: Array<{ atMs: number; source: DateSource }> = [];
  if (auth?.lastRefreshAtMs) candidates.push({ atMs: auth.lastRefreshAtMs, source: 'auth' });
  if (auth?.lastSignInAtMs) candidates.push({ atMs: auth.lastSignInAtMs, source: 'auth' });
  const activity = typeof opts.activityAtMs === 'number' && Number.isFinite(opts.activityAtMs) && opts.activityAtMs > 0
    ? opts.activityAtMs
    : null;
  if (activity) candidates.push({ atMs: activity, source: 'activity' });
  const walletAt = msFrom(opts.walletUpdatedAt);
  if (walletAt) candidates.push({ atMs: walletAt, source: 'wallet' });

  if (candidates.length === 0) return { atMs: null, source: 'unread' };
  return candidates.reduce((best, c) => (c.atMs > best.atMs ? c : best));
}

// ── Activity, without content ────────────────────────────────────────────────────────────────────

/** One `ai_usage_logs` row, narrowed. There is no message text in that collection and none is read. */
export interface AiUsageRow {
  tier?: unknown;
  createdAt?: unknown;
  outputTokens?: unknown;
}

export interface AiActivitySummary {
  /** How many AI chat requests we have a record of. */
  requests: number;
  /** The most recent one, ms. Null when there are none. */
  lastAtMs: number | null;
  /** Requests in the last 30 days — the difference between an active user and a dormant one. */
  last30Days: number;
  /** Which chat surface they use, busiest first. A tier name is ours, never a model or a vendor. */
  byTier: Array<{ tier: string; requests: number }>;
}

/**
 * Summarise a user's AI chat activity.
 *
 * COUNTS AND TIMES ONLY — see the file header. `ai_usage_logs` stores a tier, a timestamp and a token
 * count; the question the admin is really asking ("is this person using the product, and how much?")
 * is answered by exactly those, and the answer does not improve by reading what they typed.
 */
export function summariseAiActivity(rows: AiUsageRow[], nowMs: number = Date.now()): AiActivitySummary {
  const byTier = new Map<string, number>();
  let lastAtMs: number | null = null;
  let last30Days = 0;
  const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;

  for (const r of rows) {
    const tier = String(r?.tier ?? '').trim() || 'unknown';
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
    const at = msFrom(r?.createdAt);
    if (at) {
      if (lastAtMs === null || at > lastAtMs) lastAtMs = at;
      if (at >= cutoff) last30Days++;
    }
  }

  return {
    requests: rows.length,
    lastAtMs,
    last30Days,
    byTier: [...byTier.entries()]
      .map(([tier, requests]) => ({ tier, requests }))
      .sort((a, b) => b.requests - a.requests || a.tier.localeCompare(b.tier)),
  };
}

/** One stored device from `user_sessions`. The hashes are NOT returned — only what they let us count. */
export interface DeviceRow {
  uaHash?: unknown;
  ipHash?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
}

export interface DeviceSummary {
  /** How many distinct (browser + network) fingerprints we have seen. */
  devices: number;
  /** Distinct browsers, which is the signal that matters: many browsers on one account is unusual. */
  browsers: number;
  firstSeenMs: number | null;
  lastSeenMs: number | null;
}

/**
 * Summarise the devices bound to an account.
 *
 * 🔒 THE HASHES NEVER LEAVE THIS FUNCTION. `sessionTracker.ts` stores hashed User-Agents and hashed
 * IPs on purpose ("we store hashes, never raw IPs"), and re-publishing those hashes on an admin screen
 * would hand back a stable per-user tracking key for no decision-making benefit. A count of browsers
 * and the window they were seen in is what an admin can actually act on.
 */
export function summariseDevices(rows: DeviceRow[]): DeviceSummary {
  const browsers = new Set<string>();
  let firstSeenMs: number | null = null;
  let lastSeenMs: number | null = null;

  for (const r of rows) {
    const ua = String(r?.uaHash ?? '').trim();
    if (ua) browsers.add(ua);
    const first = msFrom(r?.firstSeen);
    if (first && (firstSeenMs === null || first < firstSeenMs)) firstSeenMs = first;
    const last = msFrom(r?.lastSeen);
    if (last && (lastSeenMs === null || last > lastSeenMs)) lastSeenMs = last;
  }

  return { devices: rows.length, browsers: browsers.size, firstSeenMs, lastSeenMs };
}

/** The user's own profile row, as the panel shows it back. Read-only — this screen never writes. */
export interface ProfileView {
  displayName: string;
  bio: string;
  phone: string;
  photoUrl: string;
  /** Their self-set monthly spend cap in ₹. 0 means they never set one. */
  budgetLimitInr: number;
  updatedAtMs: number | null;
}

/** Narrow a `user_profiles` document into the panel's shape. PURE. Absent fields stay empty, never invented. */
export function profileView(doc: Record<string, unknown> | null | undefined): ProfileView | null {
  if (!doc || typeof doc !== 'object') return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const budget = Number(doc.budgetLimitInr);
  const view: ProfileView = {
    displayName: str(doc.displayName),
    bio: str(doc.bio),
    phone: str(doc.phone),
    photoUrl: str(doc.photoUrl),
    budgetLimitInr: Number.isFinite(budget) && budget > 0 ? budget : 0,
    updatedAtMs: msFrom(doc.updatedAt),
  };
  // A profile row that exists but holds nothing the user actually filled in is the same, to an admin,
  // as no profile at all — and an empty card invites the reader to assume the query failed.
  const filled = view.displayName || view.bio || view.phone || view.photoUrl || view.budgetLimitInr > 0;
  return filled ? view : null;
}

// ── The one impure function: the real Firebase Auth handle ───────────────────────────────────────

/**
 * The live `getUsers` surface, or null when Auth is unavailable (VITEST, a missing credential, an
 * initialisation failure).
 *
 * Null rather than a throw, because every caller here treats "no Auth" as "these dates are unread"
 * and must keep rendering. It lives in this module so there is exactly ONE place that knows how the
 * panel reaches Auth, instead of the pattern being re-derived at each route.
 */
export async function firebaseAuthBatch(): Promise<AuthBatchApi | null> {
  if (process.env.VITEST) return null;
  try {
    const { loadFirebaseAdmin } = await import('./firebaseAdminModule');
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const auth = admin.auth();
    return { getUsers: (ids) => auth.getUsers(ids) as unknown as Promise<{ users: AuthUserRecordLike[] }> };
  } catch {
    return null;
  }
}
