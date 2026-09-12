/**
 * DOES THIS PUBLISH NEED GITHUB — AND IF SO, WHAT EXACTLY IS MISSING?
 *
 * ONE set of rules, imported by BOTH the Publish screen and the server routes, because the last two
 * bugs on this path were the same shape: two sides answering the same question differently, and the
 * user reading the contradiction. A screen that offers a deploy the server will refuse, or refuses a
 * publish the server would have allowed, is worse than either answer alone.
 *
 * 🔴 THE SCOPE, AND WHY IT IS NOT "EVERY PUBLISH" (admin's requirement, 2026-09-12, adapted rather
 * than transcribed — see CLAUDE.md's external-suggestion rule).
 *
 * The admin asked for GitHub to be a mandatory prerequisite of the Publish button itself. For the case
 * that prompted it — an app with a SERVER HALF — that is exactly right, and this module makes it
 * unbypassable. Applied to EVERY publish it would break the product:
 *
 *   • A static app publishes to NavBharatAI hosting, whose provider is `isConfigured: () => true`.
 *     It reads nothing from GitHub, so requiring a GitHub account would be a gate in front of a door
 *     that is not locked.
 *   • That screen's own promise is "Host on NavBharatAI — One click, no account." A mandatory OAuth
 *     redirect is the opposite of it.
 *   • Every Email/Phone user would be locked out of publishing entirely. Most of them have no GitHub
 *     account and no reason to make one — and they are the India-first audience the product is for.
 *
 * So the rule is: GitHub is mandatory exactly where a deploy genuinely READS FROM a repository, and
 * nowhere else. A server half does; a static bundle does not.
 *
 * PURE — no I/O, no env, no DOM. Every decision here is a function of its inputs.
 */

/** What is being published. */
export interface PublishTarget {
  /**
   * Does this app have a server half that must run somewhere (an Express/Node backend)?
   *
   * The server derives this from the deploy plan it already computes; the client from the refusal code
   * the server sent back. Neither invents it.
   */
  hasServerHalf: boolean;
}

/** What we know about the user's GitHub, from the request and from the workspace's durable record. */
export interface GithubGateState {
  /** Has the user authorized GitHub at all (an OAuth token we can act with)? */
  connected: boolean;
  /** Does this app's code already live in a repo IN THE USER'S OWN account? */
  hasRepo: boolean;
}

/**
 * `ok` — nothing is in the way.
 * `connect-github` — no authorization at all: the OAuth redirect is the next step.
 * `push-to-github` — authorized, but this app is not in a repo yet: a push is the next step, and
 *   sending them back through OAuth would be the "unnecessary re-authorization" the admin ruled out.
 */
export type GithubGateVerdict = 'ok' | 'connect-github' | 'push-to-github';

/** Machine codes the server returns and the client branches on — never parsed from a sentence. */
export const GITHUB_GATE_CODE = {
  connect: 'github-connect-required',
  push: 'github-repo-required',
} as const;

export type GithubGateCode = typeof GITHUB_GATE_CODE[keyof typeof GITHUB_GATE_CODE];

/** Does this publish read from a GitHub repository at all? */
export function publishNeedsGitHub(target: PublishTarget): boolean {
  return target.hasServerHalf === true;
}

/**
 * The whole decision, in one place.
 *
 * 🔒 ORDER MATTERS AND IS DELIBERATE. "Not connected" is checked before "no repo", because a user with
 * no authorization cannot be asked to push — and a user who IS authorized must never be redirected
 * through OAuth again just because this particular app has no repo yet.
 */
export function githubGateVerdict(target: PublishTarget, state: GithubGateState): GithubGateVerdict {
  if (!publishNeedsGitHub(target)) return 'ok';
  if (!state.connected) return 'connect-github';
  if (!state.hasRepo) return 'push-to-github';
  return 'ok';
}

/** The code a refusal carries, or `null` when nothing is refused. */
export function githubGateCode(verdict: GithubGateVerdict): GithubGateCode | null {
  if (verdict === 'connect-github') return GITHUB_GATE_CODE.connect;
  if (verdict === 'push-to-github') return GITHUB_GATE_CODE.push;
  return null;
}

/**
 * What the user reads. Plain language, no vendor mechanics, and it names the ONE next action — the
 * screen renders the matching button beside it.
 */
export function githubGateMessage(verdict: GithubGateVerdict): string {
  if (verdict === 'connect-github') {
    return 'This app has a server half, and a host runs your server from a GitHub repository — so your '
      + 'code has to live in one first. Connect your GitHub account to continue; nothing is published '
      + 'until you do.';
  }
  if (verdict === 'push-to-github') {
    return 'Your GitHub is connected. This app is not saved to a repository of your own yet — save it '
      + 'there and the server half can be deployed from it.';
  }
  return '';
}
