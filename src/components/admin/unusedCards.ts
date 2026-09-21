// CARDS PROPOSED FOR DELETION — the register the red marks are drawn from.
//
// ADMIN 2026-09-21: *"admin penal me bahut se card aise hai, jinki koi need nahi hai. identify karo!
// aur un par temporary red mark laga do! mai ja kar check karunga kon kon se card par mark hai. woh
// apke delete karwa dunga!!"*
//
// 🔴 THE BAR FOR A MARK IS PROOF, NOT TASTE — and that is the whole design of this file. A card is
// listed ONLY when one of three things can be shown in the code:
//   (a) DUPLICATE — another card on the SAME screen answers the same question from the same data;
//   (b) SUPERSEDED — a later card answers it strictly better, and this one is the older half;
//   (c) NOT DURABLE — the number resets on every deploy while a durable equivalent sits beside it.
// A card that merely looks busy, or that this session would not have designed, is NOT listed.
//
// 🔒 A DELIBERATE DUPLICATE IS NOT A DUPLICATE. The "Published Apps" tile repeats the Publish
// Capacity card immediately below it and is NOT marked, because its own comment records the reason
// it was added — the card *"sits under four rows of tiles, and the admin did not know it existed"*
// — and states that both read one source so they can never disagree. That is a decision with a
// reason attached, and overriding it from a count of cards would be exactly the sycophantic
// agreement the third absolute rule forbids. Anything similar must be left alone the same way.
//
// ⚠️ EVERY MARK CARRIES ITS CAVEAT. Where a marked card holds something its twin does NOT (the AI
// Insights ask-box), the caveat says so, because the admin is deciding a deletion from this text and
// a mark that hides what would be lost is worse than no mark.
//
// TEMPORARY BY CONSTRUCTION: one register, one badge component, one call site per card. Removing the
// feature is deleting this file, `UnusedCardMark.tsx` and the marks — nothing else changes.
//
// PURE — no React, no DOM, so the register can be asserted against the real call sites by a test.

export type UnusedReason = 'duplicate' | 'superseded' | 'not-durable';

export interface UnusedCard {
  /** Stable id used by the badge and by the test that proves the mark is really rendered. */
  id: string;
  /** The heading exactly as the admin sees it on screen. */
  title: string;
  /** Which tab to look on. */
  tab: string;
  reason: UnusedReason;
  /** Why it is proposed, in the admin's terms — this is what they decide from. */
  why: string;
  /** What would be LOST by deleting it, when anything would be. Empty means nothing. */
  caveat?: string;
}

export const UNUSED_CARDS: readonly UnusedCard[] = [
  {
    id: 'health-score-duplicate',
    title: 'Platform Health Score',
    tab: 'Monitor',
    reason: 'duplicate',
    why: 'The live "Platform health" panel higher up this same page shows the same grade and the same '
      + 'Health / Reliability / Risk numbers. That panel\'s own comment says it is built "from the same '
      + 'inputs as /api/admin/health-score", which is the endpoint this card calls.',
  },
  {
    id: 'ai-insights-duplicate',
    title: 'AI Insights',
    tab: 'Monitor',
    reason: 'duplicate',
    why: 'The live "Insights" panel higher up this same page already lists the same findings with the '
      + 'same severity chips.',
    caveat: 'This card ALSO carries the ask-box that answers a typed question about the telemetry. '
      + 'That box exists nowhere else, so deleting the whole card would remove it. Keeping the box and '
      + 'dropping the duplicated list is the smaller change.',
  },
  {
    id: 'provider-token-burn-duplicate',
    title: 'Provider Token Burn',
    tab: 'Monitor',
    reason: 'duplicate',
    why: 'It draws the same providerRanking array as the "API Usage Ranking" card directly beside it, '
      + 'and the live "Engine cost split" donut higher up the page is a third view of the same split.',
  },
  {
    id: 'since-boot-not-durable',
    title: 'Since this server started',
    tab: 'Monitor',
    reason: 'not-durable',
    why: 'Every number here resets to zero on each deploy, so it cannot show a trend and can be '
      + 'misread as a drop in traffic the morning after a release. The live stat row above it carries '
      + 'builds, success rate, average build time and engine cost for a window you choose, from stored '
      + 'daily snapshots that survive a deploy.',
  },
  {
    id: 'recent-token-purchases-superseded',
    title: 'Recent Token Purchases',
    tab: 'Monitor',
    reason: 'superseded',
    why: 'Revenue → "Purchases — who paid, for what" answers the same question from the real payment '
      + 'records, with the buyer named, a search box and all-time totals. This card is the older, '
      + 'shorter list with a truncated id.',
  },
];

/** One mark's entry, or undefined for an id nothing registers. */
export function unusedCard(id: string): UnusedCard | undefined {
  return UNUSED_CARDS.find((c) => c.id === id);
}

/** The short words on the badge itself. Long enough to mean something at a glance. */
export function reasonLabel(reason: UnusedReason): string {
  switch (reason) {
    case 'duplicate': return 'DUPLICATE';
    case 'superseded': return 'SUPERSEDED';
    case 'not-durable': return 'RESETS ON DEPLOY';
    // Total by construction: a new reason must be given a label rather than falling through to one
    // that would misdescribe it on the screen the admin deletes from.
    default: { const never: never = reason; return never; }
  }
}
