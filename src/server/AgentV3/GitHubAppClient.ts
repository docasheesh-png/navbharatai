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
  return process.env.GITHUB_STORAGE_ENABLED === 'true' && githubStorageEnabled();
}

/** A deterministic, GitHub-safe repo name for a user's project (alnum, -, _ only; bounded). */
export function repoNameForProject(userId: string | null | undefined, projectId: string): string {
  const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const u = safe(userId || 'anon').slice(0, 24) || 'anon';
  const p = safe(projectId).slice(0, 60) || 'app';
  return `app-${u}-${p}`.slice(0, 90);
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
