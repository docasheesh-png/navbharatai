/**
 * PUBLISH ROLLBACK — put the live app back to the version that was working.
 *
 * ═══ THE GAP THIS CLOSES ═══
 *
 * Publishing was a one-way door. A user published, the new version turned out worse than the last
 * one, and there was no way back: the old version was simply gone from the live site. The nearest
 * thing available was "restore all files from History and publish again" — which rebuilds and
 * republishes, takes minutes, and is a different operation with different risks at exactly the moment
 * the user is panicking about a broken live app.
 *
 * Every other destructive action in this platform has an undo. Publishing — the one action that is
 * visible to the user's OWN users — did not.
 *
 * ═══ WHY THIS COSTS NOTHING TO STORE ═══
 *
 * The obvious implementation is to snapshot every published bundle so there is something to restore.
 * That would cost storage on every publish, forever, for a feature most people never use.
 *
 * It is also unnecessary. Firebase Hosting already keeps every VERSION we have ever finalized, and a
 * channel's release history says which version was live when. So a rollback is not a restore at all —
 * it is one API call that points the channel at a version Firebase is already holding. No snapshot,
 * no storage, no new failure mode, and it is atomic on Firebase's side: the switch either happens or
 * it does not, and the user is never looking at half an app.
 *
 * ⚠️ THE HONEST LIMIT, stated here rather than discovered by a user. A BUCKET-ONLY publish
 * (`PUBLISHED_APPS_BUCKET_ONLY=on`, the channel-ceiling fix) creates no Firebase version at all — the
 * files go straight to Cloud Storage and each publish overwrites the last. There is nothing to roll
 * back to, and `rollbackAvailability` says so plainly instead of offering a button that would fail.
 * Making that path reversible needs object versioning enabled on the bucket, which is a deliberate
 * infrastructure decision with its own storage bill — recorded as an open item, not quietly faked.
 */

/** One entry from the Hosting API's release list, reduced to what a rollback decision needs. */
export interface HostingRelease {
  /** The release's own resource name. */
  name?: string;
  /** The version this release points at — what a rollback re-releases. */
  version?: { name?: string; status?: string };
  /** RFC3339. Newest first is NOT guaranteed by the API, so this is what we sort on. */
  releaseTime?: string;
  releaseUser?: { email?: string };
}

export interface RollbackTarget {
  /** The `sites/<site>/versions/<id>` to re-release. */
  versionName: string;
  /** When that version was last live — shown to the user so they know what they are going back to. */
  releaseTime: string | null;
}

/**
 * Which version should a rollback go to? PURE — the whole decision, unit-tested without the network.
 *
 * The rule is "the most recent release whose version is NOT the one live now", not "index 1".
 * Three real cases make the naive version wrong:
 *
 *  • **A re-publish of identical files** produces a new release pointing at a NEW version, but a
 *    rollback to it would appear to do nothing. Skipping by version name lands on a version that
 *    genuinely differs.
 *  • **A previous rollback** appends a release pointing at an OLDER version. Taking index 1 would
 *    then bounce between the same two versions forever; walking by version identity keeps going back.
 *  • **A DELETED version.** Firebase garbage-collects old versions, and a release can outlive the
 *    version it points at. Re-releasing one that is not `FINALIZED` would fail at the API, so those
 *    are skipped here instead of being discovered as an error the user sees.
 */
export function pickRollbackTarget(releases: readonly HostingRelease[]): RollbackTarget | null {
  const usable = [...(releases ?? [])]
    .filter((r) => typeof r?.version?.name === 'string' && r.version.name.length > 0)
    // A version Firebase has expired cannot be re-released; treating it as a candidate would turn a
    // rollback into an API error at the worst possible moment.
    .filter((r) => (r.version?.status ?? 'FINALIZED') === 'FINALIZED')
    // Newest first. The API's order is not contractual, and a missing releaseTime sorts last rather
    // than throwing off the comparison.
    .sort((a, b) => String(b.releaseTime ?? '').localeCompare(String(a.releaseTime ?? '')));

  if (usable.length < 2) return null;
  const liveVersion = usable[0].version!.name!;
  const previous = usable.find((r) => r.version!.name! !== liveVersion);
  if (!previous) return null;
  return {
    versionName: previous.version!.name!,
    releaseTime: typeof previous.releaseTime === 'string' ? previous.releaseTime : null,
  };
}

export type RollbackAvailability =
  | { available: true; target: RollbackTarget }
  | { available: false; reason: 'never-published' | 'only-one-version' | 'bucket-only' | 'unreadable'; message: string };

/**
 * Can this app be rolled back, and if not, why — in words the user can act on.
 *
 * Every refusal names something the user can understand and, where possible, do something about. A
 * bare `false` would leave a greyed-out button with no explanation, which reads as broken rather than
 * as "there is genuinely nothing to go back to".
 */
export function rollbackAvailability(opts: {
  releases: readonly HostingRelease[] | null;
  bucketOnly: boolean;
}): RollbackAvailability {
  if (opts.bucketOnly) {
    return {
      available: false,
      reason: 'bucket-only',
      message: 'This app is served directly from storage, where only the latest version is kept, so there is no earlier version to go back to. Restore your files from History and publish again.',
    };
  }
  if (opts.releases === null) {
    // NOT "there is nothing to roll back to". An unreadable history is unknown, and saying otherwise
    // would be the same dishonesty as reporting an unreadable channel list as zero channels in use.
    return {
      available: false,
      reason: 'unreadable',
      message: 'The publish history could not be read just now, so it is not possible to say what the previous version was. Try again in a moment.',
    };
  }
  const target = pickRollbackTarget(opts.releases);
  if (!target) {
    const reason = (opts.releases?.length ?? 0) === 0 ? 'never-published' : 'only-one-version';
    return {
      available: false,
      reason,
      message: reason === 'never-published'
        ? 'This app has not been published yet, so there is no live version to undo.'
        : 'This is the first published version of the app, so there is nothing earlier to go back to.',
    };
  }
  return { available: true, target };
}

/** How the rollback is described to the user once it has actually happened. */
export function rollbackSummary(target: RollbackTarget): string {
  const when = target.releaseTime ? new Date(target.releaseTime) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  return stamp
    ? `Your live app is back to the version published on ${stamp}.`
    : 'Your live app is back to the previous published version.';
}

// ── The history picker (ROADMAP §13, 1.4) ─────────────────────────────────────────────────────

/** One version the user may go back to. */
export interface RollbackChoice {
  versionName: string;
  /** When this version was most recently live. Null when the API omitted it. */
  releaseTime: string | null;
  /** True for the version serving right now — shown, never offered. */
  live: boolean;
}

/**
 * Every version the live app could be put back to, newest first, ONE entry per version.
 *
 * "Undo last publish" goes one step back. This is the rest of the history, for the user who knows the
 * version from Tuesday was the good one. Same filters as `pickRollbackTarget` — only FINALIZED versions,
 * sorted by release time, never trusting the API's order — and deduplicated by VERSION: after a rollback
 * the same version appears in several releases, and offering it three times as "three versions" would
 * misdescribe the history. Each version keeps the time it was most recently live.
 *
 * Bounded: a long-lived app's history is hundreds of releases, and a picker is for the recent past.
 * PURE.
 */
export function listRollbackChoices(releases: readonly HostingRelease[], max = 20): RollbackChoice[] {
  const usable = [...(releases ?? [])]
    .filter((r) => typeof r?.version?.name === 'string' && r.version.name.length > 0)
    .filter((r) => (r.version?.status ?? 'FINALIZED') === 'FINALIZED')
    .sort((a, b) => String(b.releaseTime ?? '').localeCompare(String(a.releaseTime ?? '')));
  const seen = new Set<string>();
  const out: RollbackChoice[] = [];
  for (const r of usable) {
    const name = r.version!.name!;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      versionName: name,
      releaseTime: typeof r.releaseTime === 'string' ? r.releaseTime : null,
      live: out.length === 0,
    });
    if (out.length >= Math.max(1, Math.floor(max))) break;
  }
  return out;
}

/**
 * The target for "go back to THIS version" — resolved against the history, never taken on trust.
 *
 * A version name from the browser is an instruction to serve arbitrary bytes under the user's URL,
 * so it is only ever a KEY into the list this module itself derived: unknown ⇒ null, the live one ⇒
 * null (there is nothing to do), anything else ⇒ the same target shape the one-step undo uses, so the
 * route's rollback call is identical for both. PURE.
 */
export function pickRollbackTargetByVersion(
  releases: readonly HostingRelease[],
  versionName: string,
): RollbackTarget | null {
  if (typeof versionName !== 'string' || !versionName) return null;
  const choice = listRollbackChoices(releases, 1_000).find((c) => c.versionName === versionName);
  if (!choice || choice.live) return null;
  return { versionName: choice.versionName, releaseTime: choice.releaseTime };
}
