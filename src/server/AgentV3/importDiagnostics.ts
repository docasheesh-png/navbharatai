// AgentV3 — accurate, actionable GitHub-import failure messages (admin 2026-07-23).
//
// Root cause this closes: a failed `git clone` used to surface ONE generic line — "I couldn't clone
// <url>. If it's private, connect the GitHub account…" — regardless of WHY it failed. A user cloning
// their OWN repo then can't tell what's actually wrong (the connected account is a DIFFERENT GitHub
// login than the repo owner? the connection expired? a network blip?). GitRepoSync now classifies the
// real git error inside the sandbox (never leaking the token) into a `HydrateFailReason`; this pure
// helper turns that + whether a token was even sent into the exact, fixable message.
//
// White-label note: "GitHub" is the user's OWN provider that they explicitly connect — naming it is
// correct and necessary (it is not a hidden AI vendor). No AI model/provider name appears here.

import type { HydrateFailReason } from './GitRepoSync';

export interface ImportFailureContext {
  /** The classified cause from GitRepoSync (undefined = pre-classification / unknown). */
  reason?: HydrateFailReason;
  /** Whether the build actually sent a GitHub token (the user is connected). */
  hadToken: boolean;
  /** The clean repo URL shown to the user (already token-free). */
  url: string;
}

const TAIL = 'Starting with an empty workspace for now.';

/** The GitHub owner in `https://github.com/<owner>/<repo>` — for naming the exact account to connect. */
export function repoOwnerFromUrl(url: string): string | null {
  const m = /github\.com\/([A-Za-z0-9._-]+)\/[A-Za-z0-9._-]+/i.exec(url || '');
  return m ? m[1] : null;
}

/** The precise, actionable narration for a failed import — one honest reason, one clear next step. */
export function importFailureNarration({ reason, hadToken, url }: ImportFailureContext): string {
  const owner = repoOwnerFromUrl(url);
  // Naming the owner kills the "it's my own repo, why does it fail?" confusion: the user instantly sees
  // which GitHub account must be the connected one.
  const ownerClause = owner ? ` This repo is owned by the GitHub account “${owner}” — make sure that's the account connected here.` : '';
  // A transient network problem is nobody's misconfiguration — say so and invite a retry.
  if (reason === 'network') {
    return `I couldn't reach GitHub to clone ${url} just now (a network hiccup). Please try again in a moment. ${TAIL}`;
  }

  // No token was sent at all → the user isn't connected (or the sign-in didn't capture a GitHub token).
  // This is the #1 real cause and must lead with "connect", not "check the URL".
  if (!hadToken) {
    return `I'm not connected to your GitHub yet, so I can't open ${url} if it's private.${ownerClause} Connect the GitHub account that owns it (⚙ → GitHub) and try the import again. ${TAIL}`;
  }

  // A token WAS sent but git couldn't authenticate → the connection is almost always expired/revoked.
  if (reason === 'auth') {
    return `Your GitHub connection couldn't sign in to ${url} — it's most likely expired. Reconnect GitHub (⚙ → GitHub → Reconnect) and try the import again. ${TAIL}`;
  }

  // A token was sent but GitHub reports the repo as missing. For a private repo GitHub returns
  // "not found" to any account that can't see it — i.e. the CONNECTED account isn't the owner/a
  // collaborator. This is the exact "I'm cloning my own repo, why does it fail?" case: the connected
  // login differs from the repo owner.
  if (reason === 'not-found') {
    return `I couldn't find ${url} with your connected GitHub account. If the repo is private, it belongs to a DIFFERENT GitHub account than the one connected here — connect the account that actually owns it (⚙ → GitHub).${ownerClause} If it's public, double-check the URL. ${TAIL}`;
  }

  // A TLS / certificate failure reaching GitHub — an environment/network condition, NOT the user's repo
  // access. Say so honestly and invite a retry (never imply the repo is private). (mitrify autopsy.)
  if (reason === 'tls') {
    return `I reached GitHub but couldn't establish a secure connection to clone ${url} (a TLS/certificate issue on the build network). This isn't a problem with your repo — please try the import again in a moment. ${TAIL}`;
  }

  // A protocol / partial-transfer failure (the clone connected but the transfer broke — a known class
  // behind some egress proxies). Environmental, retryable, and NOT a private-repo problem.
  if (reason === 'protocol') {
    return `I started cloning ${url} but the transfer was interrupted before it finished (a network/protocol hiccup, not a problem with your repo). Please try the import again — it usually succeeds on a retry. ${TAIL}`;
  }

  // The build sandbox ran out of disk while cloning — an infrastructure condition, nothing to do with
  // the repo's visibility. Be honest so the user doesn't waste time "fixing" GitHub access.
  if (reason === 'disk') {
    return `I couldn't finish cloning ${url} because the build environment ran low on space partway through — this is on our side, not your repo. Please try the import again in a fresh session. ${TAIL}`;
  }

  // no-git / unknown / bad-url → an honest, NON-ACCUSATORY fallback. Do NOT assert the repo is private:
  // the mitrify autopsy proved a provably-PUBLIC repo can land here (an unclassified environmental clone
  // failure), so claiming "most likely private" sent the user chasing a non-existent access problem.
  return `I couldn't complete the clone of ${url} — it didn't finish for an unexpected reason. Please try the import again; if it keeps failing, double-check the URL, and if the repo is private make sure the GitHub account that owns it is connected (⚙ → GitHub).${ownerClause} ${TAIL}`;
}

/** The short internal reason threaded into the architect prompt so the model never re-asks for the URL. */
export function importFailureModelReason({ reason, hadToken }: Omit<ImportFailureContext, 'url'>): string {
  if (reason === 'network') return 'the clone hit a transient network error reaching GitHub';
  if (!hadToken) return 'no GitHub account is connected, so a private repo could not be accessed';
  if (reason === 'auth') return 'the connected GitHub account could not authenticate (the connection is likely expired)';
  if (reason === 'not-found') return 'the connected GitHub account cannot see this repo — it is private and owned by a different account, or the URL is wrong';
  if (reason === 'tls') return 'the clone could not establish a secure (TLS) connection to GitHub from the build environment — an environmental issue, not the repo';
  if (reason === 'protocol') return 'the clone connected but the transfer was interrupted before it finished (a network/protocol hiccup), not a repo-access problem';
  if (reason === 'disk') return 'the build environment ran low on disk space partway through the clone — an infrastructure issue, not the repo';
  return 'the clone did not finish for an unexpected reason (not necessarily a private-repo or access problem — a provably public repo can hit this via an environmental clone failure)';
}
