/**
 * 🔴 A REPORT MUST SAY WHAT IT NO LONGER CONTAINS.
 *
 * ## The bug this exists to kill (admin 2026-09-20: *"autopsy ko fix karo, yeh problem wapas na aye"*)
 *
 * A build report is capped twice on its way to storage, and until this module NEITHER cap left a
 * trace:
 *
 * | channel   | the build records | the recorder keeps | Firestore keeps |
 * |-----------|-------------------|--------------------|-----------------|
 * | llmCalls  | unbounded         | 300                | **40**          |
 * | commands  | unbounded         | 300                | **40**          |
 * | issues    | unbounded         | 2000 (declared)    | 500             |
 * | errors    | unbounded         | 200                | 50              |
 *
 * So a build that made 312 model calls was stored with 40 of them and **no statement anywhere that
 * 272 were dropped**. A reader — the admin, or Claude performing the mandatory autopsy — opens that
 * report, counts forty, and says "this build made forty calls". The number is false and nothing in
 * the document can contradict it. Over the emergency threshold the channels are removed ENTIRELY,
 * and `llmCalls: undefined` is then indistinguishable from a build that made no model calls at all.
 *
 * 🔑 **AN ABSENT MEASUREMENT IS NOT A MEASUREMENT OF ZERO.** This repo has now paid for that exact
 * confusion three times: `liveTokens` printing `0 in · 0 out` for an unsettled build (autopsy
 * f04421ef, where the person who wrote the renderer misread it); `JOURNEY_PASSED` recorded on a run
 * that launched no browser (2026-09-17); and this. The first two were fixed where they were found.
 * This one is fixed as a CLASS: trimming and declaring are now a single operation, so a caller
 * cannot do the first without the second.
 *
 * ## Why a field and not a timeline entry
 *
 * `TIMELINE_TRUNCATED` — the one cap that did announce itself — is pushed onto `issues` by the
 * recorder while the build runs. The storage caps cannot use that mechanism: they run AFTER the
 * report is final, inside the store, on a report the builder has already let go of. A field is the
 * only place the fact can live, and it must survive every later copy of the report.
 *
 * ## The merge rule, which is the whole correctness of this module
 *
 * A report is trimmed more than once (storage caps, then the emergency drop, then the compact copy).
 * Each pass sees only what the previous pass left, so a naive second pass would record
 * `kept: 0, total: 40` and quietly destroy the one number that mattered. `mergeTruncation` therefore
 * keeps the EARLIEST `total` and the LATEST `kept` — the true original count, and what actually
 * survived.
 *
 * PURE: no I/O, no clock, no model. Never throws.
 */

/** What happened to one channel: how many entries survived, out of how many the build really had. */
export interface ChannelTruncation {
  /** Entries present in this copy of the report. 0 means the channel was dropped whole. */
  kept: number;
  /** Entries the build actually produced, as far upstream as is known. Always ≥ `kept`. */
  total: number;
}

/**
 * The report's own statement about its completeness.
 *
 * 🔒 `complete: true` is written even when nothing was lost, and that is deliberate. Without it,
 * "no truncation field" would mean BOTH "nothing was lost" and "this report predates the field" —
 * the ambiguity this module exists to remove. Present-and-complete is a measurement; absent is a
 * legacy report, and a reader must say so rather than assume.
 */
export interface ReportTruncation {
  complete: boolean;
  /** Only the channels that actually lost entries. Absent when `complete`. */
  channels?: Record<string, ChannelTruncation>;
  /** One admin-readable sentence naming the losses. Absent when `complete`. */
  note?: string;
  /** Where the fuller copy lives, when one does (the compact embedded copy sets this). */
  fullerCopy?: string;
}

/** The channels this module can describe. Named so a typo cannot invent a channel. */
export type TruncatableChannel = 'issues' | 'problems' | 'commands' | 'llmCalls' | 'errors' | 'previewErrors' | 'generatedFiles';

/** A complete report's statement — the common case, and the one that must not be silent. */
export const COMPLETE: ReportTruncation = { complete: true };

/**
 * Keep the LAST `cap` entries of a channel and record what that cost.
 *
 * The tail is kept rather than the head because the end of a build is where its failure lives — the
 * same reasoning the existing `lastN` callers already used. `known` carries a total measured further
 * upstream (the recorder's own cap), so the figure reported is the build's real count and not
 * whatever an earlier pass happened to leave behind.
 */
export function trimChannel<T>(
  list: readonly T[] | undefined,
  cap: number,
  known?: ChannelTruncation,
): { list: T[] | undefined; fact?: ChannelTruncation } {
  if (list === undefined) {
    // Nothing to trim. A channel already dropped upstream keeps its fact so the loss is not forgotten.
    return { list: undefined, fact: known && known.kept === 0 ? known : undefined };
  }
  const total = known?.total ?? list.length;
  if (list.length <= cap) {
    // Untouched here — but if an earlier pass already lost entries, that fact still stands.
    return { list: [...list], fact: total > list.length ? { kept: list.length, total } : undefined };
  }
  const kept = list.slice(list.length - cap);
  return { list: kept, fact: { kept: kept.length, total } };
}

/** Drop a channel entirely, recording the count it had rather than letting it read as zero. */
export function dropChannel<T>(
  list: readonly T[] | undefined,
  known?: ChannelTruncation,
): { list: undefined; fact?: ChannelTruncation } {
  const total = known?.total ?? list?.length ?? 0;
  if (total === 0) return { list: undefined, fact: undefined };
  return { list: undefined, fact: { kept: 0, total } };
}

/**
 * Fold per-channel facts into the report's statement.
 *
 * `prior` is what the report already claimed (the recorder's own losses, or an earlier pass);
 * `found` is what this pass did. See the merge rule in the module header — the earliest `total`
 * wins, because that is the only one that counts the entries nobody ever saw.
 */
export function mergeTruncation(
  prior: ReportTruncation | undefined,
  found: Partial<Record<TruncatableChannel, ChannelTruncation | undefined>>,
): ReportTruncation {
  const channels: Record<string, ChannelTruncation> = { ...(prior?.channels ?? {}) };
  for (const [name, fact] of Object.entries(found)) {
    if (!fact) continue;
    const before = channels[name];
    channels[name] = before
      // The earliest total is the true one; the latest kept is what survived.
      ? { kept: fact.kept, total: Math.max(before.total, fact.total) }
      : fact;
  }
  // A channel whose kept still equals its total lost nothing and must not be listed as a loss — that
  // would turn an honest report into an alarming one, which is its own kind of dishonesty.
  for (const [name, fact] of Object.entries(channels)) {
    if (fact.kept >= fact.total) delete channels[name];
  }
  const names = Object.keys(channels);
  if (names.length === 0) {
    return prior?.fullerCopy ? { complete: true, fullerCopy: prior.fullerCopy } : COMPLETE;
  }
  const out: ReportTruncation = { complete: false, channels, note: truncationNote(channels) };
  if (prior?.fullerCopy) out.fullerCopy = prior.fullerCopy;
  return out;
}

/** How a channel reads to a human. `llmCalls` → "model calls", because the report is read by people. */
const CHANNEL_LABELS: Record<string, string> = {
  issues: 'timeline entries',
  problems: 'problems',
  commands: 'sandbox commands',
  llmCalls: 'model calls',
  errors: 'captured errors',
  previewErrors: 'preview errors',
  generatedFiles: 'captured files',
};

export function channelLabel(name: string): string {
  return CHANNEL_LABELS[name] ?? name;
}

/**
 * The sentence an admin reads. Ordered by how much was lost, so the worst loss is first, and it
 * says "of" rather than a bare number — "40 of 312" cannot be misread the way "40" can.
 */
export function truncationNote(channels: Record<string, ChannelTruncation>): string {
  const parts = Object.entries(channels)
    .sort((a, b) => (b[1].total - b[1].kept) - (a[1].total - a[1].kept))
    .map(([name, f]) => `${f.kept} of ${f.total} ${channelLabel(name)}`);
  if (parts.length === 0) return '';
  return `This report is not the whole record — it kept ${parts.join(', ')}. The rest exceeded the storage limit and is gone.`;
}

/**
 * What a READER may conclude. Three answers, never two: a legacy report is `unknown`, and the
 * difference between "nothing was lost" and "we cannot tell" is the entire point of this module.
 */
export function readCompleteness(t: ReportTruncation | undefined): 'complete' | 'truncated' | 'unknown' {
  if (!t || typeof t.complete !== 'boolean') return 'unknown';
  return t.complete ? 'complete' : 'truncated';
}

/** One line for any surface that shows a report. Empty string when there is nothing to say. */
export function completenessLine(t: ReportTruncation | undefined): string {
  switch (readCompleteness(t)) {
    case 'complete': return '';
    case 'truncated': return t?.note ?? 'This report is not the whole record.';
    case 'unknown': return 'Completeness not recorded — this report predates the check, so it may be missing detail.';
  }
}
