/**
 * THE EVIDENCE LEDGER — one vocabulary, one read, for everything a build has already PROVEN (queue Q-101,
 * autopsy 697b38ee; admin go-ahead 2026-10-05: "apki salah ke anusar").
 *
 * The class this closes: gates kept private notions of what was proven and trusted only their own, so a build
 * was told it had "no test suite that could be run" about a suite its own log showed passing, and
 * `RUNTIME_UNCHECKED` was recorded after three successful browser reads. Two READERS were built over the two
 * places proof is written — `agentRunEvidence` (the shell-command log: typecheck, tests) and
 * `provenFromTimeline` (facts an actor recorded on the build's own timeline: pages, preview, an address up) —
 * but each call site read them separately, in two vocabularies, and the preview check read a third way. A
 * fourth caller would have grown its own read again.
 *
 * Now there is ONE entry point. It composes the two readers (no logic is copied — each stays the authority on
 * its own source), names every fact once, and keeps WHERE each fact came from, so a reader can always say what
 * it is trusting. `tests/oneReadOfWhatIsProven.test.ts` fails if any other module calls either reader directly.
 *
 * The rules that make it safe, inherited from both readers and enforced here in one place:
 *   • an absent fact means "nothing settles it" — never a silent negative;
 *   • filling a gate only ever fills a `'not-run'` — a recorded `'failed'` keeps its failure, a `'passed'` is
 *     untouched — so this moves the SENTENCE, never the money (see provenFromTimeline.ts).
 * PURE.
 */
import { agentRunEvidence, type RecordedCommand } from './agentRunEvidence';
import { provenFromTimeline, type RecordedFact } from './provenFromTimeline';
import type { CheckOutcome, RuntimeEvidence } from './releaseGate';

/** Every fact the ledger can settle. */
export type ProvenFactName = 'typecheck' | 'tests' | 'pages' | 'preview';
/** Where a fact was proven. */
export type EvidenceSource = 'command-log' | 'timeline';

export interface LedgerEntry {
  outcome: Extract<CheckOutcome, 'passed' | 'failed'>;
  source: EvidenceSource;
}

export interface EvidenceLedger {
  facts: Partial<Record<ProvenFactName, LedgerEntry>>;
  /** An address really went up — changes how an unproven preview is EXPLAINED, never the verdict. */
  previewUrlPublished?: boolean;
}

/** THE read. Everything this build's command log and its own timeline already settle. */
export function readEvidenceLedger(
  commands: ReadonlyArray<RecordedCommand> | null | undefined,
  issues: ReadonlyArray<RecordedFact> | null | undefined,
): EvidenceLedger {
  const log = agentRunEvidence(commands);
  const seen = provenFromTimeline(issues);
  const facts: EvidenceLedger['facts'] = {};
  if (log.typecheck) facts.typecheck = { outcome: log.typecheck, source: 'command-log' };
  if (log.tests) facts.tests = { outcome: log.tests, source: 'command-log' };
  if (seen.pages) facts.pages = { outcome: seen.pages, source: 'timeline' };
  if (seen.preview) facts.preview = { outcome: seen.preview, source: 'timeline' };
  return { facts, ...(seen.previewUrlPublished !== undefined ? { previewUrlPublished: seen.previewUrlPublished } : {}) };
}

/** Has the app been seen RENDERING in a real browser by any actor? The preview half of the ledger. */
export function renderProvenInLedger(ledger: EvidenceLedger): boolean {
  return ledger.facts.preview?.outcome === 'passed';
}

/**
 * Fill a release gate's unproven checks from the ledger. FILL-ONLY: a check that already has an outcome keeps
 * it, so a recorded failure can never be overwritten by an older pass. Mutates and returns `gate`.
 */
export function fillGateFromLedger<G extends Pick<RuntimeEvidence, 'typecheck' | 'tests' | 'pages' | 'preview' | 'previewUrlPublished'>>(
  gate: G,
  ledger: EvidenceLedger,
): G {
  for (const name of ['typecheck', 'tests', 'pages', 'preview'] as const) {
    const entry = ledger.facts[name];
    if (entry && gate[name] === 'not-run') gate[name] = entry.outcome;
  }
  if (gate.previewUrlPublished === undefined && ledger.previewUrlPublished !== undefined) {
    gate.previewUrlPublished = ledger.previewUrlPublished;
  }
  return gate;
}
