// AgentV3 — git-native storage sync (Phase 2 of git-native storage).
//
// Makes a user's GitHub repo the durable source of truth for their project. The E2B sandbox is
// ephemeral and ~free; the repo is durable and ~free — so instead of persisting file *content* to
// Firestore (a bill that grows with every user), each build:
//   • hydrates the sandbox FROM the repo at start (clone — only when the sandbox came up empty), and
//   • pushes the sandbox back TO the repo at the end (commit + push).
// Git becomes the persistence layer; the sandbox is a disposable working copy.
//
// Runs over the same CommandRunner port as GitManager, so it is testable with a fake runner and
// degrades to a no-op on a sandbox without a shell. Best-effort everywhere: a sync failure must
// NEVER break a build (the in-place Firestore capture remains as a backstop). The authenticated
// clone/push URL carries a short-lived token — it is passed straight to git and never emitted to
// the event stream or returned in any result.

import type { CommandRunner } from './GitManager';

/**
 * Validate + REBUILD a GitHub clone/push URL from its parsed parts, rejecting anything that isn't a
 * plain `https://[token@]github.com/owner/repo[.git]`. Returns a shell-safe URL, or null when the
 * input is not an acceptable GitHub URL.
 *
 * SECURITY (v3.0 audit C2 — host command injection + SSRF): `authedUrl` derives from the user's
 * `importUrl` and is interpolated into a `git clone "…"` / `git push "…"` shell string that runs on
 * the actuator (the HOST process when the E2B key is unset → LocalActuator). Without this guard a
 * payload like `https://github.com/o/r"; curl 169.254.169.254/… ; echo "` breaks out of the quotes
 * and executes arbitrary host commands + reads cloud metadata, and a `file://`/internal-IP URL is an
 * SSRF. We do NOT sanitize the blob in place — we PARSE it and rebuild from validated components, so
 * only a real github.com two-segment repo path (optionally with an `[A-Za-z0-9_]` token in the
 * userinfo slot) can ever reach git. The rebuilt string contains only `[A-Za-z0-9_.:@/-]`, none of
 * which can escape a double-quoted shell argument. (An argv-based `spawn('git',[…])` would be even
 * stronger, but the CommandRunner port is string-command-only across all three actuators, so a
 * validate-and-rebuild guard at the sink is the complete fix for this interface.)
 */
export function sanitizeRepoUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;                    // no file://, http://, git://, ssh
  if (u.hostname.toLowerCase() !== 'github.com') return null;  // no internal hosts / SSRF targets
  if (u.port) return null;
  // Userinfo carries the auth token in one of two legit forms: `<token>@` (username only) or the
  // GitHub-App form `x-access-token:<token>@` (username:password). Both parts must be strictly
  // [A-Za-z0-9_-]; `new URL` percent-encodes any shell metachar (e.g. `"`→`%22`), and `%` is not in
  // this class, so an injection attempt in the userinfo is rejected here.
  const user = u.username;
  const pass = u.password;
  const idOk = (s: string) => /^[A-Za-z0-9_-]+$/.test(s);
  if (user && !idOk(user)) return null;
  if (pass && !idOk(pass)) return null;
  if (pass && !user) return null;                              // a bare `:pass@` is not a shape we emit
  const userinfo = user ? (pass ? `${user}:${pass}` : user) + '@' : '';
  // Exactly two path segments (owner/repo[.git]); `new URL` has already normalized any `..`, and a
  // normalized traversal collapses to a non-two-segment path that this regex rejects.
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.pathname)) return null;
  const safe = `https://${userinfo}github.com${u.pathname}`;
  // Belt-and-suspenders: the rebuilt URL must contain only shell-safe characters (none of these can
  // escape a double-quoted shell argument).
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(safe)) return null;
  return safe;
}

export interface HydrateResult {
  /** True when repo content was cloned into an empty sandbox this run. */
  hydrated: boolean;
  /** True when the sandbox already had files, so the clone was skipped (no clobber). */
  hadFiles: boolean;
  /** True when git was unavailable / the operation failed (degraded to a no-op). */
  skipped: boolean;
}

export interface PushResult {
  /** True when a commit + push completed successfully. */
  pushed: boolean;
  /** True when there was nothing to commit (no change since last sync). */
  noChange: boolean;
  /** True when git was unavailable / the push failed (degraded to a no-op). */
  skipped: boolean;
}

/**
 * GitRepoSync — clones the project repo into the sandbox at build start (only when empty) and
 * commits + force-pushes the sandbox back at build end. Best-effort: every method swallows errors
 * and returns a `skipped` result rather than throwing, so the build path is never affected.
 */
export class GitRepoSync {
  constructor(
    private readonly runner: CommandRunner,
    private readonly workspaceId: string,
  ) {}

  /**
   * Restore the project FROM the repo (the repo is the source of truth). The sandbox is always
   * pre-scaffolded with a starter template by ensureWorkspace, so an "only if the sandbox is empty"
   * check would never fire — instead we clone the repo and, when it holds REAL project content
   * (a package.json or src/, i.e. a prior build — not just an auto-init README), overlay it onto
   * the sandbox so the user's actual code wins over the template. A brand-new/empty repo leaves the
   * scaffold in place (first build). The repo's `.git` comes with the overlay, so the workspace
   * becomes a real clone. Best-effort: a clone failure is a no-op, never blocking the build.
   */
  async hydrateFromRepo(authedUrl: string, opts?: { overlayAnyContent?: boolean }): Promise<HydrateResult> {
    // SECURITY (C2): validate + rebuild the URL before it reaches the shell. An unacceptable URL
    // (non-github host, wrong scheme, injection metachars) degrades to a safe no-op — never runs.
    const safeUrl = sanitizeRepoUrl(authedUrl);
    if (!safeUrl) return { hydrated: false, hadFiles: false, skipped: true };
    // Which cloned repos are worth overlaying onto the sandbox:
    //  • auto-hydrate of the per-project mirror → only a REAL project (package.json/src), so an
    //    auto-init README doesn't replace the fresh scaffold on a first build;
    //  • an EXPLICIT user import (overlayAnyContent) → ANY repo content (a Python/Go/static/monorepo
    //    project has no root package.json or src/ but is absolutely a project the user asked to import).
    const contentTest = opts?.overlayAnyContent
      ? 'find /tmp/nbhydrate -mindepth 1 -maxdepth 1 -not -name .git 2>/dev/null | grep -q .'
      : '[ -f /tmp/nbhydrate/package.json ] || [ -d /tmp/nbhydrate/src ]';
    try {
      const cmd =
        'rm -rf /tmp/nbhydrate 2>/dev/null; ' +
        `if git clone --depth 1 "${safeUrl}" /tmp/nbhydrate >/dev/null 2>&1; then ` +
        `if ${contentTest}; then ` +
        'cp -a /tmp/nbhydrate/. ./ >/dev/null 2>&1 && echo NB_HYDRATED || echo NB_HYDRATE_FAIL; ' +
        'else echo NB_EMPTY_REPO; fi; ' +
        'else echo NB_CLONE_FAIL; fi; ' +
        'rm -rf /tmp/nbhydrate 2>/dev/null';
      const r = await this.run(cmd);
      const out = r.stdout || '';
      if (out.includes('NB_HYDRATED')) return { hydrated: true, hadFiles: false, skipped: false };
      // Repo had no real content yet (first build) — kept the scaffold; ran fine, nothing to restore.
      if (out.includes('NB_EMPTY_REPO')) return { hydrated: false, hadFiles: false, skipped: false };
      // Clone/copy failed (network, no git) — best-effort no-op.
      return { hydrated: false, hadFiles: false, skipped: true };
    } catch {
      return { hydrated: false, hadFiles: false, skipped: true };
    }
  }

  /**
   * Commit the whole working tree and force-push it to `branch`. Force is intentional: the repo is
   * a private, single-writer mirror of this user's project, so the sandbox is always the truth at
   * push time (no concurrent human edits to merge). Returns `noChange` when nothing changed.
   */
  async pushAll(authedUrl: string, branch: string, message: string): Promise<PushResult> {
    // SECURITY (C2): same validate-and-rebuild guard as hydrateFromRepo before the URL hits `git push`.
    const safeUrl = sanitizeRepoUrl(authedUrl);
    if (!safeUrl) return { pushed: false, noChange: false, skipped: true };
    const safeBranch = sanitizeBranch(branch);
    const safeMsg = sanitizeMessage(message);
    try {
      // Ensure the repo + identity exist (a fresh `git init` sandbox that never cloned still
      // needs an initial branch + author before it can commit/push).
      await this.run(
        'git rev-parse --git-dir >/dev/null 2>&1 || git init -q; ' +
        'git config user.email "builder@navbharatai.dev"; ' +
        'git config user.name "NavBharatAI Builder"',
      );
      const commit = await this.run(
        'git add -A && (git commit -q -m "' + safeMsg + '" && echo NB_COMMITTED || echo NB_NOCHANGE)',
      );
      const committed = (commit.stdout || '').includes('NB_COMMITTED');
      // Push even on "no change" the FIRST time would fail with nothing to push; only push when we
      // actually have a HEAD. Force-push the current HEAD to the target branch.
      const push = await this.run(
        `git push --force "${safeUrl}" HEAD:${safeBranch} >/dev/null 2>&1 && echo NB_PUSHED || echo NB_PUSHFAIL`,
      );
      const pushed = (push.stdout || '').includes('NB_PUSHED');
      if (!pushed) return { pushed: false, noChange: !committed, skipped: true };
      return { pushed: true, noChange: !committed, skipped: false };
    } catch {
      return { pushed: false, noChange: false, skipped: true };
    }
  }

  private async run(command: string) {
    return this.runner.runCommand(this.workspaceId, command);
  }
}

/** A safe git ref name: a small allow-list, defaulting to `main`. */
function sanitizeBranch(branch: string): string {
  const b = (branch || '').replace(/[^A-Za-z0-9._/-]/g, '').replace(/^[-/]+/, '').slice(0, 100);
  return b || 'main';
}

/** A safe single-line commit message (no shell metachars that could escape the quotes). */
function sanitizeMessage(message: string): string {
  return message.replace(/["`$\\]/g, '').replace(/\r?\n/g, ' ').slice(0, 200) || 'NavBharatAI build';
}
