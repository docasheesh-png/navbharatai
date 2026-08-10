// AgentV3 — Claude-Code-style PR → CI → merge flow (Phase 3 of git-native storage).
//
// When git-native storage runs in PR mode, a build is not force-pushed straight to the default
// branch — instead the sandbox is pushed to a build branch, a pull request is opened, its CI verdict
// is read, and the PR is merged ONLY when CI is green (or when the repo has no checks at all, the
// common case for a fresh project repo). This mirrors how Claude Code ships: branch → PR → green →
// merge, never merging red. It is honest: a pending/failing PR is left OPEN with a clear note, never
// silently merged and never reported as a fake success.
//
// Pure orchestration over a small client port, so it is fully unit-testable without GitHub.

import type { CiVerdict, PullRequestInfo } from './GitHubAppClient';
import { envFlag } from '../lib/envFlag';

/** The slice of GitHubAppClient this flow needs (so tests can pass a fake). */
export interface PrCapableClient {
  openPullRequest(repo: string, head: string, base: string, title: string, body: string): Promise<PullRequestInfo>;
  combinedStatus(repo: string, ref: string): Promise<CiVerdict>;
  mergePullRequest(repo: string, number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<boolean>;
}

export interface PrFlowResult {
  opened: boolean;
  prNumber: number;
  prUrl: string;
  /** The CI verdict that was read for the PR head. */
  ci: CiVerdict;
  merged: boolean;
  /** A short, honest, user-facing summary of what happened. */
  note: string;
}

export interface PrFlowOptions {
  head: string;
  base: string;
  title: string;
  body?: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}

/**
 * Whether PR mode is enabled. Requires an explicit GITHUB_PR_MODE=true opt-in (in addition to git
 * storage being active) — so the default git-native path stays the simple direct-push, and the
 * review-gated PR flow turns on only when the admin asks for it.
 */
export function githubPrMode(): boolean {
  return envFlag('GITHUB_PR_MODE');
}

const SKIPPED: PrFlowResult = { opened: false, prNumber: 0, prUrl: '', ci: 'none', merged: false, note: '' };

export interface RevertPlan {
  canRevert: boolean;
  /** The parent commit whose tree the base branch is restored to (present iff canRevert). */
  parentSha?: string;
  /** An honest reason when the revert is refused. */
  reason?: string;
}

/**
 * Plan an "undo the last merge" for a branch: restore its content to the state BEFORE its most recent
 * commit by snapshotting back to that commit's single parent (a new, non-destructive commit on top of
 * history — itself revertible). Only a SINGLE-PARENT head is auto-revertible, which is exactly the
 * shape NavBharatAI's squash "Ship to main" produces. A true merge commit (2 parents) or a root commit
 * (0 parents) is refused honestly — the user is pointed at GitHub's own Revert. Pure + unit-testable.
 */
export function planRevert(head: { sha: string; parents: Array<{ sha: string }> } | null | undefined): RevertPlan {
  if (!head || !Array.isArray(head.parents)) return { canRevert: false, reason: 'Could not read the latest commit on your branch.' };
  if (head.parents.length === 1) return { canRevert: true, parentSha: head.parents[0].sha };
  if (head.parents.length === 0) return { canRevert: false, reason: 'The latest commit is the repository’s first commit — there is nothing before it to revert to.' };
  return { canRevert: false, reason: 'The latest commit is a multi-parent merge — revert it from GitHub’s “Revert” button on the merged pull request instead.' };
}

/**
 * Open a PR for the build branch and merge it when CI is green (or absent). Best-effort: any error
 * resolves to a skipped result rather than throwing, so it can never break a build.
 */
export async function mergeViaPullRequest(client: PrCapableClient, repo: string, opts: PrFlowOptions): Promise<PrFlowResult> {
  if (!repo || !opts.head || !opts.base) return { ...SKIPPED };
  try {
    const pr = await client.openPullRequest(repo, opts.head, opts.base, opts.title || 'NavBharatAI build', opts.body || '');
    if (!pr.number) return { ...SKIPPED };
    const ref = pr.headSha || opts.head;
    const ci = await client.combinedStatus(repo, ref);
    // Merge only when there is nothing red and nothing still running.
    if (ci === 'success' || ci === 'none') {
      const merged = await client.mergePullRequest(repo, pr.number, opts.mergeMethod ?? 'squash');
      return {
        opened: true, prNumber: pr.number, prUrl: pr.htmlUrl, ci, merged,
        note: merged
          ? `Merged PR #${pr.number}${ci === 'none' ? '' : ' (CI green)'}.`
          : `Opened PR #${pr.number}; the merge did not complete — review it on GitHub.`,
      };
    }
    return {
      opened: true, prNumber: pr.number, prUrl: pr.htmlUrl, ci, merged: false,
      note: ci === 'failure'
        ? `Opened PR #${pr.number}; CI is RED — it was NOT merged. Fix the checks, then merge on GitHub.`
        : `Opened PR #${pr.number}; CI is still running — it was not merged yet. Merge it on GitHub once green.`,
    };
  } catch {
    return { ...SKIPPED };
  }
}
