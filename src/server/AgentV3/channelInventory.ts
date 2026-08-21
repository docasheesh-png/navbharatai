// THE PUBLISH CEILING, made visible (ROADMAP §10).
//
// Every published app holds ONE Firebase Hosting preview channel, and channels per site are capped.
// The failure mode is the worst kind: past the cap, publishing stops working for EVERYBODY, with no
// warning and nothing in our own data hinting it was coming — the platform's own registry counts
// apps we know about, while the cap counts channels that EXIST, and those two drifted apart.
//
// They drifted for a concrete reason. A purge before `markOrphaned` (2026-08-21) deleted the
// deployment record outright and never touched the channel, so those apps are still serving with no
// record left anywhere. They are invisible to every count we have, and they still spend the scarce
// resource. Reconciling Firebase's list against our registry is the only way to see them at all.
//
// PURE — no network, no Firestore. The classification is the part worth being certain about.

import { makeChannelId, channelIdFromResourceName, isChannelQuotaError, HOSTING_FULL_MESSAGE } from './Deployment';
import { isLiveDeployment, type DeploymentRecord } from './DeploymentStore';

// Re-exported so callers reasoning about the ceiling have one import, not two. All three are DEFINED
// in Deployment.ts because they describe the Hosting API's resource and failure shapes, which is that
// file's domain — and defining them here would make the two modules import each other.
export { channelIdFromResourceName, isChannelQuotaError, HOSTING_FULL_MESSAGE };

/** A channel's id as it exists on the Hosting site. */
export interface HostingChannel { channelId: string; url?: string; updateTime?: string | null }

export type ChannelState =
  /** A live app we know about. This is the channel doing its job. */
  | 'live'
  /** We have a record and it is NOT live (unpublished / taken down / held) — the channel LEAKED. */
  | 'stale'
  /** No record at all. An app orphaned by an old purge: still serving, unreachable by its owner. */
  | 'unknown'
  /**
   * WE CANNOT TELL, because the registry we compared against was incomplete.
   *
   * This state exists because of a real, destructive bug (found 2026-08-21). `deploymentStore.list()`
   * caps at 500 records AND returns `[]` on a Firestore error — so "no record found" could mean "this
   * channel is genuinely orphaned" or it could mean "the database did not answer". Both produced
   * `unknown`, `unknown` was `reclaimable`, and reclaim DELETES the channel. One Firestore hiccup on
   * this screen therefore listed EVERY published app as reclaimable waste, one click each from taking
   * a paying user's live site down permanently.
   *
   * A missing record is only evidence of orphanhood if the registry was actually read in full. When it
   * was not, that is what this says — and it is never reclaimable.
   */
  | 'indeterminate';

export interface ClassifiedChannel {
  channelId: string;
  url: string;
  updateTime: string | null;
  state: ChannelState;
  /** The workspace it belongs to, when a record still names it. Null for 'unknown'. */
  workspaceId: string | null;
  /** True when reclaiming this channel frees a slot WITHOUT taking a working app off a live listing. */
  reclaimable: boolean;
}

/**
 * Reconcile the channels that EXIST against the deployments we have a record of.
 *
 * The mapping runs registry → channel (`makeChannelId`), never the other way: the channel id is a
 * one-way hash of the workspace id, so an 'unknown' channel genuinely cannot be traced back. That is
 * not a gap in this function — it is the exact damage the old purge did, and naming it honestly is
 * what lets it be cleaned up rather than quietly tolerated.
 *
 * ⚠️ A 'stale' channel is a BUG SIGNAL, not just waste: unpublish and takedown both delete the channel
 * before touching the registry, so a record that is not live while its channel still exists means one
 * of those deletes failed and reported success somewhere. Worth looking at, not just reclaiming.
 */
export function classifyChannels(
  channels: readonly HostingChannel[] | null | undefined,
  records: ReadonlyArray<Partial<DeploymentRecord>> | null | undefined,
  /**
   * Was the registry read IN FULL? Defaults to false — absence of evidence is not evidence of
   * absence, and the default has to be the safe one: a caller that has not thought about
   * completeness must not be handed a screen full of delete buttons aimed at live apps.
   */
  registryComplete = false,
): ClassifiedChannel[] {
  const byChannel = new Map<string, Partial<DeploymentRecord>>();
  for (const r of records ?? []) {
    if (!r || typeof r.workspaceId !== 'string' || !r.workspaceId) continue;
    byChannel.set(makeChannelId(r.workspaceId), r);
  }

  const seen = new Set<string>();
  const out: ClassifiedChannel[] = [];
  for (const c of channels ?? []) {
    const channelId = String(c?.channelId ?? '').trim();
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    const rec = byChannel.get(channelId);
    const state: ChannelState = rec
      ? (isLiveDeployment(rec as DeploymentRecord) ? 'live' : 'stale')
      // No record — but that only MEANS something when the registry was genuinely read in full.
      : (registryComplete ? 'unknown' : 'indeterminate');
    out.push({
      channelId,
      url: typeof c?.url === 'string' ? c.url : '',
      updateTime: c?.updateTime ?? null,
      state,
      workspaceId: rec?.workspaceId ?? null,
      // Reclaim is for WASTE only, and only for waste we are SURE of. A 'live' channel is somebody's
      // working app — taking it down belongs to the owner (Unpublish) or to a deliberate admin
      // takedown, which also updates the registry. 'indeterminate' is excluded for the stronger
      // reason: we do not know what it is, and a delete is not reversible.
      reclaimable: state === 'stale' || state === 'unknown',
    });
  }
  // Waste first — it is what the screen exists to act on.
  const rank: Record<ChannelState, number> = { unknown: 0, stale: 1, indeterminate: 2, live: 3 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || a.channelId.localeCompare(b.channelId));
}

/**
 * The working figure for channels per site.
 *
 * ⚠️ HONESTLY UNVERIFIED. Google does not publish this number on its Hosting quota page, and the ~50
 * figure comes from a 2020 community report. It is env-tunable precisely because it is a guess: the
 * moment a real "channel quota reached" is seen, the true number is known and belongs here.
 */
export function channelCap(): number {
  const raw = process.env.HOSTING_CHANNEL_CAP;
  const n = Number(raw);
  // An empty or malformed value falls back to the default rather than to 0 — `Number('')` is 0 and
  // finite, which would report the platform as permanently full.
  if (raw === undefined || raw === '' || !Number.isFinite(n) || n < 0) return 50;
  return Math.floor(n);
}

export interface CeilingVerdict {
  used: number;
  cap: number;
  remaining: number;
  /** How many slots reclaiming every wasted channel would give back. */
  reclaimable: number;
  level: 'ok' | 'warn' | 'critical';
  /** Plain English, for an admin who should not have to interpret a ratio. */
  message: string;
}

/**
 * How close the platform is to the wall.
 *
 * Thresholds are deliberately early: at 'critical' the next few publishes still work, which is the
 * whole point — a warning that arrives when publishing is already broken is not a warning.
 */
export function channelCeilingVerdict(
  classified: readonly ClassifiedChannel[],
  cap = channelCap(),
): CeilingVerdict {
  const used = classified.length;
  const reclaimable = classified.filter((c) => c.reclaimable).length;
  const remaining = Math.max(0, cap - used);
  const ratio = cap > 0 ? used / cap : 0;
  const level: CeilingVerdict['level'] = ratio >= 0.9 ? 'critical' : ratio >= 0.7 ? 'warn' : 'ok';
  const reclaimNote = reclaimable > 0
    ? ` ${reclaimable} of them belong to no live app and can be reclaimed.`
    : '';
  const message = level === 'critical'
    ? `Publishing is close to stopping for everyone: ${used} of about ${cap} hosting channels are in use.${reclaimNote}`
    : level === 'warn'
      ? `Hosting channels are filling up: ${used} of about ${cap} in use.${reclaimNote}`
      : `${used} of about ${cap} hosting channels in use.${reclaimNote}`;
  return { used, cap, remaining, reclaimable, level, message };
}
