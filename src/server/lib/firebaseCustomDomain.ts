// Firebase-native custom domains — connect a user's OWN domain directly to their
// "Host on NavBharatAI" (Firebase Hosting) site, with Firebase serving the site and
// auto-issuing the SSL certificate. This is the serving layer the design doc flagged as
// missing (NAVBHARATAI_PRO_V3_DESIGN.md): the earlier Cloudflare-for-SaaS flow provisioned a
// hostname + returned DNS records but nothing routed the domain to the user's published app.
//
// How Firebase custom domains actually work (why a dedicated site is needed):
//   - A custom domain attaches to a Firebase Hosting *site*, NOT to a preview *channel*.
//   - The default publish path puts each app on a preview channel of one shared site
//     (`<project>--<channel>.web.app`), which cannot carry a custom domain.
//   - So a custom-domain app gets its OWN dedicated Firebase Hosting site (multi-site), the
//     app is deployed to that site's LIVE channel, and the domain attaches to that site.
//
// Real API (firebasehosting v1beta1): projects.sites.customDomains.{create,get}. `create` returns
// a long-running Operation; the CustomDomain resource then exposes `requiredDnsUpdates` (the exact
// A/AAAA/TXT records the user must add), `ownershipState`, `hostState`, and `cert.state` — all of
// which we surface honestly. Nothing is faked: a domain reads "Live" only when Firebase reports
// ownership + host + cert all active.
//
// Config: Application Default Credentials (same as Deployment.ts). On Cloud Run the platform
// service account is used automatically; it needs the "Firebase Hosting Admin" role and the
// Firebase Hosting API enabled. When auth/permission is missing, callers surface an honest error —
// never a fake "connected" state.

import { GoogleAuth } from 'google-auth-library';
import * as crypto from 'crypto';
import { envFlag } from './envFlag';

const FIREBASE_PROJECT = process.env.FIREBASE_DEPLOY_PROJECT ?? 'gen-lang-client-0866594388';
const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';

// ── Public, UI-facing shapes ────────────────────────────────────────────────────────────────

/** A DNS record the user must add at their registrar (registrar-agnostic). */
export interface CustomDomainDnsRecord {
  type: string;   // 'A' | 'AAAA' | 'TXT' | 'CNAME'
  name: string;   // the host/record name (the domain, or a challenge subdomain)
  value: string;  // the record value (an IP, a TXT token, …)
  note?: string;  // a short human hint of what the record is for
}

/** Honest, serialisable status of a Firebase custom domain. */
export interface CustomDomainStatus {
  domain: string;
  /** True only when Firebase reports ownership + host + cert all ACTIVE (i.e. genuinely live). */
  active: boolean;
  ownershipState: string; // OWNERSHIP_PENDING | OWNERSHIP_ACTIVE | …
  hostState: string;      // HOST_PENDING | HOST_ACTIVE | HOST_BROKEN | …
  sslState: string;       // CERT_PENDING | CERT_ACTIVE | CERT_BROKEN | …
  records: CustomDomainDnsRecord[]; // the records still needed to finish the connection
  /**
   * WHAT FIREBASE ITSELF SAYS IS WRONG — and until 2026-08-21 we threw it away.
   *
   * ROOT CAUSE (admin, connecting mitrify.com): the screen said `ownership: missing` while all three
   * required records were live and byte-perfect in public DNS. The API response carries an `issues[]`
   * of `google.rpc.Status` explaining exactly why a domain is stuck — and we parsed `ownershipState`
   * and dropped the field that would have answered the question. So a state with a real, printed
   * reason reached the user as one unexplained word, and the only way to find out more was to read
   * DNS by hand. Never diagnose from a status enum when the API also shipped the reason.
   */
  issues: string[];
  /**
   * When Firebase LAST looked at the user's DNS (`requiredDnsUpdates.checkTime`).
   *
   * This is what makes the "Check now" button honest. That button re-reads Firebase's answer; it
   * cannot force Firebase to re-run its own DNS sweep. Without this timestamp the two are
   * indistinguishable, so a user whose records were already correct pressed it over and over,
   * believing nothing was happening.
   */
  lastCheckedAt: string;
}

// ── Raw API shape (only the fields we read) ─────────────────────────────────────────────────

interface ApiDnsRecord {
  domainName?: string;
  type?: string;
  /** REAL API field (v1beta1 discovery, verified 2026-08-06): a single STRING per record. */
  rdata?: string | string[];
  /** Legacy tolerance only — never seen on the live API. */
  rrdata?: string[];
  requiredAction?: string; // NONE | ADD | REMOVE (records with ADD are the ones to add)
}
interface ApiDnsRecordSet {
  domainName?: string;
  records?: ApiDnsRecord[];
}
/** REAL shape (discovery doc): `desired`/`discovered` arrays of DnsRecordSet. */
interface ApiDnsUpdates {
  checkTime?: string;
  desired?: ApiDnsRecordSet[];
  discovered?: ApiDnsRecordSet[];
  /** Legacy tolerance — the field name this module INVENTED and read until 2026-08-06 (see below). */
  desiredDnsState?: ApiDnsRecordSet[];
}
/** `google.rpc.Status` — Firebase's own explanation of why a domain is stuck. */
interface ApiIssue { code?: number; message?: string }
interface ApiCustomDomain {
  name?: string;
  customDomainId?: string;
  ownershipState?: string;
  hostState?: string;
  /** `cert.verification.dns` carries the ACME challenge once ownership advances to cert issuance. */
  cert?: { state?: string; verification?: { dns?: ApiDnsUpdates }; issues?: ApiIssue[] };
  requiredDnsUpdates?: ApiDnsUpdates;
  /** The field this module ignored until 2026-08-21 — see `CustomDomainStatus.issues`. */
  issues?: ApiIssue[];
}

// ── Pure helpers (unit-testable without any live API) ───────────────────────────────────────

/**
 * A stable, valid Firebase Hosting site id for a workspace. Firebase site ids must be lowercase,
 * `[a-z0-9-]`, ≤ 30 chars, and must not start/end with a hyphen. We derive it from a hash of the
 * FULL workspaceId so it is unique per workspace AND identical on every redeploy of that workspace
 * (same failure class the channel-id fix guarded against — never a truncated prefix collision).
 */
export function siteIdForWorkspace(workspaceId: string): string {
  const hash = crypto.createHash('sha256').update(workspaceId).digest('hex').slice(0, 20);
  return `nbai-${hash}`; // 5 + 20 = 25 chars, always [a-z0-9-], no leading/trailing hyphen
}

/** Normalise a user-entered domain (strip scheme/path/trailing dot, lowercase). */
export function normalizeDomain(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

const NOTE_BY_TYPE: Record<string, string> = {
  A: 'Points your domain to NavBharatAI',
  AAAA: 'Points your domain to NavBharatAI (IPv6)',
  TXT: 'Proves you own the domain / validates SSL',
  CNAME: 'Points your domain to NavBharatAI',
};

/**
 * Map a CustomDomain API resource to the exact DNS records the user still needs to add.
 *
 * ROOT CAUSE FIX (admin 2026-08-06, mitrify.in "0 records applied / records being prepared
 * forever"): this function used to read `requiredDnsUpdates.desiredDnsState[]` and `rrdata[]` —
 * field names that DO NOT EXIST on the real API. Verified against Google's own v1beta1 discovery
 * document: the fields are `requiredDnsUpdates.desired[]` (DnsRecordSet) and `DnsRecord.rdata`
 * (a single STRING). Against the live API the old code therefore ALWAYS returned [] — the UI showed
 * "records being prepared" forever, auto-DNS applied 0 records, and ownership could never advance.
 * The invented names are kept as legacy tolerance only.
 *
 * Sources, both surfaced: `requiredDnsUpdates.desired` (ownership/host records) AND
 * `cert.verification.dns.desired` (the ACME TXT challenge once cert issuance starts) — deduped, so
 * the user/auto-DNS always holds the complete current instruction set. Records whose
 * `requiredAction` is ADD are the instructions; if the API omits the flag entirely we conservatively
 * surface every desired record.
 */
export function customDomainRecords(cd: ApiCustomDomain): CustomDomainDnsRecord[] {
  const updates: ApiDnsUpdates[] = [cd.requiredDnsUpdates, cd.cert?.verification?.dns]
    .filter((u): u is ApiDnsUpdates => !!u);
  const out: CustomDomainDnsRecord[] = [];
  const seen = new Set<string>();
  for (const upd of updates) {
    const sets = upd.desired ?? upd.desiredDnsState ?? [];
    const anyActionFlagged = sets.some((s) => (s.records ?? []).some((r) => !!r.requiredAction));
    for (const set of sets) {
      for (const rec of set.records ?? []) {
        const action = (rec.requiredAction || '').toUpperCase();
        // Skip records that are already correct or must be removed — only ADD is an instruction.
        if (anyActionFlagged && action !== 'ADD') continue;
        // rdata is a STRING on the real API; arrays are accepted as legacy tolerance.
        const values = Array.isArray(rec.rrdata) ? rec.rrdata
          : Array.isArray(rec.rdata) ? rec.rdata
          : typeof rec.rdata === 'string' && rec.rdata ? [rec.rdata] : [];
        const type = (rec.type || '').toUpperCase();
        for (const value of values) {
          if (!value) continue;
          // The API writes names with a trailing dot (`foo.bar.com.`) — normalize, or every
          // downstream consumer (UI copy button, Cloudflare, Hostinger) carries the dot.
          const name = (rec.domainName || set.domainName || cd.customDomainId || '').replace(/\.$/, '');
          const key = `${type}|${name}|${value}`;
          if (seen.has(key)) continue; // the ACME TXT can appear in both sources — one instruction
          seen.add(key);
          out.push({ type, name, value, note: NOTE_BY_TYPE[type] });
        }
      }
    }
  }
  return out;
}

/**
 * Every reason Firebase gave, from BOTH places it puts them — the domain's own `issues[]` and the
 * certificate's. De-duplicated and trimmed; an entry with no message is dropped rather than shown as
 * an empty bullet. PURE.
 */
export function customDomainIssues(cd: ApiCustomDomain): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of [...(cd.issues ?? []), ...(cd.cert?.issues ?? [])]) {
    const msg = String(i?.message ?? '').trim();
    if (!msg || seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out;
}

/** Map a CustomDomain API resource to an honest status (active only when genuinely live). */
export function customDomainStatus(domain: string, cd: ApiCustomDomain): CustomDomainStatus {
  const ownershipState = cd.ownershipState || 'OWNERSHIP_PENDING';
  const hostState = cd.hostState || 'HOST_PENDING';
  const sslState = cd.cert?.state || 'CERT_PENDING';
  const active =
    ownershipState === 'OWNERSHIP_ACTIVE' &&
    hostState === 'HOST_ACTIVE' &&
    sslState === 'CERT_ACTIVE';
  return {
    domain, active, ownershipState, hostState, sslState,
    records: customDomainRecords(cd),
    issues: customDomainIssues(cd),
    // Both sources carry a checkTime; the freshest one is the honest answer to "when did it last look?"
    lastCheckedAt: [cd.requiredDnsUpdates?.checkTime, cd.cert?.verification?.dns?.checkTime]
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .sort()
      .pop() ?? '',
  };
}

// ── Live API (needs ADC; cannot be exercised in the dev sandbox — fails honestly) ───────────

let _auth: GoogleAuth | null = null;
function auth(): GoogleAuth {
  if (!_auth) _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });
  return _auth;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth().getAccessToken();
  if (!token) {
    throw new Error(
      'Could not obtain a Google auth token for Firebase Hosting. On Cloud Run this works ' +
      'automatically; locally set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with ' +
      'the "Firebase Hosting Admin" role.',
    );
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** An api() failure carrying the STRUCTURED status, so callers never string-match prose. */
export class HostingApiError extends Error {
  constructor(message: string, public httpStatus: number, public apiStatus?: string) { super(message); }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${HOSTING_API}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (data as any)?.error?.message || `Firebase Hosting API error (HTTP ${res.status})`;
    // ROOT CAUSE of "sabhi website ke liye" (admin screenshots 2026-08-06, closed BY the detail line
    // this same incident added): callers used to regex the MESSAGE for 'HTTP 404|NOT_FOUND', but
    // Google's real text reads `Custom Domain "…" not found.` — lowercase, spaced — so the pre-attach
    // existence probe treated its perfectly NORMAL "new domain, nothing here yet" answer as a fatal
    // error and aborted before customDomains.create ever ran. Status is now carried as DATA.
    throw new HostingApiError(msg, res.status, (data as any)?.error?.status);
  }
  return data as T;
}

/**
 * Ensure a dedicated Firebase Hosting site exists for this workspace (multi-site). Idempotent: a
 * 409 (already exists) is treated as success. Returns the site id.
 */
/**
 * HAS ANYTHING EVER BEEN PUBLISHED TO THIS APP'S SITE? — asked of FIREBASE, not of the domain.
 *
 * WHY THIS EXISTS (admin, mitrify.com, 2026-08-21 — the SECOND time this exact confusion happened).
 * A custom domain attaches to the app's own Hosting SITE, and `deployToSite` only runs during a
 * publish. A domain connected AFTER the last publish therefore points at a site with NO RELEASE, and
 * Firebase serves its "Site Not Found" page — while ownership, host and SSL are all genuinely active.
 *
 * The first attempt at telling the user this OPENED the domain over HTTP and looked for that page.
 * That works when it works, and it did not: our server could not reach mitrify.com at the moment of
 * the check, the result came back `unknown`, and — by my own explicit choice — `unknown` still printed
 * **"Live!"** over a domain the admin was looking at showing an error. That choice was wrong, and this
 * is the fix for the cause rather than the symptom.
 *
 * 🔒 THIS ANSWER IS AUTHORITATIVE AND NEEDS NO EGRESS TO THE USER'S DOMAIN. It uses the credentials we
 * already hold, asks the service that would serve the page, and a site with zero releases has
 * unambiguously never been published to. `null` means we could not ask — never "no".
 */
export async function siteHasRelease(workspaceId: string): Promise<boolean | null> {
  const siteId = siteIdForWorkspace(workspaceId);
  try {
    const r = await api<{ releases?: unknown[] }>(`/sites/${encodeURIComponent(siteId)}/releases?pageSize=1`);
    return Array.isArray(r?.releases) && r.releases.length > 0;
  } catch (err) {
    // A site that does not exist yet has certainly never been published to — that is a real answer,
    // not a failure to get one.
    if (err instanceof HostingApiError && (err.httpStatus === 404 || err.apiStatus === 'NOT_FOUND')) return false;
    return null;   // anything else: we could not ask. Silence is not a verdict.
  }
}

export async function ensureSite(workspaceId: string): Promise<string> {
  const siteId = siteIdForWorkspace(workspaceId);
  try {
    await api(`/projects/${FIREBASE_PROJECT}/sites?siteId=${encodeURIComponent(siteId)}`, {
      method: 'POST',
      body: {},
    });
  } catch (err) {
    // Already exists → idempotent success. Structured status first (the not-found lesson: Google's
    // prose and its status enums do not spell things the same way); prose only as a fallback.
    const dup = (err instanceof HostingApiError && (err.httpStatus === 409 || err.apiStatus === 'ALREADY_EXISTS'))
      || /already exists|HTTP 409|ALREADY_EXISTS/i.test(err instanceof Error ? err.message : String(err));
    if (!dup) throw err;
  }
  return siteId;
}

/** Attach (or return the existing) custom domain on the workspace's dedicated site. */
export async function attachCustomDomain(workspaceId: string, domain: string): Promise<CustomDomainStatus> {
  // ROOT CAUSE of "Failed to start domain connection" (admin 2026-08-02, mitrify.xyz): this function
  // assumed the workspace's dedicated site already existed — but the site is only created by the
  // DEPLOY path (Deployment.ts). A user who connects a domain BEFORE a dedicated-site deploy (e.g.
  // their app was published via the instant /pwa hosting instead) hit `customDomains.create` on a
  // NONEXISTENT site → Google API 404 → 500. The site must be ensured HERE too — ensureSite is
  // idempotent (409 = success), so a site the deploy path already created is simply reused.
  const siteId = await ensureSite(workspaceId);
  const existing = await getCustomDomainRaw(siteId, domain);
  if (existing) return customDomainStatus(domain, existing);
  await api(
    `/projects/${FIREBASE_PROJECT}/sites/${siteId}/customDomains?customDomainId=${encodeURIComponent(domain)}`,
    { method: 'POST', body: {} },
  );
  // create returns a long-running Operation; read the resource back for its DNS records + state.
  const cd = (await getCustomDomainRaw(siteId, domain)) ?? {};
  return customDomainStatus(domain, cd);
}

async function getCustomDomainRaw(siteId: string, domain: string): Promise<ApiCustomDomain | null> {
  try {
    return await api<ApiCustomDomain>(
      `/projects/${FIREBASE_PROJECT}/sites/${siteId}/customDomains/${encodeURIComponent(domain)}`,
    );
  } catch (err) {
    if (isNotFound(err)) return null;   // a domain not attached YET is the normal starting state
    throw err;
  }
}

/**
 * "This resource does not exist" — judged by structured status first, prose only as a last resort.
 * Pure, exported for tests: the exact live failure was Google's `… not found.` message slipping past
 * a `NOT_FOUND` regex, which made every fresh domain look like a fatal error.
 */
export function isNotFound(err: unknown): boolean {
  if (err instanceof HostingApiError) {
    return err.httpStatus === 404 || err.apiStatus === 'NOT_FOUND';
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /HTTP 404|NOT_FOUND|not\s+found/i.test(msg);
}

/**
 * Detach a custom domain from its workspace's site (plan-lapse enforcement — admin 2026-08-06:
 * "recharge khatam to website down"). Already-absent counts as success: the desired end state is
 * "not serving", and a repeat sweep must be idempotent.
 */
export async function deleteCustomDomain(workspaceId: string, domain: string): Promise<boolean> {
  const siteId = siteIdForWorkspace(workspaceId);
  try {
    await api(
      `/projects/${FIREBASE_PROJECT}/sites/${siteId}/customDomains/${encodeURIComponent(domain)}`,
      { method: 'DELETE' },
    );
    return true;
  } catch (err) {
    if (isNotFound(err)) return true;
    throw err;
  }
}

/** Poll the current status of a workspace's custom domain (null if never attached). */
export async function customDomainStatusLive(
  workspaceId: string,
  domain: string,
): Promise<CustomDomainStatus | null> {
  const siteId = siteIdForWorkspace(workspaceId);
  const cd = await getCustomDomainRaw(siteId, domain);
  return cd ? customDomainStatus(domain, cd) : null;
}

/**
 * Classify a custom-domain failure into an HONEST, user-facing message.
 *
 * ROOT CAUSE (admin 2026-08-02): every failure surfaced the same "Failed to start domain connection.
 * Please try again." — including PERMANENT ones. Telling a user to retry something that can never
 * succeed by retrying is a dishonest instruction (rule 3) and leaves them looping forever. The real
 * classes need different answers, and only some of them are "try again":
 *   • permission/auth   — the server isn't allowed to create the domain yet ⇒ ADMIN action, not a retry.
 *   • already-taken     — the domain is attached elsewhere ⇒ the USER must free it; a retry won't help.
 *   • quota/rate        — genuinely temporary ⇒ wait, then retry.
 *   • invalid/not-found — the input is wrong ⇒ fix the spelling.
 * Pure + unit-tested; never leaks the raw API text (the real detail stays in the server log).
 */
export function customDomainErrorMessage(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (/permission|denied|forbidden|unauthorized|403|401|iam|scope|credential|auth token/.test(raw)) {
    return 'Custom domains are not switched on for this server yet — our team has to enable it. Retrying will not help; please contact support.';
  }
  if (/already (exists|owned|in use)|taken|conflict|409/.test(raw)) {
    return 'That domain is already connected to another site. Remove it there first, then connect it here.';
  }
  if (/quota|rate|429|resource_exhausted/.test(raw)) {
    return 'Too many domain requests right now. Please wait a few minutes and try again.';
  }
  if (/invalid|not.?found|400|404/.test(raw)) {
    // The route validates the domain's SHAPE before any API call — so by the time an
    // invalid/not-found lands here, the spelling is provably NOT the problem, and telling the user
    // to fix it would be a false accusation that hides a server-side gap (admin 2026-08-06:
    // mitrify.in, a perfectly valid domain, was told to "check the spelling" for every attempt).
    return 'The hosting service rejected this domain request. Your domain name looks valid — this is usually a setup gap on our side, not yours. Try once more; if it repeats, use Report and we will fix it.';
  }
  return 'Could not start the domain connection. Please try again in a moment.';
}

/**
 * The REAL failure, bounded and stripped of infra identifiers, for the workspace OWNER's screen.
 * The connect route is ownership-checked, so only the app's owner can ever read it — and a failure
 * that names its cause is the difference between a fixable report and a dead screenshot (the
 * terminal's whole 2026-08-05 lesson). Project ids and vendor branding are neutralized; the full raw
 * text still goes to the server log.
 */
export function sanitizeDomainErrorDetail(err: unknown): string {
  const msg = err instanceof Error && err.message ? err.message : String(err ?? '');
  return msg
    .replace(/gen-lang-client-[0-9]+/gi, '[project]')
    .replace(/firebase/gi, 'hosting')
    .slice(0, 240);
}

/** True when Firebase Hosting deploys are available (ADC present). Mirrors the deploy provider. */
export function firebaseHostingConfigured(): boolean {
  // On Cloud Run ADC is always present (the platform service account). We cannot cheaply prove the
  // IAM role here; a missing role surfaces as an honest error at call time, never a fake success.
  return true;
}

/**
 * Master flag for the Firebase-native custom-domain feature (Slice 2). OFF by default so merging the
 * code changes nothing in production until the admin deliberately enables it AND runs the one live
 * test. When off: the connect routes return an honest "not enabled" and the deploy path never
 * publishes to a dedicated site (byte-identical to today).
 */
export function firebaseCustomDomainsEnabled(): boolean {
  return envFlag('AGENTV3_FIREBASE_CUSTOM_DOMAINS');
}
