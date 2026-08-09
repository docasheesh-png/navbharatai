// A heal that fires TWICE for the same thing in one build is not a heal — it is a bug (admin law:
// "✅ Self-heal is NOT a success — it is a RED FLAG", applied to the one case that proves it).
//
// WHAT THE REPORT SHOWED (build 6414138d, login page, 2026-08-09). These three lines appeared, verbatim
// and identical, at t=126s, t=216s and t=313s of a single 5m45s build:
//
//     🔧 Added 2 missing import(s) …
//     🔧 Removed a duplicate import in `src/App.tsx` …
//     🔧 Removed a duplicate import in `src/main.tsx` …
//
// Three times. The same files, the same counts. A repair that genuinely repaired something cannot find
// the identical defect again minutes later — so either the write is not surviving, or something
// downstream rewrites the file from a stale copy and puts the defect back. Either way the second firing
// is EVIDENCE OF A DEFECT, and reporting it as another cheerful green fix hides exactly the signal we
// need. It also costs real time: those passes are part of the ~4 minutes this build spent after the app
// was already live and previewed.
//
// So the rule is: heal once, loudly report a repeat. This module owns that decision and nothing else —
// it does not perform or suppress the repair itself, it only says which of the two situations we are in,
// so the caller can be honest about it.
//
// Pure — no I/O, no clock, no state of its own. The caller keeps the per-build ledger.

/** Which repair ran, and on what. `detail` distinguishes two repairs of the same kind on one file. */
export interface HealEvent {
  /** Repair family, e.g. 'missing-import', 'duplicate-import', 'wrong-source-import'. */
  kind: string;
  /** The file it touched. */
  file: string;
  /** Optional extra identity — a symbol name, a count — when one file can need two distinct repairs. */
  detail?: string;
}

/** A stable identity for one repair, so the same repair is recognised on a later pass. Pure. */
export function healFingerprint(event: HealEvent): string {
  const part = (v: unknown): string => String(v ?? '').trim().toLowerCase();
  return [part(event.kind), part(event.file), part(event.detail)].join('|');
}

export type HealVerdict =
  /** First time in this build — a normal repair, report it as one. */
  | { repeat: false; occurrence: 1 }
  /** Seen before in this build — the repair is not sticking. Report it as a defect, not a fix. */
  | { repeat: true; occurrence: number; message: string };

/**
 * Record a repair against the build's ledger and say what it is.
 *
 * MUTATES `seen` on purpose: the ledger belongs to one build and the caller owns its lifetime, which is
 * what keeps this decision free of any global state that could leak between builds (or between users).
 *
 * The message deliberately names the file and the count, because "it happened again" is not actionable
 * while "this exact repair on this exact file is the third one this build" is.
 */
export function recordHeal(seen: Map<string, number>, event: HealEvent): HealVerdict {
  const fp = healFingerprint(event);
  const occurrence = (seen.get(fp) ?? 0) + 1;
  seen.set(fp, occurrence);
  if (occurrence === 1) return { repeat: false, occurrence: 1 };
  return {
    repeat: true,
    occurrence,
    message:
      `The same repair ran ${occurrence} times in this build (${event.kind} in ${event.file}` +
      `${event.detail ? `, ${event.detail}` : ''}). A repair that has to run twice did not hold the ` +
      'first time — something is writing the defect back. Treat this as a bug in the builder, not as a fix.',
  };
}

/**
 * Everything that repaired more than once, worst first — the build report's honest summary.
 *
 * An empty list is the goal state and reads as one; it is NOT the same as "no repairs ran", which the
 * caller can tell apart because it holds the ledger.
 */
export function repeatedHeals(seen: Map<string, number>): Array<{ fingerprint: string; count: number }> {
  return [...(seen instanceof Map ? seen.entries() : [])]
    .filter(([, count]) => Number(count) > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([fingerprint, count]) => ({ fingerprint, count }));
}
