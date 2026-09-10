// DOES THIS WORKSPACE HAVE A DEPLOYABLE REPO — ACCORDING TO WHAT WE ACTUALLY REMEMBER? (admin 2026-09-06)
//
// 🔴 THE GAP THIS CLOSES. "GitHub se import ki hai, matlab GitHub par hai, connect hai!" — and the
// admin was right: an import can genuinely land the app in the user's own GitHub (their real repo on
// a working branch, or a fresh repo NavBharatAI creates in their account). But until this fix, that
// fact reached the CLIENT only as a live stream event during the import turn — real, but scoped to
// that one browser tab, that one session. `deployRepo` on the Publish/Deploy-backend screen is
// computed from REACT STATE that starts empty on every reload. So a workspace whose import genuinely
// succeeded would, on the very next visit, tell that same user to "push this app to a repo of your
// own" — a true fact about THIS SESSION'S memory, delivered as if it were a fact about the app.
//
// The fix: the moment code lands in the user's own GitHub (own-repo storage, a user-account mirror,
// or "Put this app in my GitHub"), the workspace record now durably remembers WHOSE repo it is and
// which branch is the shipped one. This module is what turns that durable memory into an actual
// decision, alongside whatever the client claims THIS request.
//
// 🔒 WHY THE DURABLE RECORD WINS OVER AN EMPTY CLIENT CLAIM, NOT THE OTHER WAY ROUND. An ephemeral
// "no repo" from the client means "nothing happened in THIS browser tab" — never "this has never
// happened". Trusting it as the final word is exactly the bug being fixed. So the rule is an OR: a
// repo is deployable if EITHER the client's live-session state says so OR the durable record does.
//
// 🔒 STALENESS IS CAUGHT BY THE REAL DEPLOY ATTEMPT, NOT BY WITHHOLDING THE OFFER. Access can be
// revoked, a token can expire, a repo can be deleted — a durable "yes" recorded weeks ago could be
// wrong today. But the alternative (never trusting durable memory) makes the ordinary case wrong
// EVERY time to guard against the rare case being wrong SOMETIMES. Render's own API is the ground
// truth the moment a deploy is actually attempted, and it already reports the honest, specific reason
// when access has gone away (createFailureMessage). A wrong upfront refusal is a worse failure than a
// deploy attempt that fails with a clear reason — the second one is actionable exactly when it matters.
//
// PURE — record + client claim in, decision out. No I/O, no defaults invented from nothing.

/** The durable fields a workspace's conversation record carries, when it has any. */
export interface DurableRepoRecord {
  repoOwner?: string;
  repoName?: string;
  repoOwnedByUser?: boolean;
  deployBranch?: string;
}

/** What the client claims about a repo THIS request — from live-session state, never persisted itself. */
export interface ClientRepoClaim {
  hasRepo?: boolean;
}

/**
 * Does this workspace have a repo a backend deploy may use? PURE — see the module header for why
 * this is an OR, not an override.
 */
export function repoAvailableForDeploy(client: ClientRepoClaim | null | undefined, durable: DurableRepoRecord | null | undefined): boolean {
  return client?.hasRepo === true || durable?.repoOwnedByUser === true;
}

/** A fully-formed repo the deploy path can act on. */
export interface ResolvedDeployRepo {
  owner: string;
  repo: string;
  repoUrl: string;
  /** The branch to build from — the app's shipped state, never a work-in-progress branch. */
  branch: string;
}

const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

/** Parse an https://github.com/owner/repo URL into its parts, or null for anything else. PURE. */
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = REPO_URL.exec(String(url ?? '').trim().replace(/\.git$/, '').replace(/\/+$/, ''));
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * The repo a `/deploy-backend` request should actually use.
 *
 * 🔒 THE CLIENT-SUPPLIED URL WINS WHEN IT PARSES — it is the freshest possible signal (e.g. "Put this
 * app in my GitHub" may have just run THIS turn, before the durable write below it has landed), and
 * trusting it costs nothing extra to verify since the deploy attempt itself is the real check.
 *
 * Falls back to the DURABLE record only when the client sent nothing usable — reconstructing the
 * `https://github.com/...` URL from the two persisted fields, and reading the persisted BRANCH so a
 * deploy never silently targets `main` when the app's real base branch is something else, and never
 * targets an in-progress working branch (`navbharatai/work`) that can hold unreviewed edits.
 *
 * `null` when neither source names a usable repo — the caller's existing honest hand-off stands. PURE.
 */
export function resolveDeployRepo(
  clientRepoUrl: string | null | undefined,
  durable: DurableRepoRecord | null | undefined,
): ResolvedDeployRepo | null {
  const clientParsed = parseRepoUrl(String(clientRepoUrl ?? ''));
  if (clientParsed) {
    return { ...clientParsed, repoUrl: `https://github.com/${clientParsed.owner}/${clientParsed.repo}`, branch: durable?.deployBranch?.trim() || 'main' };
  }
  if (durable?.repoOwnedByUser && durable.repoOwner?.trim() && durable.repoName?.trim()) {
    const owner = durable.repoOwner.trim();
    const repo = durable.repoName.trim();
    return { owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: durable.deployBranch?.trim() || 'main' };
  }
  return null;
}
