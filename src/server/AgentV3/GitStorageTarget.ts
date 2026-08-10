// AgentV3 — git storage-target resolution (own-repo working-branch vs safe private mirror).
import { parseEnvFlag } from '../lib/envFlag';
//
// Admin-approved model (2026-07-05): when a user imports a repo they OWN, store build edits on a
// dedicated WORKING BRANCH inside that real repo — NOT a separate per-session mirror (which caused
// repo sprawl and left the user's real repo disconnected from their edits), and NEVER directly on the
// repo's default branch. `main` stays 100% safe: edits only ever land on the work branch, and reach
// `main` solely through a pull request the user merges when ready (branch → PR → CI green → merge).
//
// Any repo the user does NOT own (a public repo they only have read access to, an org repo, an anon
// session, or no GitHub sign-in) falls back to today's safe private mirror `app-<uid>-<session>`, so
// this is purely additive — it upgrades the one case (your own repo) that the mirror served poorly.
//
// Pure + fully unit-testable (no network); the route supplies the verified login / write-access.

/** The single, stable working branch build edits are pushed to inside the user's own repo. Stable
 *  (not per-session) so edits ACCUMULATE across sessions and never sprawl into new branches/repos. */
export const WORK_BRANCH = 'navbharatai/work';

/**
 * Master opt-in for own-repo working-branch storage. Default OFF so nothing changes for any user until
 * the admin flips `AGENTV3_OWN_REPO_STORAGE=on` — writing to a user's REAL repo is deliberately gated.
 * Off/absent → every build keeps today's safe private-mirror behaviour.
 */
export function ownRepoStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AGENTV3_OWN_REPO_STORAGE || '').trim().toLowerCase();
  return parseEnvFlag(v) === true;
}

export interface OwnRepoTarget {
  mode: 'own-repo';
  /** The imported repo's owner — equal to the authenticated user's login (we only target repos the
   *  user personally owns, so the user-token GitHub client's owner=login model holds). */
  owner: string;
  repo: string;
  /** The branch build edits are pushed to — NEVER the default branch. */
  workBranch: string;
  /** The repo's default branch, used as the PR base (where the work branch merges to). */
  baseBranch: string;
}
export interface MirrorTarget {
  mode: 'mirror';
  /** The safe private mirror repo name (`app-<uid>-<session>`) — today's behaviour. */
  repoName: string;
}
export type StorageTarget = OwnRepoTarget | MirrorTarget;

/**
 * Parse a plain `https://github.com/owner/repo[.git]` URL into `{ owner, repo }` (repo stripped of a
 * trailing `.git`). Returns null for anything that is not a two-segment github.com https URL. Mirrors
 * `sanitizeRepoUrl`'s acceptance rules (host + scheme + two path segments), minus the auth-token slot.
 */
export function parseGitHubRepo(url: string | null | undefined): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string') return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname.toLowerCase() !== 'github.com') return null;
  if (u.port) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  // Reject the degenerate `.`/`..` segments that the char class would otherwise allow.
  if (m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2] };
}

export interface ResolveStorageTargetInput {
  /** The repo the user chose to import this turn (request `importUrl`), if any. */
  importUrl: string | null | undefined;
  /** The authenticated user's GitHub login (from their OAuth token), if signed in with GitHub. */
  userLogin: string | null | undefined;
  /** Whether the user has verified PUSH (write) access to the imported repo (checked via the API). */
  hasWriteAccess: boolean;
  /** The imported repo's default branch (from the API), used as the PR base. Defaults to `main`. */
  baseBranch?: string | null;
  /** The safe fallback mirror repo name (`app-<uid>-<session>`). */
  mirrorRepoName: string;
  /** Master opt-in — own-repo storage is used only when true; otherwise always the mirror. */
  ownRepoEnabled: boolean;
}

/**
 * Decide where build edits are stored. Returns an `own-repo` target (a working branch in the user's
 * real imported repo) ONLY when EVERY guardrail holds:
 *   • the feature is explicitly enabled (`ownRepoEnabled`),
 *   • the import URL parses to a real github.com repo,
 *   • the user is signed in with GitHub (a login is known),
 *   • the imported repo is owned by THAT user (owner === login, case-insensitive — so the user-token
 *     client's owner=login assumption holds and we never write to someone else's repo), and
 *   • the user has verified write access.
 * Any miss → the safe private mirror (today's behaviour). Pure.
 */
export function resolveStorageTarget(input: ResolveStorageTargetInput): StorageTarget {
  const parsed = parseGitHubRepo(input.importUrl);
  const login = (input.userLogin || '').trim();
  const ownsRepo = !!parsed && login !== '' && parsed.owner.toLowerCase() === login.toLowerCase();
  if (input.ownRepoEnabled && parsed && ownsRepo && input.hasWriteAccess) {
    return {
      mode: 'own-repo',
      owner: parsed.owner,
      repo: parsed.repo,
      workBranch: WORK_BRANCH,
      baseBranch: (input.baseBranch || 'main').trim() || 'main',
    };
  }
  return { mode: 'mirror', repoName: input.mirrorRepoName };
}
