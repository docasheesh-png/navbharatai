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

import type { CiVerdict, PrComment, PullRequestInfo, RepoInfo } from './GitHubAppClient';
import type { PrCapableClient, ReviewCapableClient } from './GitHubPrFlow';
import { normalizePrComments, type RawPrComment } from './prCommentMapping';

const GITHUB_API = 'https://api.github.com';
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NavBharatAI-Builder' };

interface UserClientDeps {
  fetchImpl?: typeof fetch;
}

/** A GitHub client that acts AS THE USER (their OAuth token), storing projects in the user's account. */
export class UserGitHubClient implements PrCapableClient, ReviewCapableClient {
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
      name, private: true, auto_init: true, description: 'Built with NavBharatAI Pro v5.0',
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

  /**
   * Rename the user's repo `<login>/<from>` to `<to>` (admin 2026-09-04, the app-name feature).
   *
   * A RENAME, NOT A RE-CREATE — that distinction is the whole point. GitHub moves the existing repo
   * with all of its commits, branches and history intact, which is exactly what creating a new repo
   * under the new name would NOT do. `ensureRepo` cannot express this: handed an unfamiliar name it
   * creates an empty repo, so without this call a "rename" would strand the real app.
   *
   * NEVER THROWS. The caller has already applied the user's chosen display name, and a build may be
   * running against the old repo; a thrown error here would turn a cosmetic outcome into a failed
   * request. `ok:false` with a `status` lets the route tell the user the honest truth — 422 in
   * particular means GitHub itself says that name is taken, which is the authoritative duplicate
   * check no local scan can replace.
   */
  async renameRepo(from: string, to: string): Promise<{ ok: boolean; status: number; name: string }> {
    if (!from || !to || from === to) return { ok: false, status: 0, name: from };
    try {
      const login = await this.getLogin();
      const res = await this.request<RepoApi>('PATCH', `/repos/${login}/${encodeURIComponent(from)}`, { name: to });
      // GitHub returns the repo it ended up with; trust ITS name over the one we asked for, since it
      // may normalise what we sent and we must persist what actually exists.
      const actual = (res.body?.full_name || '').split('/')[1] || to;
      return { ok: res.ok, status: res.status, name: res.ok ? actual : from };
    } catch {
      return { ok: false, status: 0, name: from };
    }
  }

  /**
   * Verify the authenticated user's access to their own repo `<login>/<name>`: does it exist, can the
   * token PUSH to it, and what is its default branch (the PR base). Used to gate own-repo working-branch
   * storage — we only ever write to a repo the user genuinely owns and can push to. Never throws: any
   * API/network failure reports `canPush:false` so the caller safely falls back to the private mirror.
   */
  async getRepoAccess(name: string): Promise<{ exists: boolean; canPush: boolean; defaultBranch: string }> {
    try {
      const login = await this.getLogin();
      const got = await this.request<RepoApi>('GET', `/repos/${login}/${name}`);
      if (!got.ok || !got.body) return { exists: false, canPush: false, defaultBranch: 'main' };
      return { exists: true, canPush: got.body.permissions?.push === true, defaultBranch: got.body.default_branch ?? 'main' };
    } catch {
      return { exists: false, canPush: false, defaultBranch: 'main' };
    }
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

  // ── ReviewCapableClient (ROADMAP D3 — read a reviewer's notes, reply on their threads) ─────────
  //
  // The user's OWN repo, read with the user's OWN token, so this can only ever see a PR they already
  // have access to. Both methods mirror GitHubAppClient's semantics exactly and share its normaliser
  // (prCommentMapping.ts) — the only differences are the owner in the path and who we authenticate as.

  /**
   * Every comment on the PR — inline review comments AND the conversation below the diff.
   *
   * 🔒 NEVER THROWS, AND AN UNREADABLE ROUND IS EMPTY, NOT PARTIAL. The two lists are fetched
   * together and a failure of EITHER yields []. Returning just the half that loaded would let a
   * review round act on an incomplete picture of what the reviewer asked for — worse than doing
   * nothing, because it looks like it worked.
   */
  async listReviewComments(repo: string, number: number): Promise<PrComment[]> {
    try {
      if (!repo || !number) return [];
      const login = await this.getLogin();
      const [inline, general] = await Promise.all([
        this.request<RawPrComment[]>('GET', `/repos/${login}/${repo}/pulls/${number}/comments?per_page=100`),
        this.request<RawPrComment[]>('GET', `/repos/${login}/${repo}/issues/${number}/comments?per_page=100`),
      ]);
      return normalizePrComments(inline, general);
    } catch {
      return [];
    }
  }

  /**
   * Reply to a review comment, in its own thread when possible.
   *
   * A reply ON THE THREAD is what makes the exchange legible: a general comment saying "done" leaves
   * the reviewer hunting for which of their five notes it answers. When the threaded reply is refused
   * (the comment was deleted, or it was a conversation comment with no thread to reply into), it falls
   * back to the conversation rather than dropping the reply — a silent non-answer reads as being
   * ignored. Returns whether the reply landed. Never throws.
   */
  async replyToReviewComment(repo: string, number: number, commentId: number, body: string): Promise<boolean> {
    try {
      if (!repo || !number || !body) return false;
      const login = await this.getLogin();
      if (commentId > 0) {
        const threaded = await this.request<{ id?: number }>('POST', `/repos/${login}/${repo}/pulls/${number}/comments/${commentId}/replies`, { body });
        if (threaded.ok) return true;
      }
      const fallback = await this.request<{ id?: number }>('POST', `/repos/${login}/${repo}/issues/${number}/comments`, { body });
      return fallback.ok;
    } catch {
      return false;
    }
  }

  // ── Git data API (used by "Revert last merge") ─────────────────────────────────

  /** The head commit of a branch: its sha, message, tree sha, and parent shas. Null if unreadable. */
  async getBranchHeadCommit(repo: string, branch: string): Promise<{ sha: string; message: string; treeSha: string; parents: Array<{ sha: string }> } | null> {
    const login = await this.getLogin();
    const ref = await this.request<{ object?: { sha?: string } }>('GET', `/repos/${login}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const headSha = ref.body?.object?.sha;
    if (!ref.ok || !headSha) return null;
    const commit = await this.request<{ sha?: string; message?: string; tree?: { sha?: string }; parents?: Array<{ sha?: string }> }>('GET', `/repos/${login}/${repo}/git/commits/${headSha}`);
    if (!commit.ok || !commit.body?.tree?.sha) return null;
    return {
      sha: headSha,
      message: commit.body.message ?? '',
      treeSha: commit.body.tree.sha,
      parents: (commit.body.parents ?? []).filter((p): p is { sha: string } => typeof p?.sha === 'string'),
    };
  }

  /** The tree sha of an arbitrary commit (used to snapshot the base back to a parent's tree). */
  async getCommitTreeSha(repo: string, sha: string): Promise<string | null> {
    const login = await this.getLogin();
    const commit = await this.request<{ tree?: { sha?: string } }>('GET', `/repos/${login}/${repo}/git/commits/${sha}`);
    return commit.ok && commit.body?.tree?.sha ? commit.body.tree.sha : null;
  }

  /** Create a commit with the given tree + parents. Returns its sha, or null on failure. */
  async createCommit(repo: string, message: string, treeSha: string, parentShas: string[]): Promise<string | null> {
    const login = await this.getLogin();
    const created = await this.request<{ sha?: string }>('POST', `/repos/${login}/${repo}/git/commits`, { message, tree: treeSha, parents: parentShas });
    return created.ok && created.body?.sha ? created.body.sha : null;
  }

  /** Fast-forward a branch ref to `sha` (force:false — never rewrites history). Returns success. */
  async updateBranchRef(repo: string, branch: string, sha: string): Promise<boolean> {
    const login = await this.getLogin();
    const patched = await this.request<{ object?: { sha?: string } }>('PATCH', `/repos/${login}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
    return patched.ok && patched.body?.object?.sha === sha;
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
  permissions?: { push?: boolean; admin?: boolean; pull?: boolean };
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
