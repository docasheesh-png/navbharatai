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
 * ## The second bug, found 2026-09-21: a COUNT is not a WINDOW
 *
 * Declaring the counts left one question the record still could not answer — *which* forty? The
 * table above says the recorder keeps 300 and the store keeps 40. It does not say that they keep
 * **opposite ends**:
 *
 * - the recorder was written `if (this.llmCalls.length < MAX) push(...)`, so it keeps the build's
 *   FIRST 300 and records nothing whatever after that;
 * - the store then kept the LAST 40 *of those*, on the stated reasoning that "the end of a build is
 *   where its failure lives".
 *
 * For a 312-call build the stored window was therefore calls **261–300**. Not the head — the
 * first-turn starvation, the plan-call timeout and the rung-1 ladder fall were all gone. Not the
 * tail either — the twelve calls the build actually died on had never been recorded at all. **Two
 * caps that disagree about which end matters compose into a window neither one intended**, and the
 * layer downstream believed a promise the layer upstream had already broken.
 *
 * The fix is one rule at both layers (`boundedWindow`): keep the first half and the last half of
 * whatever the cap allows, so the two caps compose instead of fighting, and record `head` so the
 * window is stated rather than assumed. It costs not one extra byte — the cap is unchanged; only
 * which entries fill it changed.
 *
 * ⚠️ **AND IT IS A REAL TRADE, SAID PLAINLY.** A forty-call tail gave forty consecutive calls of
 * context before the failure; twenty plus twenty gives twenty. That is the price, and it is worth
 * paying because the head was being lost with **certainty** on every build over the cap while the
 * tail still keeps twenty consecutive calls of the ending. Raising the cap instead would buy both
 * ends, and was rejected: the caps exist to stay clear of Firestore's 1 MB document limit without a
 * size-measuring loop, and a report that breaches it falls to `dropHeavyChannelsForStorage`, which
 * destroys the channel outright. A byte-neutral change cannot make that worse.
 *
 * PURE: no I/O, no clock, no model. Never throws.
 */

/**
 * What happened to one channel: how many entries survived, out of how many the build really had —
 * and, since 2026-09-21, WHICH ones.
 *
 * 🔴 A COUNT IS NOT A WINDOW, and that gap was load-bearing. `{ kept: 40, total: 312 }` is a true
 * statement that a reader cannot use: it says forty survived and nothing at all about which forty.
 * `DiagnosticsStore`'s own docblock told the reader they were the LAST forty — and for any build over
 * the recorder's 300-entry cap that was false, because the recorder had already thrown the end away
 * (see `pushBounded`). Two caps pulling in opposite directions produced a window from the MIDDLE that
 * neither layer intended, and the record could not say so. `head` is what makes the window sayable.
 */
export interface ChannelTruncation {
  /** Entries present in this copy of the report. 0 means the channel was dropped whole. */
  kept: number;
  /** Entries the build actually produced, as far upstream as is known. Always ≥ `kept`. */
  total: number;
  /**
   * How many of the `kept` entries are the build's FIRST entries. The remaining `kept - head` are its
   * LAST, and everything between the two is gone.
   *
   * Absent or `0` means the window is a plain tail (the pre-2026-09-21 shape, and what a cap of 1
   * still degrades to), so a reader that ignores this field is never misled — it is only ever less
   * informed. `head === kept` would mean a plain head.
   */
  head?: number;
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
 * How a cap of `cap` splits a list of `length` entries: keep the first `head` and the last `tail`.
 *
 * 🔑 **THE SPLIT IS HALF AND HALF, WITH THE ODD ENTRY GOING TO THE TAIL** — and that is the whole
 * of the judgement in this module, so it is written where it can be read rather than buried in a
 * slice. Neither end is privileged by evidence nobody has: the early entries carry the first-turn
 * starvation, the plan-call timeout and the rung-1 ladder fall; the late ones carry the failure the
 * build died of. Splitting evenly refuses to guess which autopsy is being written. The remainder
 * goes to the tail because that is the one asymmetry this file already had a stated reason for —
 * `DiagnosticsStore` kept the tail because "the end of a build is where its failure lives" — so the
 * tail is never the smaller half.
 *
 * ⚠️ **AT `cap` 1 IT IS A PLAIN TAIL** — head 0, the last entry alone, exactly the old behaviour. At
 * `cap` 2 it is genuinely the first entry and the last one with a gap between them, and that is the
 * rule applied rather than an accident: the caps this serves are 40 and up, and inventing a
 * special case for two would be a branch nothing in this codebase can exercise.
 */
export function boundedWindow(length: number, cap: number): { head: number; tail: number } {
  if (cap <= 0) return { head: 0, tail: 0 };
  if (length <= cap) return { head: length, tail: 0 };   // whole list — caller must not claim a gap
  const head = Math.floor(cap / 2);
  return { head, tail: cap - head };
}

/**
 * Append to a channel the recorder is filling DURING a build, keeping both ends once it is full.
 *
 * 🔴 **THIS IS THE HALF THAT MADE THE STORAGE CAP'S PROMISE FALSE (autopsy 2026-09-21).** Every
 * capped channel in `BuildDiagnostics` was written `if (this.llmCalls.length < MAX) push(...)` — so
 * once a long build passed the cap it recorded **nothing further at all**, and the entries it kept
 * were the build's FIRST. The storage layer then kept the LAST 40 of those, believing it was keeping
 * the end of the build. For a 312-call build the stored window was calls **261–300**: not the head,
 * not the tail, and no statement anywhere that the real ending had never been recorded.
 *
 * 🔑 **TWO CAPS THAT DISAGREE ABOUT WHICH END MATTERS COMPOSE INTO A WINDOW NEITHER INTENDED.**
 * That is the class, and it is why the fix is one shared rule rather than flipping this layer to
 * tail-keeping: a tail-keeping recorder under a tail-keeping store would simply have lost the head
 * with certainty instead, trading one blind spot for another. Both ends, both layers — and because
 * `boundedWindow` is the same rule at both, a both-ends list trimmed again by `trimChannel` still
 * yields the build's true first entries and its true last ones.
 *
 * Evicts the OLDEST MIDDLE entry (index `head`) so the array stays in chronological order and the
 * first `head` slots keep the build's opening. Returns true when an entry was evicted, so a caller
 * can count what it refused.
 */
export function pushBounded<T>(arr: T[], item: T, cap: number): boolean {
  if (cap <= 0) return true;                       // nothing may be kept; the item is refused
  if (arr.length < cap) { arr.push(item); return false; }
  const { head } = boundedWindow(arr.length + 1, cap);
  arr.splice(head, 1);
  arr.push(item);
  return true;
}

/**
 * Keep the first and last entries of a channel within `cap`, and record what that cost — including
 * WHICH entries survived, which a bare count cannot say.
 *
 * `known` carries a total measured further upstream (the recorder's own cap), so the figure reported
 * is the build's real count and not whatever an earlier pass happened to leave behind. `known.head`
 * carries the SHAPE of that earlier pass's window, so trimming a list that already has a gap cannot
 * claim head entries it no longer holds.
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
  const priorHead = known?.head ?? 0;
  if (list.length <= cap) {
    // Untouched here — but if an earlier pass already lost entries, that fact (and its shape) stands.
    if (total <= list.length) return { list: [...list], fact: undefined };
    return { list: [...list], fact: withHead({ kept: list.length, total }, priorHead) };
  }
  // A window can only ever shrink. Taking more head entries than the list actually has would label
  // tail entries as head ones — a false window, which is the exact failure this field exists to end.
  const want = boundedWindow(list.length, cap);
  const head = priorHead > 0 ? Math.min(want.head, priorHead) : want.head;
  const tail = cap - head;
  const kept = [...list.slice(0, head), ...(tail > 0 ? list.slice(list.length - tail) : [])];
  return { list: kept, fact: withHead({ kept: kept.length, total }, head) };
}

/** Attach a head count only when it really describes a gap — never a decorative zero. */
function withHead(fact: ChannelTruncation, head: number): ChannelTruncation {
  return head > 0 && head < fact.kept ? { ...fact, head } : fact;
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
      // The earliest total is the true one; the latest kept — and the latest WINDOW — is what
      // survived. The shape must come from the newest pass: an older `head` describes a list this
      // one has already cut down, so carrying it forward would over-claim the surviving head.
      ? withHead({ kept: fact.kept, total: Math.max(before.total, fact.total) }, fact.head ?? 0)
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
    .map(([name, f]) => `${f.kept} of ${f.total} ${channelLabel(name)}${windowShape(f)}`);
  if (parts.length === 0) return '';
  return `This report is not the whole record — it kept ${parts.join(', ')}. The rest exceeded the storage limit and is gone.`;
}

/**
 * The clause that stops a reader treating a both-ends window as a run of consecutive entries.
 *
 * 🔴 Without it the note says "40 of 312 model calls" and the forty print in one unbroken list, so
 * call 20 and call 21 look adjacent when 272 calls sit between them — a reader reconstructing the
 * build's order from the report would get it wrong and have nothing to warn them. Empty for a plain
 * tail, which is what a small cap still produces.
 */
export function windowShape(f: ChannelTruncation): string {
  if (!f.head || f.head >= f.kept) return '';
  const missing = f.total - f.kept;
  return ` (the first ${f.head} and the last ${f.kept - f.head} — ${missing} from the middle are gone)`;
}

/**
 * What a READER may conclude. Three answers, never two: a legacy report is `unknown`, and the
 * difference between "nothing was lost" and "we cannot tell" is the entire point of this module.
 */
export function readCompleteness(t: ReportTruncation | undefined): 'complete' | 'truncated' | 'unknown' {
  if (!t || typeof t.complete !== 'boolean') return 'unknown';
  return t.complete ? 'complete' : 'truncated';
}

/**
 * Did THIS channel lose entries? Three answers, like `readCompleteness` — and for the same reason.
 *
 * 🔴 `complete: true` IS AN ANSWER, and forgetting that was a real bug in the first draft of this
 * module's own consumer: the cost ledger read only `channels.llmCalls`, found nothing on a complete
 * report, and fell through to the legacy length guess — which then marked a build that genuinely
 * made exactly 40 calls as a lower bound and threw a correct measurement out of the admin's sample.
 * A complete report states that nothing was lost; the absence of a channel entry there is the
 * statement, not silence.
 *
 * `undefined` means only "this report cannot say" — a legacy record. A caller must then fall back to
 * whatever heuristic it had before, never to `false`.
 */
export function channelWasTruncated(
  t: ReportTruncation | undefined,
  channel: TruncatableChannel,
): boolean | undefined {
  const state = readCompleteness(t);
  if (state === 'unknown') return undefined;
  if (state === 'complete') return false;
  const fact = t?.channels?.[channel];
  return fact ? fact.kept < fact.total : false;
}

/** One line for any surface that shows a report. Empty string when there is nothing to say. */
export function completenessLine(t: ReportTruncation | undefined): string {
  switch (readCompleteness(t)) {
    case 'complete': return '';
    case 'truncated': return t?.note ?? 'This report is not the whole record.';
    case 'unknown': return 'Completeness not recorded — this report predates the check, so it may be missing detail.';
  }
}
