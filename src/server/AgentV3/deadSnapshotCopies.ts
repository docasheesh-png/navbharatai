// A SAVED COPY WHOSE CHANNEL WAS RECLAIMED IS NOT A SAVED COPY (admin 2026-09-27).
//
// 🔴 THE DEFECT. A green build's saved copy used to be deployed to its own Firebase Hosting channel
// (`sn-…`), and the sandbox record keeps that channel's URL as `snapshotUrl`. On 2026-09-18 the admin
// panel gained "Reclaim" / "Reclaim all" for those channels, on the reasoning — written into
// `previewSnapshot.ts` — that reclaiming one "is harmless because the next green build writes it
// again". The channel was deleted; the RECORD was never told. So every reader of `snapshotUrl` kept
// pointing at a host Firebase no longer serves:
//   • the admin's Built apps → Preview framed Firebase's "Site Not Found" page, and
//   • the user's own preview door 302'd a sleeping app to the same page.
// An app that is never rebuilt keeps that dead link for ever. Two stores held one fact (the channel
// exists / the record says where it is) and the delete moved only one of them.
//
// THE FIX, in both directions:
//   1. The reclaim route clears the records that point at the channel it just deleted.
//   2. The records a PAST reclaim left dangling are found and cleared here, against the site's real
//      channel inventory — and only against a COMPLETE one. An inventory that could not be read in
//      full proves nothing, so nothing is cleared (the same rule the reclaim route itself obeys).
//
// 🔒 ONLY A FIREBASE SNAPSHOT-CHANNEL URL CAN EVER BE JUDGED DEAD: a `--sn-` host on THIS hosting
// site. A published app's URL, a bucket-served copy (`s-….<domain>`) and anything on another site are
// never touched — this module cannot take down, hide or rewrite anything that is not a build copy.

/** One channel as the Hosting API lists it. */
export interface InventoryChannel { channelId: string; url: string }
export interface ChannelInventory { channels: InventoryChannel[]; complete: boolean }

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** The hosting site's id, read off the channel URLs Firebase itself returned. Null when there are none. */
export function inventorySite(inv: ChannelInventory): string | null {
  for (const c of inv.channels) {
    const host = hostOf(c.url);
    if (host && host.includes('--')) return host.split('--')[0];
  }
  return null;
}

/**
 * Is this saved-copy URL a Firebase snapshot channel that no longer exists? PURE.
 *
 * True only when ALL hold: the inventory is complete; the URL is a snapshot-channel host (`--sn-`) on
 * the SAME site the inventory lists; and no channel in that inventory is served at that host. Host
 * equality, not a channel-id match, because Firebase appends a random hash to the host and truncates
 * long channel ids — neither is reproducible from our side.
 */
export function snapshotCopyIsDead(url: unknown, inv: ChannelInventory | null | undefined): boolean {
  if (!inv || !inv.complete) return false;
  const host = hostOf(url);
  if (!host || !host.includes('--sn-')) return false;
  if (!/\.(web\.app|firebaseapp\.com)$/.test(host)) return false;
  const site = inventorySite(inv);
  if (!site || host.split('--')[0] !== site) return false;
  return !inv.channels.some((c) => hostOf(c.url) === host);
}

// ── The inventory, read once per window ─────────────────────────────────────────────────────────

const INVENTORY_TTL_MS = 5 * 60_000;
let cached: { at: number; inv: ChannelInventory } | null = null;
let inflight: Promise<ChannelInventory> | null = null;

/** The site's channel list, cached for five minutes. A failed read is INCOMPLETE — never "no channels". */
export async function channelInventory(
  load: () => Promise<ChannelInventory>,
  now: number = Date.now(),
): Promise<ChannelInventory> {
  if (cached && now - cached.at < INVENTORY_TTL_MS) return cached.inv;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const inv = await load();
      const safe: ChannelInventory = {
        channels: Array.isArray(inv?.channels) ? inv.channels.filter((c) => c && typeof c.channelId === 'string') : [],
        complete: inv?.complete === true,
      };
      if (safe.complete) cached = { at: now, inv: safe };
      return safe;
    } catch {
      return { channels: [], complete: false };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget the cached inventory — called after a channel is deleted, and by tests. */
export function forgetChannelInventory(): void {
  cached = null;
}

// ── Healing the records ─────────────────────────────────────────────────────────────────────────

export interface SnapshotRecordRef { workspaceId: string; snapshotUrl: string }

export interface HealDeps {
  inventory: () => Promise<ChannelInventory>;
  /** Every sandbox record that carries a saved-copy URL (bounded by the caller). */
  listSnapshotRecords: () => Promise<SnapshotRecordRef[]>;
  /** Clear the copy ONLY if the record still holds exactly this URL (a newer build may have replaced it). */
  clearSnapshot: (workspaceId: string, expectedUrl: string) => Promise<boolean>;
}

export interface HealResult { checked: number; cleared: number; skipped: 'incomplete-inventory' | null }

/** Find every record whose saved copy points at a reclaimed channel, and clear it. Never throws. */
export async function healDeadSnapshotRecords(deps: HealDeps): Promise<HealResult> {
  try {
    const inv = await deps.inventory();
    if (!inv.complete) return { checked: 0, cleared: 0, skipped: 'incomplete-inventory' };
    const recs = await deps.listSnapshotRecords();
    let cleared = 0;
    for (const r of recs) {
      if (!snapshotCopyIsDead(r.snapshotUrl, inv)) continue;
      if (await deps.clearSnapshot(r.workspaceId, r.snapshotUrl).catch(() => false)) cleared += 1;
    }
    return { checked: recs.length, cleared, skipped: null };
  } catch {
    return { checked: 0, cleared: 0, skipped: 'incomplete-inventory' };
  }
}

const HEAL_INTERVAL_MS = 10 * 60_000;
let lastHealAt = 0;

/** Run the heal at most once per ten minutes on this instance; fire-and-forget for a list route. */
export function healDeadSnapshotRecordsThrottled(deps: HealDeps, now: number = Date.now()): boolean {
  if (now - lastHealAt < HEAL_INTERVAL_MS) return false;
  lastHealAt = now;
  void healDeadSnapshotRecords(deps).then((r) => {
    if (r.cleared > 0) console.log(`[SNAPSHOT] cleared ${r.cleared} saved-copy link(s) whose channel no longer exists (of ${r.checked} checked)`);
  });
  return true;
}

/** Test seam: reset the throttle. */
export function resetHealThrottleForTest(): void {
  lastHealAt = 0;
}
