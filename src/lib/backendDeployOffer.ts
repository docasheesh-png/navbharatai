// backendDeployOffer — THE MISSING HALF OF THE PUBLISH REFUSAL (admin report 2026-08-25:
// "yeh publish to navbharat ai ho hi nahi raha").
//
// 🔒 THE BUG THIS CLOSES, AND WHY IT IS A RULE-2 FAILURE. Pressing "Publish on NavBharatAI" with a
// full-stack app returns a 422 whose message ends: `Use "Deploy backend" to put the whole app
// somewhere it can run.` The refusal itself is CORRECT — uploading an Express app to a static CDN
// produces a site that loads and whose every button silently fails, which is exactly what the publish
// route exists to prevent. What was broken is the sentence after it: a repo-wide search for "Deploy
// backend" across the client found NOTHING. The control the refusal names does not exist on any
// screen reachable from Publish.
//
// The 50/50 half — why it could arise at all: `deployDecision` returns a machine `code` whose own
// comment reads "a machine code the client can branch on to show the right button", and NO CLIENT
// EVER READ IT. The decision was designed to be consumed by a branch nobody wrote, so the message
// promising a button and the absence of that button could not contradict each other anywhere. This
// module is that branch, and `backendDeployOfferTest` pins every code the server can emit to a
// handled outcome, so a new refusal code cannot ship with no way to act on it.
//
// PURE: facts in, offer out. No fetch, no env, no React — so every rule below is testable on its own.

/** Every refusal code `deployDecision` (server) can return. Kept in lockstep by the guard test. */
export type PublishRefusalCode = '' | 'needs-server-hosting' | 'backend-deploy-available';

/** Whose Render key the server resolved for this app — the user's own, ours, or none at all. */
export type BackendKeySource = 'user' | 'server' | null;

/**
 * The exact words the button carries. The server's refusal names this control by name, so the label
 * is a shared constant rather than two strings that agree today: a rename in one place with no
 * matching rename in the other recreates the dead end this file exists to close.
 */
export const DEPLOY_BACKEND_LABEL = 'Deploy backend';

export interface BackendDeployOffer {
  /** Render the panel at all. False for an ordinary static app, where publish simply works. */
  show: boolean;
  /** Heading for the panel. */
  title: string;
  /** May the button actually run right now? False ⇒ `steps` says what has to happen first. */
  canDeploy: boolean;
  /** `owner/repo` for the deploy request, or '' when this app has no repo behind it. */
  repoPath: string;
  /** Numbered prerequisites. Never empty when `canDeploy` is false — that would be a dead end again. */
  steps: string[];
  /** The one action offered beside the steps. */
  cta: 'none' | 'connect-github' | 'save-render-key';
  /** An honest caveat shown WITH a live button (not instead of it). '' when there is nothing to add. */
  note: string;
}

const SAVE_KEY_STEPS = [
  'Create a free account at render.com — this is your account and your billing, never NavBharatAI’s.',
  'In Render, open Account Settings → API Keys and create a key.',
  'Save it in NavBharatAI under Settings → Secrets & API Keys as RENDER_API_KEY.',
  'Come back here and press Publish again.',
];

const REPO_STEPS = [
  'Your code has to live in a GitHub repository first — that is what a host reads it from.',
  'Connect GitHub, then push this app to a repo of your own.',
  'Come back here and press Publish again.',
];

/**
 * What can this user actually DO about a publish that was refused for needing a server? PURE.
 *
 * 🔒 A FALSE OFFER IS WORSE THAN A HONEST WALL. The button is only offered when the request it would
 * send can genuinely be built — the deploy matches a host service BY REPOSITORY URL, so with no repo
 * behind this app there is nothing to match and pressing it could only ever fail. In that case the
 * panel states the real prerequisite instead. That is the same rule the refusal itself broke.
 *
 * 🔒 AND THE KEY'S OWNER IS SAID OUT LOUD. When the deploy would run on NAVBHARATAI's Render key, a
 * service the user created in their OWN Render account is invisible to it — so "connect your repo in
 * Render" would send them to do a thing that cannot close the loop. The button still runs (a matching
 * service is not impossible, and an honest failure is a real answer), but the caveat travels with it.
 */
export function backendDeployOffer(input: {
  code?: string | null;
  ownRepo?: { owner: string; repo: string } | null;
  githubConnected?: boolean;
  keySource?: BackendKeySource;
}): BackendDeployOffer {
  const code = String(input.code ?? '');
  const none: BackendDeployOffer = {
    show: false, title: '', canDeploy: false, repoPath: '', steps: [], cta: 'none', note: '',
  };
  if (code !== 'needs-server-hosting' && code !== 'backend-deploy-available') return none;

  const title = 'Your app has a server half';

  // Nothing on this server can deploy a backend for this user yet — their own key is the way in.
  if (code === 'needs-server-hosting') {
    return {
      show: true,
      title,
      canDeploy: false,
      repoPath: '',
      steps: SAVE_KEY_STEPS,
      cta: 'save-render-key',
      note: '',
    };
  }

  const owner = String(input.ownRepo?.owner ?? '').trim();
  const repo = String(input.ownRepo?.repo ?? '').trim();
  const repoPath = owner && repo ? `${owner}/${repo}` : '';

  if (!repoPath) {
    return {
      show: true,
      title,
      canDeploy: false,
      repoPath: '',
      steps: REPO_STEPS,
      cta: input.githubConnected ? 'none' : 'connect-github',
      note: '',
    };
  }

  return {
    show: true,
    title,
    canDeploy: true,
    repoPath,
    steps: [],
    cta: 'none',
    note: input.keySource === 'server'
      ? 'This runs on NavBharatAI’s hosting key. If your app lives in your own Render account, save your '
        + 'RENDER_API_KEY under Settings → Secrets & API Keys first so the deploy can find it.'
      : '',
  };
}
