// AgentV3 — user-owned git-native storage (the user's OWN GitHub account).
//
// When a user signs in with GitHub, NavBharatAI captures their OAuth token (repo + workflow scopes).
// This client uses THAT token to store the user's project in a repo under THEIR OWN account — not the
// platform org. That is the "no lock-in, your code is literally in your GitHub" promise: the user owns
// the repo, NavBharatAI just builds, commits, opens PRs and (CI-green) merges into it like Claude Code.
//
// Mirrors GitHubAppClient's REST conventions but authenticates as the user (token), with the user's
// login as the repo owner. Implements PrCapableClient so it plugs straight into mergeViaPullRequest.
// Everything is injectable (fetch) so it is fully unit-testable without GitHub.

import type { CiVerdict, PullRequestInfo, RepoInfo } from './GitHubAppClient';
import type { PrCapableClient } from './GitHubPrFlow';

const GITHUB_API = 'https://api.github.com';
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NavBharatAI-Builder' };

interface UserClientDeps {
  fetchImpl?: typeof fetch;
}

/** A GitHub client that acts AS THE USER (their OAuth token), storing projects in the user's account. */
export class UserGitHubClient implements PrCapableClient {
  private readonly fetchImpl: typeof fetch;
  private cachedLogin: string | null = null;

  constructor(private readonly token: string, deps: UserClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  /** The authenticated user's login (the repo owner). Cached after the first call. */
  async getLogin(): Promise<string> {
    if (this.cachedLogin) return this.cachedLogin;
    const me = await this.request<{ login?: string }>('GET', '/user');
    if (!me.ok || !me.body?.login) {
      throw new Error(`Could not read the GitHub account for this token (HTTP ${me.status}).`);
    }
    this.cachedLogin = me.body.login;
    return this.cachedLogin;
  }

  /** Get the user's repo if it exists, else create it (private, auto-init). Idempotent. */
  async ensureRepo(name: string): Promise<RepoInfo> {
    const login = await this.getLogin();
    const got = await this.request<RepoApi>('GET', `/repos/${login}/${name}`);
    if (got.ok && got.body) return toRepoInfo(got.body, false);
    if (got.status !== 404) {
      throw new Error(`ensureRepo: unexpected GET /repos response (HTTP ${got.status}).`);
    }
    const created = await this.request<RepoApi>('POST', '/user/repos', {
      name, private: true, auto_init: true, description: 'Built with NavBharatAI Pro v3.0',
    });
    if (!created.ok || !created.body) {
      throw new Error(`ensureRepo: could not create repo "${name}" in your GitHub account (HTTP ${created.status}).`);
    }
    return toRepoInfo(created.body, true);
  }

  /** A clone/push URL that carries the user's token as the git credential. */
  authedCloneUrl(name: string, login: string): string {
    return `https://x-access-token:${this.token}@github.com/${login}/${name}.git`;
  }

  // ── PrCapableClient (owner = the user's login) ──────────────────────────────────

  async openPullRequest(repo: string, head: string, base: string, title: string, body: string): Promise<PullRequestInfo> {
    const login = await this.getLogin();
    const created = await this.request<PullApi>('POST', `/repos/${login}/${repo}/pulls`, { title, head, base, body });
    if (created.ok && created.body?.number) return toPullInfo(created.body);
    if (created.status === 422) {
      const existing = await this.request<PullApi[]>('GET', `/repos/${login}/${repo}/pulls?head=${encodeURIComponent(`${login}:${head}`)}&base=${encodeURIComponent(base)}&state=open`);
      const first = Array.isArray(existing.body) ? existing.body[0] : undefined;
      if (existing.ok && first?.number) return toPullInfo(first);
    }
    throw new Error(`openPullRequest: could not open PR ${head}→${base} on "${repo}" (HTTP ${created.status}).`);
  }

  async combinedStatus(repo: string, ref: string): Promise<CiVerdict> {
    const login = await this.getLogin();
    const status = await this.request<{ state?: string; total_count?: number }>('GET', `/repos/${login}/${repo}/commits/${ref}/status`);
    const checks = await this.request<{ check_runs?: Array<{ status?: string; conclusion?: string }> }>('GET', `/repos/${login}/${repo}/commits/${ref}/check-runs`);
    const statusCount = status.body?.total_count ?? 0;
    const runs = checks.body?.check_runs ?? [];
    if (statusCount === 0 && runs.length === 0) return 'none';
    const runFailed = runs.some((r) => r.status === 'completed' && r.conclusion != null && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    const runPending = runs.some((r) => r.status !== 'completed');
    if (status.body?.state === 'failure' || status.body?.state === 'error' || runFailed) return 'failure';
    if (status.body?.state === 'pending' || runPending) return 'pending';
    return 'success';
  }

  async mergePullRequest(repo: string, number: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<boolean> {
    const login = await this.getLogin();
    const merged = await this.request<{ merged?: boolean }>('PUT', `/repos/${login}/${repo}/pulls/${number}/merge`, { merge_method: method });
    return merged.ok && merged.body?.merged === true;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T | null }> {
    const res = await this.fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: { ...API_HEADERS, Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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

interface PullApi {
  number?: number;
  html_url?: string;
  head?: { sha?: string };
}

function toPullInfo(p: PullApi): PullRequestInfo {
  return { number: p.number ?? 0, htmlUrl: p.html_url ?? '', headSha: p.head?.sha ?? '' };
}
