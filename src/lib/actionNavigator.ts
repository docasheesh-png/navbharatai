// THE ACTION NAVIGATOR — what is still left to do, and where it lives.
//
// THE ASK (admin 2026-09-21, verbatim): *"mujhe ek nevigator chahiye … jaise user ne app banaya ->
// preview par green dot 🟢 -> user ne apna app/game test kiya, ab 3 dot more par red dot. user ne more
// par click kiya, publish par red dot, user ne publish par click kiya, andar sabhi option par red dot.
// user ne publish on navbharatai par click kiya publish ho gaya = publish on navbharatai wala red dot
// gayab … aise hi aap pura flow analysis karo"*, and — asked directly — *"is system ko sirf navbharatai
// pro me hi nahi lagana, age chal kar aur bhi option me lagana hai"*.
//
// So this module is NOT a v5 feature. It is a rule engine with no surface attached: a surface hands it
// FACTS and asks what is pending; every button, every menu and every future screen asks the same
// function, so a trail can never disagree with itself. That is `publishFreshness.ts`'s own design
// ("Every one of those surfaces asks this function"), widened from one question to a tree of them.
//
// 🔵🔴 TWO TONES, AND THE SPLIT IS THE WHOLE DESIGN (admin approved: *"do rang theek hai"*).
// The ask said "red dot" throughout. Red on Publish would mean *publishing is broken* — it is not; the
// user simply has not published yet. Red on a failed build means *something IS broken* — it is. One
// colour for both teaches people within a week that red means nothing, which is the same lesson this
// codebase already paid for in `monitorAlerts.ts` (*"yeh alert to user ko bhaga dega"*). So:
//   • OPPORTUNITY (blue) — "you can do this next". Publishing, App Mart, a domain. Nothing is wrong.
//   • ATTENTION  (red)   — "something needs you". A failed build with no report, a live site serving
//                          an older app than the user has, a key a feature genuinely cannot run without.
// The mechanic the admin described is unchanged; only the colour of the harmless half is.
//
// ⚖️ FOUR LAWS, and each one is a real bug that would otherwise ship.
//
// 1. A DOT CLEARS ON THE FACT, NEVER ON THE CLICK. The ask gets this right for publishing
//    (*"publish ho gaya = red dot gayab"*, *"successful -> red dot hat gaya"*) and it is the rule
//    everywhere: opening a menu proves nothing was done. A dot that cleared on a click would be a
//    status indicator that reports success it did not measure — precisely what the second absolute
//    rule forbids, and the same distinction `markAppRendered` draws for a build.
//
// 2. A PARENT'S DOT IS COUNTED, NEVER STORED. `badgeAt` asks whether any pending action lives under
//    that path. There is no "the More button has a dot" flag anywhere, so it cannot be left switched
//    on after its last child is done, and no surface can disagree with another about it.
//
// 3. A FACT WE DO NOT KNOW PRODUCES NO DOT. Every optional field below is "we did not look", not
//    "no". `publishFreshness` already states the reason: *"a dot is a claim and we do not make claims
//    we did not measure"*. A navigator that guesses sends people to re-do work that is already done.
//
// 4. AN OPPORTUNITY CAN BE DISMISSED; AN ATTENTION CANNOT. Someone who does not want to publish
//    should be able to say so once. Someone whose live site is stale does not get to hide it by
//    tapping — that dot goes when the site is fixed. `pendingActions` enforces this, so no caller
//    can pass a dismissal that silences a fault.
//
// PURE — no I/O, no clock of its own, no React. Fully unit-testable, and reusable by any surface.

/** Red or blue. Ordered weakest → strongest: `strongerTone` relies on this order. */
export const ACTION_TONES = ['opportunity', 'attention'] as const;
export type ActionTone = (typeof ACTION_TONES)[number];

/**
 * One thing the user could do next.
 *
 * `path` is the route through the UI, outermost first — `['more', 'publish', 'navbharatai']` is the
 * "Host on NavBharatAI" button inside the Publish sheet inside the More menu. A surface asks
 * `badgeAt(actions, path)` with its OWN path and gets the roll-up for free; nothing has to be
 * registered, and a new screen joins by passing its own path.
 */
export interface PendingAction {
  /** Stable across renders and across sessions — a dismissal is remembered by this id. */
  id: string;
  path: readonly string[];
  tone: ActionTone;
  /** What this action is, in the user's words. Shown in a tooltip / screen reader, never a bare dot. */
  label: string;
  /** One honest line on WHY it is pending. Never a guess — it restates a fact we measured. */
  why: string;
}

/**
 * Everything the navigator is allowed to reason from.
 *
 * ⚠️ EVERY OPTIONAL FIELD MEANS "WE DID NOT LOOK", NOT "NO" (law 3). A surface that cannot answer
 * a question leaves the field out and the matching dot simply never appears — which is why adding a
 * new surface can never make this module start lying.
 */
export interface NavigatorFacts {
  /**
   * Is a build running right now? While it is, nothing is offered: the app is mid-change, and a dot
   * inviting a publish of a half-written app is worse than no dot at all.
   */
  building?: boolean;

  /** Did the last build END, and did it succeed? Both undefined until a build has finished. */
  buildFinished?: boolean;
  buildOk?: boolean;

  /**
   * How long the user has actually had the preview open and running, in ms.
   *
   * The ask is explicit that the trail starts only AFTER the app has been tried — *"jaise hi user
   * preview chalaye, thodi der chala le, uske bad"*. A dot that appeared the instant a build ended
   * would be nagging somebody who has not yet seen their own app.
   */
  previewDwellMs?: number;

  /** `publishFreshness()`'s verdict for this workspace. `undefined` ⇒ not looked up yet. */
  publishFreshness?: 'never_published' | 'up_to_date' | 'changed' | 'unknown';

  /** Is a custom domain already connected? `undefined` ⇒ unknown. */
  customDomainConnected?: boolean;
  /** Is connecting one even offered here? (server flag + workspace + our hosting available) */
  customDomainOffered?: boolean;

  /** Is this app on App Mart? `undefined` ⇒ we did not look, so nothing is claimed. */
  appMartPublished?: boolean;
  /** Has an Android build been produced for this app? `undefined` ⇒ unknown. */
  apkBuilt?: boolean;

  /** How many reports the user has already sent for the CURRENT build. */
  reportsSentForThisBuild?: number;

  /**
   * Keys the app's own code needs and the vault does not hold. This is the one key-related dot, and
   * it is RED because a missing required key is not an opportunity — the feature cannot run without
   * it. `undefined` ⇒ nobody has checked, so nothing is shown (law 3); an app with no integrations
   * must never be nagged about keys it does not use.
   */
  missingRequiredKeys?: number;

  /** Ids the user has dismissed. Ignored for `attention` actions — see law 4. */
  dismissed?: readonly string[];
}

/**
 * How long the preview must have been open before the trail starts.
 *
 * Twenty seconds: long enough that somebody has actually looked at their app rather than glanced at
 * a loading frame, short enough that a user who IS ready is not kept waiting. It is a threshold on
 * real accumulated time, never a timer that runs while the tab is closed.
 */
export const PREVIEW_DWELL_MS = 20_000;

/** The app is finished, it worked, and the user has really looked at it. */
function appIsProven(f: NavigatorFacts): boolean {
  if (f.building) return false;
  if (f.buildFinished !== true || f.buildOk !== true) return false;
  return (f.previewDwellMs ?? 0) >= PREVIEW_DWELL_MS;
}

/**
 * What is left to do, strongest first.
 *
 * Deliberately NOT capped. The dependency ordering below is what keeps the list short — a domain is
 * only offered once something is published, so the most a healthy app can show at once is three
 * blue dots inside one sheet. A cap would eventually hide a real attention item, and hiding a fault
 * to tidy a menu is the wrong trade.
 */
export function pendingActions(facts: NavigatorFacts): PendingAction[] {
  const out: PendingAction[] = [];

  // ── ATTENTION (red) — something is wrong and the user is the only one who can fix it. ──────────

  // B. The build failed. The ask: *"3 dot par red dot -> andar report par red dot"*.
  // Cleared by the report being SENT, not by the popup being opened (law 1).
  if (facts.buildFinished === true && facts.buildOk === false && !facts.building) {
    if ((facts.reportsSentForThisBuild ?? 0) === 0) {
      out.push({
        id: 'report.failed-build',
        path: ['more', 'report'],
        tone: 'attention',
        label: 'Report this build',
        why: 'This build did not finish. Telling us what happened is what gets it fixed.',
      });
    }
  }

  // The live site is serving an OLDER app than the one the user has. This is the one case red was
  // already used for, and it stays red: real visitors are seeing the wrong thing right now.
  // `needsPublishDot` in publishFreshness.ts is the same verdict; that module stays the authority on
  // what 'changed' means, and this one only decides where the dot goes.
  if (facts.publishFreshness === 'changed' && !facts.building) {
    out.push({
      id: 'publish.stale',
      path: ['more', 'publish', 'navbharatai'],
      tone: 'attention',
      label: 'Publish your changes',
      why: 'Your live site is older than your app — visitors are seeing the previous version.',
    });
  }

  // C. A key the app genuinely cannot run without.
  if ((facts.missingRequiredKeys ?? 0) > 0) {
    const n = facts.missingRequiredKeys ?? 0;
    out.push({
      id: 'secrets.missing-required',
      path: ['more', 'secrets'],
      tone: 'attention',
      label: 'Add your keys',
      why: `Your app needs ${n} key${n === 1 ? '' : 's'} that are not saved yet — that part cannot run without ${n === 1 ? 'it' : 'them'}.`,
    });
  }

  // ── OPPORTUNITY (blue) — nothing is wrong; there is simply a next step. ───────────────────────
  // Everything below is gated on the app being PROVEN, so a user who has not yet seen their own app
  // is never nagged, and a failed build offers no next steps at all.

  if (appIsProven(facts)) {
    // Publishing is the first step, and everything else in the sheet reads better after it.
    if (facts.publishFreshness === 'never_published') {
      out.push({
        id: 'publish.first',
        path: ['more', 'publish', 'navbharatai'],
        tone: 'opportunity',
        label: 'Put your app online',
        why: 'Your app works. Publishing gives it a link you can share.',
      });
    }

    // A domain points AT something, so it is offered only once there is something live. Without this
    // ordering the sheet would open with every option dotted at once, which is the wall of dots this
    // design exists to avoid.
    if (
      facts.customDomainOffered === true &&
      facts.customDomainConnected === false &&
      (facts.publishFreshness === 'up_to_date' || facts.publishFreshness === 'changed')
    ) {
      out.push({
        id: 'publish.domain',
        path: ['more', 'publish', 'domain'],
        tone: 'opportunity',
        label: 'Use your own domain',
        why: 'Your app is live. You can put it on your own web address.',
      });
    }

    // Both of these stay silent unless somebody actually answered the question (law 3).
    if (facts.appMartPublished === false) {
      out.push({
        id: 'publish.appmart',
        path: ['more', 'publish', 'appmart'],
        tone: 'opportunity',
        label: 'Put it on App Mart',
        why: 'People can open your app from App Mart without installing anything.',
      });
    }

    if (facts.apkBuilt === false) {
      out.push({
        id: 'publish.apk',
        path: ['more', 'publish', 'apk'],
        tone: 'opportunity',
        label: 'Make an Android app',
        why: 'Your app can be turned into a real installable Android app.',
      });
    }
  }

  const dismissed = new Set(facts.dismissed ?? []);
  // Law 4, enforced here rather than trusted to callers: a dismissal can only ever silence blue.
  const kept = out.filter((a) => a.tone === 'attention' || !dismissed.has(a.id));

  // Attention first, so a surface that shows only the top item shows the one that matters.
  return kept.sort((a, b) => toneRank(b.tone) - toneRank(a.tone));
}

function toneRank(tone: ActionTone): number {
  return ACTION_TONES.indexOf(tone);
}

/** The stronger of two tones; `null` counts as weakest. Used to roll a subtree up into one dot. */
export function strongerTone(a: ActionTone | null, b: ActionTone | null): ActionTone | null {
  if (a === null) return b;
  if (b === null) return a;
  return toneRank(a) >= toneRank(b) ? a : b;
}

/**
 * The dot for ONE place in the UI — the roll-up (law 2).
 *
 * Returns the strongest tone among the actions at or below `path`, or `null` for no dot. A leaf asks
 * with its own full path; the More button asks with `['more']` and gets a dot exactly while anything
 * under it is pending. Nothing is stored, so nothing can be left behind.
 *
 * An EMPTY path deliberately means "anywhere", which is what a global indicator would ask.
 */
export function badgeAt(actions: readonly PendingAction[], path: readonly string[]): ActionTone | null {
  let tone: ActionTone | null = null;
  for (const action of actions) {
    if (!startsWith(action.path, path)) continue;
    tone = strongerTone(tone, action.tone);
    if (tone === 'attention') return tone; // cannot get stronger
  }
  return tone;
}

/** The actions at or below a path, in the order `pendingActions` returned them. */
export function actionsAt(actions: readonly PendingAction[], path: readonly string[]): PendingAction[] {
  return actions.filter((a) => startsWith(a.path, path));
}

function startsWith(full: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (full[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * A one-line summary for a tooltip or a screen reader — a dot alone is not an accessible label.
 * Returns `null` when there is nothing pending, so a caller can spread it without a branch.
 */
export function badgeLabelAt(actions: readonly PendingAction[], path: readonly string[]): string | null {
  const here = actionsAt(actions, path);
  if (here.length === 0) return null;
  if (here.length === 1) return here[0]!.label;
  return `${here.length} things you can do`;
}
