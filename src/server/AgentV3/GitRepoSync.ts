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
  async hydrateFromRepo(authedUrl: string): Promise<HydrateResult> {
    if (!authedUrl) return { hydrated: false, hadFiles: false, skipped: true };
    try {
      const cmd =
        'rm -rf /tmp/nbhydrate 2>/dev/null; ' +
        `if git clone --depth 1 "${authedUrl}" /tmp/nbhydrate >/dev/null 2>&1; then ` +
        // Only overlay when the repo actually has a built project (not just an auto-init README).
        'if [ -f /tmp/nbhydrate/package.json ] || [ -d /tmp/nbhydrate/src ]; then ' +
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
    if (!authedUrl) return { pushed: false, noChange: false, skipped: true };
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
        `git push --force "${authedUrl}" HEAD:${safeBranch} >/dev/null 2>&1 && echo NB_PUSHED || echo NB_PUSHFAIL`,
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
