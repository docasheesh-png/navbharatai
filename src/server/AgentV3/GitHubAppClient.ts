// AgentV3 — GitHub App client (Phase 1 of git-native storage).
//
// Lets the platform act as its own GitHub App ("NavBharatAI Builder") to store each user's project
// as a real git repo in the platform org. This is the durable, ~free source of truth that replaces
// "files vanish when the sandbox is lost": the sandbox becomes a disposable clone, every edit a
// commit. (Phase 2 wires this into the build loop; this module is standalone + flag-gated OFF.)
//
// Auth flow (no extra deps — Node crypto + fetch):
//   1. Sign a short-lived RS256 JWT with the App private key (iss = App ID).
//   2. JWT → the org installation id → an installation access token (1h, cached).
//   3. Use the installation token for the REST API + as the git credential.
//
// Everything is injectable (fetch + clock + config) so it is fully unit-testable without GitHub.

import * as crypto from 'crypto';
import { envFlag } from '../lib/envFlag';

const GITHUB_API = 'https://api.github.com';
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NavBharatAI-Builder' };

export interface GitHubConfig {
  appId: string;
  /** The App private key PEM (literal `\n` in an env var is normalised to real newlines). */
  privateKey: string;
  org: string;
}

export interface RepoInfo {
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  /** True when this call created the repo (vs reused an existing one). */
  created: boolean;
}

interface ClientDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Read the GitHub App config from env. Returns null unless ALL three are set (storage stays off). */
export function githubConfigFromEnv(): GitHubConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const org = process.env.GITHUB_ORG;
  if (!appId || !privateKey || !org) return null;
  return { appId, privateKey: privateKey.replace(/\\n/g, '\n'), org };
}

/** Whether git-native storage is CONFIGURED (the admin completed Phase 0 — secrets present). */
export function githubStorageEnabled(): boolean {
  return githubConfigFromEnv() !== null;
}

/**
 * Whether git-native storage is ACTIVE in the build loop. Requires the secrets AND an explicit
 * GITHUB_STORAGE_ENABLED=true opt-in — so the feature ships DORMANT even after Phase 0, and the
 * admin turns it on only when ready to test (strangler-fig; the live build path is never changed
 * by merely having the secrets set).
 */
export function githubStorageActive(): boolean {
  return envFlag('GITHUB_STORAGE_ENABLED') && githubStorageEnabled();
}

/** Slugify any string into a GitHub-safe segment (alnum, -, _ only; collapsed; lowercased). */
function slugSegment(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Format an epoch-ms as a readable `<dd><mon><yy>-<hhmm><am|pm>` date-and-time stamp in IST
 * (Asia/Kolkata, a fixed +5:30 offset with no DST, so this is deterministic without a timezone
 * library). e.g. an 11:00 IST build on 18 Jul 2026 → `18jul26-1100am`. Date first, then the time to
 * the MINUTE, so a user reading a repo name sees exactly when it was saved (admin 2026-08-10: repo
 * names must show a clear date and time). Exported + pure so it is unit-testable.
 */
export function readableTimeStamp(epochMs: number): string {
  const ist = new Date(epochMs + 5.5 * 3_600_000); // shift the instant so UTC getters read IST wall-clock
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mon = MONTH_ABBR[ist.getUTCMonth()];
  const yy = String(ist.getUTCFullYear()).slice(-2);
  let h = ist.getUTCHours();
  const ampm = h < 12 ? 'am' : 'pm';
  h = h % 12;
  if (h === 0) h = 12;
  const hh = String(h).padStart(2, '0');
  const min = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dd}${mon}${yy}-${hh}${min}${ampm}`;
}

/** A short, STABLE, collision-resistant token derived from the project id (6 hex of sha1). Pure. */
function projectUniqSuffix(projectId: string): string {
  return crypto.createHash('sha1').update(projectId || 'app').digest('hex').slice(0, 6);
}

/**
 * The SINGLE leading word of a slug (admin 2026-08-10: a saved repo's name must be one word, not the
 * whole phrase — `watch-store-landing-page` was too complicated). Takes the first `-` token; if that
 * token is too short to mean anything on its own (e.g. `e` from `e-commerce`), it keeps the next token
 * so the name stays recognisable. Pure. Returns '' for an empty/symbol-only slug (caller then falls
 * back to the legacy shape). */
function firstWordSegment(slug: string): string {
  const parts = (slug || '').split('-').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts[0].length < 3 && parts[1]) return `${parts[0]}-${parts[1]}`;
  return parts[0];
}

/**
 * A deterministic, GitHub-safe repo name for a user's project (alnum, -, _ only; bounded).
 *
 * TWO shapes:
 *  - LEGACY (no `readable` arg): `app-<uid>-<projectId>` — the opaque, hard-to-read form.
 *  - READABLE (admin 2026-07-18; SIMPLIFIED 2026-08-10): `<word>-<ddmonyy>-<hhmm><am|pm>-<uniq>`,
 *    e.g. `watch-18jul26-1100am-3f9a`. Just three human parts: a SINGLE-word app name, then the date
 *    and time it was saved, then a tiny safety code. (The old form was the whole phrase plus an
 *    hour-only stamp plus a 6-char code — `watch-store-landing-page-11am-180726-3f9a2c` — which the
 *    admin found too complicated.) The word/date/time come from the build's OWN stable identity (its
 *    stored title + createdAt — NOT the current turn's prompt, which changes per turn), so the name is
 *    READABLE yet STABLE across every build turn (the storage layer's ensureRepo is keyed on the name,
 *    so an unstable name would spawn a NEW repo each turn — the very sprawl this must avoid).
 *    The short sha1(projectId) tail is the DATA-SAFETY guard, not decoration: two different projects
 *    with the same word created in the same minute must never collide into ONE repo (which would mix
 *    one user's code into another's). Minute-level time precision (60× the old hour buckets) is what
 *    lets the tail shrink from 6 to 4 hex without weakening that guarantee. Kept, not dropped.
 */
export function repoNameForProject(
  userId: string | null | undefined,
  projectId: string,
  readable?: { appName: string; createdAtMs: number },
): string {
  const appWord = readable ? firstWordSegment(slugSegment(readable.appName)).slice(0, 24) : '';
  if (readable && appWord) {
    const stamp = readableTimeStamp(readable.createdAtMs);
    const uniq = projectUniqSuffix(projectId).slice(0, 4);
    return `${appWord}-${stamp}-${uniq}`.slice(0, 90);
  }
  const u = slugSegment(userId || 'anon').slice(0, 24) || 'anon';
  const p = slugSegment(projectId).slice(0, 60) || 'app';
  return `app-${u}-${p}`.slice(0, 90);
}

/**
 * The READABLE app name to build a mirror repo name from.
 *
 * ROOT CAUSE (mitrify import autopsy 2026-07-27, buildId 321f4f6c): the readable name came only from
 * `deriveTitle(prompt)`. On an IMPORT turn the prompt is an instruction, not an app name — "Import this
 * app from my GitHub repository and give me a short survey…" — so the user's mirror repo was created as
 * `import-this-app-from-my-github-repositor-10pm-270726-609c45` for an app literally called **mitrify**.
 * That is a real, permanent artifact in the user's own GitHub account, and no amount of later renaming
 * un-confuses it. When this turn imports a repo, that repo's OWN name is the single best, most stable
 * identity available — strictly better than any title derived from instruction text. So: imported repo
 * name wins; otherwise fall back to the stored/derived title exactly as before.
 *
 * Deliberately ignores a title that is merely an instruction echo when a real repo name exists — an
 * imported project's identity is the repo, not the sentence that asked for it. PURE + tested.
 */
export function readableAppNameForRepo(opts: {
  /** `{ owner, repo }` of the repo being imported this turn, if any. */
  importedRepo?: { owner: string; repo: string } | null;
  /** The build's stored/derived title (today's source). */
  fallbackTitle: string;
}): string {
  const repo = opts.importedRepo?.repo;
  if (repo && slugSegment(repo)) return repo;
  return opts.fallbackTitle;
}

function base64url(input: crypto.BinaryLike): string {
  return Buffer.from(input as Buffer).toString('base64url');
}

export class GitHubAppClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cachedToken: { token: string; expiresAtMs: number } | null = null;

  constructor(private readonly cfg: GitHubConfig, deps: ClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
  }

  /** A short-lived (≤10 min) RS256 App JWT, signed with the App private key. */
  createAppJwt(): string {
    const nowSec = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: this.cfg.appId }));
    const signingInput = `${header}.${payload}`;
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(this.cfg.privateKey);
    return `${signingInput}.${base64url(signature)}`;
  }

  /** An installation access token for the org (cached until ~30s before expiry). */
  async getInstallationToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs - 30_000 > this.now()) {
      return this.cachedToken.token;
    }
    const jwt = this.createAppJwt();
    const inst = await this.request<{ id: number }>('GET', `/orgs/${this.cfg.org}/installation`, `Bearer ${jwt}`);
    if (!inst.ok || !inst.body?.id) {
      throw new Error(`GitHub App is not installed on org "${this.cfg.org}" (HTTP ${inst.status}).`);
    }
    const tok = await this.request<{ token: string; expires_at: string }>(
      'POST', `/app/installations/${inst.body.id}/access_tokens`, `Bearer ${jwt}`,
    );
    if (!tok.ok || !tok.body?.token) {
      throw new Error(`Could not get a GitHub installation token (HTTP ${tok.status}).`);
    }
    this.cachedToken = { token: tok.body.token, expiresAtMs: Date.parse(tok.body.expires_at) || this.now() + 50 * 60_000 };
    return this.cachedToken.token;
  }

  /** Get the org repo if it exists, else create it (private, auto-init). Idempotent. */
  async ensureRepo(name: string): Promise<RepoInfo> {
    const token = await this.getInstallationToken();
    const got = await this.request<RepoApi>('GET', `/repos/${this.cfg.org}/${name}`, `token ${token}`);
    if (got.ok && got.body) return toRepoInfo(got.body, false);
    if (got.status !== 404) {
      throw new Error(`ensureRepo: unexpected GET /repos response (HTTP ${got.status}).`);
    }
    const created = await this.request<RepoApi>('POST', `/orgs/${this.cfg.org}/repos`, `token ${token}`, {
      name, private: true, auto_init: true, description: 'Built with NavBharatAI Pro v5.0',
    });
    if (!created.ok || !created.body) {
      throw new Error(`ensureRepo: could not create repo "${name}" (HTTP ${created.status}).`);
    }
    return toRepoInfo(created.body, true);
  }

  /** A clone/push URL that carries the installation token as the git credential. */
  authedCloneUrl(name: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${this.cfg.org}/${name}.git`;
  }

  /**
   * Open a PR (head → base). Idempotent: if an open PR already exists for that head/base GitHub
   * returns 422, and we look it up and return the existing one instead of failing.
   */
  async openPullRequest(repo: string, head: string, base: string, title: string, body: string): Promise<PullRequestInfo> {
    const token = await this.getInstallationToken();
    const created = await this.request<PullApi>('POST', `/repos/${this.cfg.org}/${repo}/pulls`, `token ${token}`, { title, head, base, body });
    if (created.ok && created.body?.number) return toPullInfo(created.body);
    // 422 = a PR for this head/base already exists (or no diff). Reuse the open one if present.
    if (created.status === 422) {
      const existing = await this.request<PullApi[]>('GET', `/repos/${this.cfg.org}/${repo}/pulls?head=${encodeURIComponent(`${this.cfg.org}:${head}`)}&base=${encodeURIComponent(base)}&state=open`, `token ${token}`);
      const first = Array.isArray(existing.body) ? existing.body[0] : undefined;
      if (existing.ok && first?.number) return toPullInfo(first);
    }
    throw new Error(`openPullRequest: could not open PR ${head}→${base} on "${repo}" (HTTP ${created.status}).`);
  }

  /**
   * The combined CI verdict for a ref: 'success' | 'pending' | 'failure', or 'none' when the repo
   * has NO checks configured at all (the common case for a freshly-created project repo — then it
   * is safe to merge immediately). Considers BOTH the legacy commit-status API and GitHub Actions
   * check-runs, so either CI style is honoured.
   */
  async combinedStatus(repo: string, ref: string): Promise<CiVerdict> {
    const token = await this.getInstallationToken();
    const status = await this.request<{ state?: string; total_count?: number }>('GET', `/repos/${this.cfg.org}/${repo}/commits/${ref}/status`, `token ${token}`);
    const checks = await this.request<{ check_runs?: Array<{ status?: string; conclusion?: string }> }>('GET', `/repos/${this.cfg.org}/${repo}/commits/${ref}/check-runs`, `token ${token}`);
    const statusCount = status.body?.total_count ?? 0;
    const runs = checks.body?.check_runs ?? [];
    if (statusCount === 0 && runs.length === 0) return 'none';
    // Any failure anywhere → failure. Any not-yet-complete → pending. Else success.
    const runFailed = runs.some((r) => r.status === 'completed' && r.conclusion != null && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    const runPending = runs.some((r) => r.status !== 'completed');
    if (status.body?.state === 'failure' || status.body?.state === 'error' || runFailed) return 'failure';
    if (status.body?.state === 'pending' || runPending) return 'pending';
    return 'success';
  }

  /** Merge a PR. Returns true when GitHub reports it merged. */
  async mergePullRequest(repo: string, number: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> {
    const token = await this.getInstallationToken();
    const merged = await this.request<{ merged?: boolean }>('PUT', `/repos/${this.cfg.org}/${repo}/pulls/${number}/merge`, `token ${token}`, { merge_method: method });
    return merged.ok && merged.body?.merged === true;
  }

  private async request<T>(method: string, path: string, auth: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: { ...API_HEADERS, Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed: T | null = null;
    try { parsed = (await res.json()) as T; } catch { parsed = null; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsed };
  }
}

interface RepoApi {
  full_name?: string;
  clone_url?: string;
  html_url?: string;
  default_branch?: string;
}

function toRepoInfo(r: RepoApi, created: boolean): RepoInfo {
  return {
    fullName: r.full_name ?? '',
    cloneUrl: r.clone_url ?? '',
    htmlUrl: r.html_url ?? '',
    defaultBranch: r.default_branch ?? 'main',
    created,
  };
}

/** A combined CI verdict for a commit/PR head. 'none' = the repo has no checks configured. */
export type CiVerdict = 'success' | 'pending' | 'failure' | 'none';

export interface PullRequestInfo {
  number: number;
  htmlUrl: string;
  headSha: string;
}

interface PullApi {
  number?: number;
  html_url?: string;
  head?: { sha?: string };
}

function toPullInfo(p: PullApi): PullRequestInfo {
  return { number: p.number ?? 0, htmlUrl: p.html_url ?? '', headSha: p.head?.sha ?? '' };
}
