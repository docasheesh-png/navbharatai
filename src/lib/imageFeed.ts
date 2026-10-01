// WHICH PICTURES BELONG ON WHICH SCREEN (admin 2026-10-01).
//
// Admin, verbatim: *"user jab paid me swich kare, to ek dam new page open ho, abhi usi page me paid
// aur free swich ho ja rahe hai"* — and, in the same message, *"paid me logo nahi hoga! na
// navbharatai ka na kisi aur ka"*.
//
// 🔴 THE TWO ASKS ARE ONE DEFECT. Free and Paid shared a screen AND a feed, and pressing the chip
// changed the mode without regenerating anything — so the admin's own screenshot shows PAID lit with
// a watermarked FREE picture sitting under it. A free picture is fetched from the user's own
// connection with no account key, and the provider's `nologo` is not honoured on that door (it says
// so in `imageGen.ts`), so it carries the provider's mark BY DESIGN. On one shared feed that mark
// lands on the paid screen, where the rule forbids any mark at all.
//
// 🔒 THE RULE, and it is deliberately asymmetric: the PAID screen shows only pictures it made itself.
// A free picture can never appear there, whatever a toggle did. The FREE screen shows everything
// else, because a paid picture appearing among free ones breaks no rule and losing a user's history
// would.
//
// ⚠️ An item saved before this shipped carries no `tier`. It is shown on the FREE screen: we do not
// know which mode made it, and the one place an unknown must not be shown is the screen with the
// no-logo promise on it. Nothing is deleted and nothing is lost.
//
// PURE — no storage, no clock. One definition, so the two screens cannot drift apart.

/** The mode a picture was made in. Absent on anything saved before 2026-10-01. */
export type ImageFeedTier = 'free' | 'paid';

/** The minimum an item needs for this decision. */
export interface FeedItem {
  tier?: ImageFeedTier;
}

/** True when this picture belongs on the PAID screen — i.e. the paid ladder really made it. PURE. */
export function isPaidItem(item: FeedItem | null | undefined): boolean {
  return item?.tier === 'paid';
}

/** The pictures the given screen may show, in the order they were given. PURE. */
export function feedFor<T extends FeedItem>(items: readonly T[], tier: ImageFeedTier): T[] {
  const all = Array.isArray(items) ? items : [];
  return tier === 'paid' ? all.filter(isPaidItem) : all.filter((i) => !isPaidItem(i));
}
