// App Mart's REVIEW list, as pure rules.
//
// WHY THEY LIVE OUTSIDE THE COMPONENT: the list used to ask the server for `status=pending` only, so
// the instant an admin approved an app it VANISHED from the only screen that showed it — no record of
// what had been approved, and no way back to it to take it down (admin 2026-08-21: "app mart me, admin
// aprove kare uske bad, app waha se gayab na ho, 'aproved' likh kar dikhti rahe"). The list is now
// built from two calls, and what it does with them is a decision worth pinning rather than an
// expression buried in a network callback. NavAppStore is network-backed, so a static render only ever
// reaches its loading state — extracting these is how they become checkable at all.

/** Only the fields the review rules actually read. The real record carries far more. */
export interface ReviewQueueApp { id: string; status?: string }

/**
 * The review list = apps WAITING, then apps ALREADY APPROVED.
 *
 * Order is deliberate: pending is the WORK and belongs at the top; approved is a RECORD and follows.
 * De-duplicated by id, because the two calls are independent — an app approved in the moment between
 * them would otherwise appear twice, and the first (pending) copy would show stale actions.
 */
export function mergeReviewQueue<T extends ReviewQueueApp>(
  pending: readonly T[] | null | undefined,
  approved: readonly T[] | null | undefined,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const a of [...(pending ?? []), ...(approved ?? [])]) {
    if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/**
 * The tab badge counts only what still needs a DECISION. Counting approved apps too would make the
 * badge permanent — a number that never reaches zero stops meaning "there is work here".
 */
export function pendingReviewCount(queue: readonly ReviewQueueApp[]): number {
  return queue.filter((a) => !isLiveOnStore(a.status)).length;
}

/**
 * Is this app already ON App Mart? An APK says `approved`, an instant (web) app says `listed`. Both
 * lanes keep a live app on the review screen with only a Remove action (admin 2026-10-04: listing a web
 * app emptied the review page — the 2026-08-21 rule had been applied to the APK lane only).
 */
export function isLiveOnStore(status: string | undefined): boolean {
  return status === 'approved' || status === 'listed';
}

/** What the badge on each card says. Approved apps stay on screen SAYING they are approved. */
export function reviewStatusLabel(status: string | undefined): 'Approved' | 'On the store' | 'Waiting' {
  if (status === 'approved') return 'Approved';
  if (status === 'listed') return 'On the store';
  return 'Waiting';
}

/**
 * Which actions a card offers.
 *
 * An approved app is already live in the store, so "Publish" and "Reject" would be buttons that
 * describe a decision already made — the only thing left is whether to take it down. Rule 2: never
 * render an action whose label does not match what it does.
 */
export function reviewActionsFor(status: string | undefined): 'remove' | 'decide' {
  return isLiveOnStore(status) ? 'remove' : 'decide';
}

// ── The Review HUB (admin 2026-10-05: "instant app aur apk app, dono aise bahar hi hai … pahle 2 button banao,
// 'manage app, manage apk' aur uske andar apps dikhe, aise bahar pura page bekar dikh raha hai") ──────────────
// The Review tab used to stack four lists on one long scroll — reported comments, viewer reports, instant apps
// and Android apps — so the one an admin came for was somewhere below the others. It now opens on three buttons
// that say what is inside each, and a button opens ONE list.

/** The three things an admin reviews. */
export type ReviewSection = 'apps' | 'apks' | 'reports';
/** Inside a list: the requests still to decide, or the apps already live on App Mart. */
export type ReviewFilter = 'waiting' | 'live';

export interface ReviewSectionCount { waiting: number; live: number }

/** Waiting vs live for one lane — the numbers its hub button shows. */
export function reviewSectionCount(list: readonly ReviewQueueApp[] | null | undefined): ReviewSectionCount {
  let waiting = 0; let live = 0;
  for (const a of list ?? []) {
    if (!a) continue;
    if (isLiveOnStore(a.status)) live++; else waiting++;
  }
  return { waiting, live };
}

/** The apps a filter shows, in the order given. */
export function filterReviewList<T extends ReviewQueueApp>(list: readonly T[] | null | undefined, filter: ReviewFilter): T[] {
  return (list ?? []).filter((a) => !!a && (filter === 'live' ? isLiveOnStore(a.status) : !isLiveOnStore(a.status)));
}

/**
 * Which list opens first when a section is opened: the requests waiting for a decision when there are any —
 * that is the work — otherwise the apps on the store, so an empty "Waiting" never hides a full shelf.
 */
export function defaultReviewFilter(count: ReviewSectionCount): ReviewFilter {
  return count.waiting > 0 || count.live === 0 ? 'waiting' : 'live';
}
