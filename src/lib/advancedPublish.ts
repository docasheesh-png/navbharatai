// WHICH PUBLISH PATHS ARE "ADVANCED" — the last half of ROADMAP §11 slice 5 / §13 item 2.4.
//
// Slice 5's promise is ONE Publish button: a user who just wants their app on the internet presses one
// thing and it is live. The screen did not deliver that. "Host on NavBharatAI" sat as the first of four
// equally-weighted cards, and the second one — "Host somewhere else" — asked a person who has never
// heard of Vercel to decide between their own cloud account and ours before anything happened.
//
// So the bring-your-own paths (deploy to the user's own provider, and "I host it myself" through a pull
// request into their GitHub repo) move behind an Advanced disclosure. NOTHING IS REMOVED: every path
// still exists, still works, and is one press away. What changes is which of them the default screen
// argues for.
//
// 🔴 THE RULE THAT KEEPS THIS FROM BEING A REGRESSION, and it is the whole reason this decision is a
// module rather than a `useState(false)`: A PATH SOMEBODY IS ALREADY USING IS NEVER HIDDEN. A user who
// has connected Vercel, or whose app already lives in their own GitHub repo, has told us in the
// strongest way available which path is theirs — collapsing it would be us overruling that with a
// default. For them the section opens by itself, and the disclosure is only a way to fold it away.
//
// Hiding a control somebody relies on behind a click they have no reason to make is indistinguishable,
// from their side, from the feature having been deleted.
//
// PURE — no DOM, no state, no fetch.

export interface AdvancedPublishInput {
  /** Providers the user has genuinely CONNECTED (configured), excluding NavBharatAI's own host. */
  connectedProviders: number;
  /** True when the app is already stored in the user's own GitHub repo (own-repo working branch). */
  hasOwnRepo: boolean;
}

/**
 * Should the Advanced (bring-your-own hosting) section start expanded?
 *
 * True only when the user is demonstrably already on one of those paths — see the header. A brand-new
 * user gets the collapsed, one-button screen slice 5 promised.
 */
export function advancedPublishStartsOpen(input: AdvancedPublishInput): boolean {
  const connected = Number(input?.connectedProviders);
  if (Number.isFinite(connected) && connected > 0) return true;
  return input?.hasOwnRepo === true;
}

/**
 * The disclosure's own label.
 *
 * It names what is inside rather than saying "Advanced" alone, because a label that only signals
 * difficulty tells a user nothing about whether the thing they want is behind it — and the one group
 * of people who NEED this section (they already have a host) are exactly the people who would not
 * think of themselves as advanced.
 */
export const ADVANCED_PUBLISH_LABEL = 'Host it somewhere else instead';

/** The one line under the label, so the choice can be made without expanding it. */
export const ADVANCED_PUBLISH_HINT =
  'Publish to your own Vercel, Netlify, Cloudflare or GitHub Pages account, or keep hosting entirely yourself.';
