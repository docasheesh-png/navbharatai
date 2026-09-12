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
  /**
   * ⚠️ THE STORAGE REPO — the one the build PUSHES to. Not necessarily the one a deploy reads.
   * Kept here only as the backward-compatible fallback below; never written by this module.
   */
  repoName?: string;
  /**
   * 🔴 THE DEPLOY REPO, AS ITS OWN FIELD (root-caused 2026-09-12) — see `deployRepoNameOf`.
   */
  deployRepoName?: string;
  repoOwnedByUser?: boolean;
  deployBranch?: string;
}

/**
 * Which repo name a deploy should use.
 *
 * 🔴 WHY THIS IS TWO FIELDS AND NOT ONE. `repoName` is the STORAGE repo — the name the build derives
 * and then PINS, and which it re-reads next turn to decide where to push (`pinnedRepoName` →
 * `mirrorRepoName`). For most apps the storage repo and the deploy repo are the same object, so one
 * field served both meanings and nobody noticed.
 *
 * They come apart for exactly the case the admin hit: an app IMPORTED from the user's own GitHub.
 * There the build stores edits on a working branch inside their REAL repo, while `repoName` still
 * holds the derived MIRROR name. Writing the real name into `repoName` to fix the deploy would have
 * been worse than the bug: next turn that name is read back as the storage name, so a later fall-back
 * to mirror storage would target the user's real repository. Same field, two meanings, one of them
 * destructive.
 *
 * So the deploy fact gets its own name. `repoName` remains the fallback ONLY for records written
 * before this field existed — where it is right for mirror-stored apps (storage and deploy are the
 * same repo) and no more wrong for own-repo apps than it already was.
 */
export function deployRepoNameOf(durable: DurableRepoRecord | null | undefined): string {
  return (durable?.deployRepoName ?? '').trim() || (durable?.repoName ?? '').trim();
}

/** What the client claims about a repo THIS request — from live-session state, never persisted itself. */
export interface ClientRepoClaim {
  hasRepo?: boolean;
}

/**
 * 🔴 THE FACT IS ALL THREE FIELDS OR IT IS NOTHING (root-caused 2026-09-12).
 *
 * The admin reported the very bug this module was written to kill, still happening: *"github already
 * connect hai, app github se hi import ki hai, fir se github connect ki bol raha hai"*. The module was
 * fine; one of its three WRITERS was not. The own-repo import path wrote `repoOwner`,
 * `repoOwnedByUser` and `deployBranch` — and forgot `repoName`. Nothing complained, because a patch
 * of two fields out of three is a perfectly valid patch.
 *
 * The record that produced was worse than no record at all, because the two readers disagreed about
 * it: `repoAvailableForDeploy` said YES (it only looked at the flag), while `resolveDeployRepo` said
 * NO (it needs a name to build a URL from). One screen therefore told the user a deploy could run and,
 * directly beneath, told them to go and create the repo they already had.
 *
 * So completeness is now a named predicate that every reader shares, and `ownRepoMemoryPatch` below
 * is the ONLY way to write the fact. A caller can no longer remember half of it.
 */
export function ownRepoRecordComplete(durable: DurableRepoRecord | null | undefined): boolean {
  return durable?.repoOwnedByUser === true
    && (durable.repoOwner ?? '').trim() !== ''
    && deployRepoNameOf(durable) !== '';
}

/** Everything that must be true at once for a workspace to remember whose repo holds its code. */
export interface OwnRepoFact {
  owner: string;
  repo: string;
  /** The branch a deploy builds from — the app's SHIPPED state, never a work-in-progress branch. */
  deployBranch: string;
  /**
   * 🔒 REQUIRED, AND THE CALLER MUST THINK ABOUT IT — is this repo ALSO where the build pushes?
   *
   * `true` for a repo we created in the user's account and pushed the whole app to (the "Put this app
   * in my GitHub" action, the ZIP-import backup): storage and deploy are one object, so the storage
   * name is pinned too and the next build pushes where it already pushed.
   *
   * `false` for an app imported from the user's OWN repo: the build keeps edits on a working branch
   * there, but the STORAGE name must stay the derived mirror name — pinning the real repository would
   * aim a later mirror fall-back at it. This is the distinction whose absence caused the bug.
   *
   * It has no default on purpose. A default is a guess, and guessing wrong here is the destructive
   * direction.
   */
  storesCode: boolean;
}

/** The durable patch that records an own-repo fact, or `null` when the fact is not whole. */
export interface OwnRepoMemoryPatch {
  repoOwner: string;
  /** The DEPLOY repo — always written; deliberately not the same field as `repoName`. */
  deployRepoName: string;
  /** The STORAGE repo — written ONLY when this repo is genuinely where the build pushes. */
  repoName?: string;
  repoOwnedByUser: true;
  deployBranch: string;
}

/**
 * Build the patch that remembers "this app's code lives in the user's OWN GitHub repo".
 *
 * 🔒 THE ONLY WAY THIS FACT MAY BE WRITTEN. Returning `null` for an incomplete fact is deliberate and
 * is the whole point: a caller missing the repo name now writes NOTHING, instead of writing a record
 * that claims ownership it cannot name. Nothing is the honest state — the screen then offers the user
 * a real way forward, rather than a deploy that could only fail.
 *
 * PURE. `tests/deployRepoMemory.test.ts` locks the completeness rule; `tests/ownRepoMemoryWiring.test.ts`
 * locks that every durable writer in the route goes through this function.
 */
export function ownRepoMemoryPatch(fact: OwnRepoFact): OwnRepoMemoryPatch | null {
  const owner = (fact.owner ?? '').trim();
  const repo = (fact.repo ?? '').trim();
  const deployBranch = (fact.deployBranch ?? '').trim();
  if (!owner || !repo || !deployBranch) return null;
  return {
    repoOwner: owner,
    deployRepoName: repo,
    ...(fact.storesCode ? { repoName: repo } : {}),
    repoOwnedByUser: true,
    deployBranch,
  };
}

/**
 * Does this workspace have a repo a backend deploy may use? PURE — see the module header for why
 * this is an OR, not an override.
 *
 * ⚠️ It asks for a COMPLETE record, not just the flag. A record that claims ownership without naming
 * the repo cannot produce a deploy, so answering "yes" from it is a promise the next step breaks.
 */
export function repoAvailableForDeploy(client: ClientRepoClaim | null | undefined, durable: DurableRepoRecord | null | undefined): boolean {
  return client?.hasRepo === true || ownRepoRecordComplete(durable);
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
  if (ownRepoRecordComplete(durable)) {
    const owner = durable!.repoOwner!.trim();
    const repo = deployRepoNameOf(durable);
    return { owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: durable!.deployBranch?.trim() || 'main' };
  }
  return null;
}

/**
 * 🔴 THE RENAME SIBLING (found by sweeping for `repoName` readers, 2026-09-12 — rule 3).
 *
 * Renaming an app renames its STORAGE repo on GitHub and repins `repoName`. While one field carried
 * both meanings that was automatically right for the deploy too. Split into two fields, it stops
 * being automatic: a mirror-stored app renamed after a deploy was remembered would keep pointing the
 * deploy at a repository GitHub no longer has under that name.
 *
 * The rule, and it is the only honest one: the deploy name follows the rename **iff the rename moved
 * the repository the deploy uses** — i.e. the two named the same repo, or the deploy name was absent
 * and therefore implicitly WAS the storage name. For an app imported from the user's own GitHub they
 * are different repositories, the rename touches only the mirror, and the deploy name must not move.
 *
 * PURE. Returns just the fields to merge, so the caller's own `updatedAt` handling is untouched.
 */
export function renameStorageRepoPatch(
  durable: DurableRepoRecord | null | undefined,
  newStorageName: string,
): { repoName: string; deployRepoName?: string } {
  const name = (newStorageName ?? '').trim();
  const oldStorage = (durable?.repoName ?? '').trim();
  const deployName = (durable?.deployRepoName ?? '').trim();
  const deployFollowed = deployName === '' || deployName === oldStorage;
  return deployFollowed && name ? { repoName: name, deployRepoName: name } : { repoName: name };
}
