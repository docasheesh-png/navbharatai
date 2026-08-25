// The first time a user's app goes live — the rules of that moment.
//
// ADMIN 2026-08-21: "jab user ke pahli baar mitrify link milta hai, 2-3 second ke liye firework, aur
// website link + Open button — jisse user ko accha feel ho." Until now a first-ever live link arrived
// as one line of grey text ("Your app is live at …"), which is the same thing the fiftieth publish
// says. This module holds every DECISION in that moment so the decisions are testable on their own,
// and so the celebration can never disagree with itself across surfaces.
//
// THREE RULES, AND EACH ONE IS A DELIBERATE DEPARTURE FROM "JUST SHOW CONFETTI":
//
//   1. THE FIREWORKS END; THE LINK DOES NOT. A 3-second animation is a delight. A card that takes the
//      user's first-ever link away with it after 3 seconds is a bug wearing a party hat — that link is
//      the one thing they want to copy and send to someone. The animation is timed; the card is
//      dismissed by the user.
//   2. NOTHING IS CELEBRATED UNTIL IT IS TRUE. A firework over a link that does not open is a worse
//      first impression than no firework at all, and it is exactly the fake-success this codebase
//      forbids. The link is checked WHILE the animation plays, so the honesty costs the user no time.
//   3. A USER WHO ASKED FOR LESS MOTION GETS LESS MOTION. The app already has that setting; a
//      "premium" feature that overrides a preference the user set themselves is not premium.

/** What the moment can be. Kept explicit so no surface has to re-derive it from booleans. */
export type CelebrationKind =
  /** Verified live, full fireworks. */
  | 'celebrate'
  /** Verified live, but the user prefers reduced motion — the card, calmly, with no particles. */
  | 'calm'
  /** Published, but the link did not answer yet. Honest wording, no fanfare. */
  | 'pending'
  /** Not this user's first publish — no celebration surface at all. */
  | 'none';

export interface CelebrationInput {
  /** Did the SERVER say this is the user's first-ever successful publish? */
  firstPublish: boolean;
  /** The live URL the server returned. */
  url: string;
  /** Did the link answer when we checked it? `null` = the check could not run. */
  linkLive: boolean | null;
  /** Does this user want reduced motion (their setting, or the OS's)? */
  reducedMotion: boolean;
}

/**
 * Decide what to show. Pure.
 *
 * A missing URL means there is nothing to celebrate WITH — no link, no card. An unreachable check
 * (`linkLive: null`) is treated as LIVE: the server confirmed the publish, and a browser that cannot
 * make the check (offline, blocked, CORS) is not evidence the user's app is broken. Only a real,
 * answered "no" downgrades the moment.
 *
 * ⚠️ EVERY SUCCESSFUL PUBLISH NOW GETS THIS SCREEN, not only the first (admin 2026-08-25: "aaj app
 * NavBharatAI par publish ho jaye to celebration animation aana chahiye, aur publish app par jaane ka
 * button aur copy link ka option").
 *
 * The original design fired once per user, on the reasoning that the fiftieth publish is not an
 * occasion. That was right about the FIREWORKS and wrong about the SCREEN. What follows a publish is
 * the same three things every single time — see it, copy it, send it — and before this they arrived as
 * one line of grey text behind a sheet full of other buttons. A user republishing after a fix needs
 * that link exactly as much as a first-timer does.
 *
 * `firstPublish` is therefore no longer a gate; it is kept on the input because the SURFACE still uses
 * it — the wording differs for someone seeing their first live link. A flag that changes the copy is
 * not the same as a flag that decides whether the user gets their link at all.
 */
export function celebrationFor(input: CelebrationInput): CelebrationKind {
  if (!input.url.trim()) return 'none';
  if (input.linkLive === false) return 'pending';
  return input.reducedMotion ? 'calm' : 'celebrate';
}

/** How long the particles run. The CARD outlives this — see rule 1. */
export const FIREWORK_MS = 3000;

/**
 * The share text for the one thing a user actually does with their first link: send it to someone.
 *
 * WHATSAPP IS FIRST ON PURPOSE. This is India's share button, and the moment a person's first app
 * reaches their family chat is the moment the product spreads without us paying for it. Competitors
 * hand over a URL and stop there.
 */
export function shareText(url: string, appName?: string): string {
  const name = (appName || '').trim();
  return name
    ? `I made an app — ${name} 🎉\n${url}\n\nBuilt with NavBharatAI`
    : `I made my first app 🎉\n${url}\n\nBuilt with NavBharatAI`;
}

/** The WhatsApp share link for that text. Encoded once, here, so no call site has to remember to. */
export function whatsappShareUrl(url: string, appName?: string): string {
  return `https://wa.me/?text=${encodeURIComponent(shareText(url, appName))}`;
}

/** The host shown on the card — a full URL with its scheme is noise in a headline. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
