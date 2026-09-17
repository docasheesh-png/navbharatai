// publishedAppsView — one shape for "the apps this person has published", for the TWO screens that
// now show it: the user's own My Profile, and the admin's account sheet for a user.
//
// ADMIN 2026-09-17: *"my profile page me kitne app published huyi hai woh bhi dikhe, waha direct us
// app ko open karne ka button ya link ho, aur app ek new page me open ho … sath hi jab admin kisi
// user ki profile dekhe, to waha bhi woh list dikhe, app open admin bhi kar sake."*
//
// 🔎 NEITHER SIDE NEEDED A NEW SERVER ROUTE, and that is worth recording rather than re-discovering.
// `GET /api/agentv3/my-published-apps` has listed the caller's own live apps for some time (it is
// what the Publish sheet's "Your published apps" reads), and `GET /api/admin/users/:uid/account`
// already returns `publishedApps.rows` complete with each url — the admin dashboard simply printed the
// COUNT and threw the rows away. What was missing was not data. It was a screen.
//
// The two sources do not agree on shape, which is why this module exists: the user's endpoint
// pre-filters to live apps and drops `status`, while the admin's returns every record with its
// status attached. One normaliser, so the two screens cannot end up with different ideas of what
// "published" means.

/** A deployment's lifecycle state, as `DeploymentStore` defines it. */
export type PublishedAppStatus = 'active' | 'held' | 'taken_down' | 'unpublished' | 'plan_paused';

export interface PublishedAppRow {
  /** Stable key, and the id every admin action addresses. */
  workspaceId: string;
  url: string;
  /** The address as a person reads it — no scheme, no trailing slash. */
  label: string;
  updatedAt: number | null;
  sizeMb: number | null;
  status: PublishedAppStatus;
  /** Its chat was deleted, so it cannot be reopened for editing — but it is still live. */
  orphaned: boolean;
  /**
   * May this row offer an Open button?
   *
   * 🔒 TWO conditions, and the URL check is the one that matters on a privileged screen. The admin
   * sheet renders whatever is stored against a user's account, so a record carrying a
   * `javascript:` or `data:` address would otherwise become a link an admin is invited to click.
   * Nothing writes such a URL today — which is exactly the assumption a validator is for.
   */
  openable: boolean;
}

/** Anything the two endpoints can hand us. Deliberately loose — it crosses a network. */
export interface RawPublishedApp {
  workspaceId?: unknown;
  url?: unknown;
  updatedAt?: unknown;
  sizeMb?: unknown;
  status?: unknown;
  orphaned?: unknown;
}

const STATUSES: readonly PublishedAppStatus[] = ['active', 'held', 'taken_down', 'unpublished', 'plan_paused'];

/**
 * Is this a web address we are willing to send somebody to?
 *
 * http(s) only. `openExternalUrl` applies the same rule again at the moment of opening — this one
 * decides whether the button is even offered, so a row that could never open does not pretend it can.
 */
export function isOpenableUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const p = new URL(url);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The address as a person reads it: no scheme, no trailing slash, never empty. */
export function appLabel(url: unknown): string {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return 'Unknown address';
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || raw;
}

/** What to call this state on screen. Admin-facing; the user's own list only ever shows live apps. */
export function statusWords(status: PublishedAppStatus): string {
  switch (status) {
    case 'active': return 'Live';
    case 'held': return 'Held for review';
    case 'taken_down': return 'Taken down';
    // Said in the owner's voice on purpose — an admin reading "Removed" could not tell whether WE
    // did it. `DeploymentStore` keeps these two apart precisely because one is a punishment and the
    // other is the owner's own choice.
    case 'unpublished': return 'Unpublished by its owner';
    case 'plan_paused': return 'Offline — plan ended';
    default: return 'Unknown';
  }
}

function readStatus(raw: unknown): PublishedAppStatus {
  // A record written before `status` existed is ACTIVE — that is what the store's own default says,
  // and treating a legacy row as "unknown" would hide a genuinely live app from its owner.
  if (typeof raw !== 'string' || !raw) return 'active';
  return (STATUSES as readonly string[]).includes(raw) ? (raw as PublishedAppStatus) : 'held';
}

function readNumber(raw: unknown): number | null {
  // null is NOT zero here: a legacy record has no size, and "0.0 MB" would be a measurement nobody
  // took. The same rule `publishedAppList` already applies on the server.
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Normalise one row from either endpoint. `null` for a row that cannot be shown or acted on. */
export function toPublishedAppRow(raw: RawPublishedApp | null | undefined): PublishedAppRow | null {
  if (!raw) return null;
  const workspaceId = typeof raw.workspaceId === 'string' ? raw.workspaceId : '';
  const url = typeof raw.url === 'string' ? raw.url : '';
  // A row with neither an id nor an address is not a row — there is nothing to show and nothing to do.
  if (!workspaceId && !url) return null;
  const status = readStatus(raw.status);
  return {
    workspaceId: workspaceId || url,
    url,
    label: appLabel(url),
    updatedAt: readNumber(raw.updatedAt),
    sizeMb: readNumber(raw.sizeMb),
    status,
    orphaned: raw.orphaned === true,
    // An app that is not live has no working address, so offering to open it would be a button that
    // leads to a dead page — the fake-button class.
    openable: status === 'active' && isOpenableUrl(url),
  };
}

/** Normalise a list, newest first. Rows with no date sort last rather than being dropped. */
export function publishedAppRows(raw: unknown): PublishedAppRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: PublishedAppRow[] = [];
  for (const r of raw) {
    const row = toPublishedAppRow(r as RawPublishedApp);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * How many of these are actually live.
 *
 * 🔴 THE ADMIN SHEET WAS COUNTING WRONG, and said the wrong word too. It printed
 * `publishedApps.count`, which is every deployment RECORD for that user, under the label "N
 * published apps live" — so an account with four apps of which three were taken down read as four
 * live apps, on the very screen used to judge whether to act on that account. The count and the
 * sentence have to come from the same rule as the badges beside them.
 */
export function liveAppCount(rows: readonly PublishedAppRow[]): number {
  return rows.filter((r) => r.status === 'active').length;
}
