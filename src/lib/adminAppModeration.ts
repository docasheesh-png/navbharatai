// WHAT AN ADMIN CAN DO TO A PUBLISHED APP — the decision, kept pure so it can be tested.
//
// WHY IT EXISTS (admin 2026-09-17): *"published app ko, admin jab chahe unpublish ya ban kar sake!"*
// The server has been able to take an app down since 2026-08-21, but NOTHING in the app called that
// route — the capability existed and was unreachable, which is the same as not existing.
//
// 🔴 THE PART THAT MATTERS MOST, AND IT IS NOT THE BUTTONS: the two actions are NOT the same action
// with different words. `taken_down` is re-checked by the deploy gate, so it is PERMANENT — the owner
// can never publish that workspace again, and nothing on this screen or any other can undo it.
// `unpublished` only takes the live site off the internet; the owner publishes again from their own
// screen whenever they like. A moderator wants the second one far more often than the first, so the
// screen has to make the difference impossible to miss rather than merely stating it once.
//
// Everything here is PURE — no fetch, no React — because a wrong verdict about which action is
// available is how a moderator bans an app they meant to park.

/** The registry statuses a published app can hold (mirrors DeploymentStatus on the server). */
export type AppStatus = 'active' | 'held' | 'taken_down' | 'unpublished' | 'plan_paused' | string;

export interface AppStatusView {
  /** What the admin reads on the row. */
  label: string;
  /** Is the app reachable by the public right now? */
  live: boolean;
  /** Colour intent, resolved by the caller into classes. */
  tone: 'live' | 'off' | 'banned' | 'warn' | 'unknown';
  /** One line saying what this state actually means for the owner. */
  meaning: string;
}

/**
 * Describe a status honestly, including the one nobody plans for: a record with NO status.
 *
 * A record written before the status field existed has none, and the store treats that as 'active'.
 * Saying "unknown" instead would be worse than useless here — it is live, the admin is looking at
 * this screen to decide whether it should be, and a shrug is not an answer.
 */
export function appStatusView(status?: AppStatus): AppStatusView {
  switch (status || 'active') {
    case 'active':
      return { label: 'Live', live: true, tone: 'live', meaning: 'Anyone with the link can open this app.' };
    case 'unpublished':
      return { label: 'Offline', live: false, tone: 'off', meaning: 'Taken off the internet. The owner can publish it again themselves.' };
    case 'taken_down':
      return { label: 'Banned', live: false, tone: 'banned', meaning: 'Removed permanently. This workspace can never publish again.' };
    case 'held':
      return { label: 'Held', live: false, tone: 'warn', meaning: 'Held automatically — an outside address it uses was reported unsafe.' };
    case 'plan_paused':
      return { label: 'Paused', live: false, tone: 'warn', meaning: 'Paused over the owner’s hosting plan, not over its content.' };
    default:
      return { label: String(status), live: false, tone: 'unknown', meaning: 'An unrecognised state — treat it as not live.' };
  }
}

/**
 * Is UNPUBLISH worth offering? Only for an app that is actually serving.
 *
 * Offering it on an app that is already offline would be a button that deletes a channel which is
 * already gone and re-writes a status it already holds — it would "succeed" and change nothing,
 * which teaches a moderator that the buttons here are decorative.
 */
export function canUnpublish(status?: AppStatus): boolean {
  return appStatusView(status).live;
}

/**
 * Is BAN worth offering? For anything that is not ALREADY banned — including an app that is offline.
 *
 * ⚠️ That last part is deliberate and is the whole reason this is a function rather than `live`.
 * Banning an offline app is a real, meaningful action: the site is already down, but the owner can
 * still republish it, and a ban is precisely what stops that. Hiding the button on an offline app
 * would leave a moderator who has just parked something with no way to make it permanent.
 */
export function canBan(status?: AppStatus): boolean {
  return (status || 'active') !== 'taken_down';
}

/** A row as this screen needs it — a subset of the server's DeploymentRecord. */
export interface AppRow {
  workspaceId: string;
  userId?: string;
  url?: string;
  status?: AppStatus;
  updatedAt?: number;
}

/**
 * Does this row match what the admin typed? Matches the app id, the owner's id and the URL, because
 * a report arrives as whichever of the three the reporter happened to have.
 *
 * Case-insensitive, and an empty query matches everything (so the box starts by showing the list
 * rather than nothing).
 */
export function matchesAppQuery(row: AppRow, query: string): boolean {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return [row?.workspaceId, row?.userId, row?.url]
    .some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}

/**
 * The exact words of the confirmation, so the two actions can never read the same.
 *
 * Written here rather than in the JSX because THIS is the safeguard — the screen's whole protection
 * against a permanent mistake is that the admin reads a different sentence for a ban than for an
 * unpublish, and a sentence living in a component is one nothing can test.
 */
export function confirmCopy(action: 'unpublish' | 'ban'): { title: string; body: string; cta: string } {
  return action === 'ban'
    ? {
      title: 'Ban this app permanently?',
      body: 'The live site is removed and this workspace can NEVER publish again. This cannot be undone — not by you, and not by the owner. Use Unpublish instead if you only want it taken off the internet for now.',
      cta: 'Ban permanently',
    }
    : {
      title: 'Take this app offline?',
      body: 'The live site is removed right away. The owner keeps the app and can publish it again from their own screen whenever they want.',
      cta: 'Unpublish',
    };
}
