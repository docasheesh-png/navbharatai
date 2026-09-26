/**
 * THE FEATURE LIST, CONFIRMED BEFORE THE BUILD (admin 2026-09-26: "feature list confirm wala bhi banao").
 *
 * WHY. The build is handed two lists the user never saw: the features READ out of their own words
 * (`requestedFeatureLabels`, restated to the builder as "not suggestions — build every one of these")
 * and the features a detected domain "almost always needs" (`analyzeRequirementGaps`, restated as
 * "INCLUDE them by default"). When either reading is wrong, the wrong guess becomes an ORDER. Autopsy
 * SignBridge (2026-09-26) is the proof: "Map recognized labels to the sign dictionary" became a map
 * feature, and the method name `resume()` made it a jobs app with employer roles and interview
 * scheduling — in an app for sign-language translation, built for twenty minutes and billed.
 *
 * Fixing each misreading is necessary and will never be complete: a keyword table cannot know every
 * sense of every word. So the user is shown both lists BEFORE the build and can untick a wrong one.
 * The two answers are then the only ones the builder is given.
 *
 * ⚠️ This is a deliberate, admin-asked exception to the 2026-07-20 "no clarifying round-trip" rule, and
 * it is built to cost as little of that as possible: it is shown only for a FRESH build that names or
 * implies at least two features; it is one tap ("Build") to accept; and the user can switch it off.
 *
 * 🔒 THE CONFIRMATION CAN ONLY NARROW WHAT WE OFFERED. It arrives from the client, so it is untrusted:
 * a label is kept only if it is one this module itself put on the card for this exact prompt. Free text
 * from the request can therefore never be injected into the build prompt as a "confirmed feature".
 *
 * PURE — no I/O, no model call.
 */
import { requestedFeatureLabels } from './RequirementCoverage';
import { analyzeRequirementGaps, shouldSurfaceRequirementGaps } from '../lib/RequirementGapAnalyzer';
import { classifyIntent, userAskedForAnAppToBeBuilt } from './IntentClassifier';

/** The most suggestions shown — the same bound `buildRequirementGuidance` restates to the builder. */
export const MAX_SUGGESTED = 6;
/** Fewer than this many features in total and there is nothing worth pausing a build for. */
export const MIN_FEATURES_TO_ASK = 2;
/** Bounds on what a client may send back. */
const MAX_CONFIRM_ITEMS = 40;
const MAX_LABEL_CHARS = 120;

export interface FeaturePlan {
  /** Whether the card is worth showing at all. */
  show: boolean;
  /** Features read from the user's own words. */
  named: string[];
  /** Features a detected domain usually needs, which the words did not name. */
  suggested: string[];
  /** The detected domain ('general' when none). */
  domain: string;
}

export interface FeatureConfirmation {
  /** Offered features the user kept. */
  include: string[];
  /** Offered features the user removed. */
  exclude: string[];
}

/**
 * What the card shows for this prompt. `requirementAware` is whether the build would add the domain's
 * suggestions at all (`AGENTV3_REQUIREMENT_AWARE`) — the card must not offer what the build would never
 * be told, or a user could tick a feature nothing then builds.
 */
export function featurePlanFor(prompt: string, opts: { requirementAware: boolean }): FeaturePlan {
  const text = String(prompt ?? '').trim();
  const lists = featureListsFor(text, opts);
  // Only a request to MAKE something. A question, an edit, a chat turn: nothing is about to be built
  // from a list, so there is nothing to confirm.
  const building = !!text && classifyIntent(text) === 'new_build' && userAskedForAnAppToBeBuilt(text);
  return { ...lists, show: building && lists.named.length + lists.suggested.length >= MIN_FEATURES_TO_ASK };
}

/**
 * The two lists alone, with no opinion on whether to show them. The BUILD reads this, not
 * `featurePlanFor`: the contract has always been restated on every turn whatever its intent, and a
 * confirmation must be checked against the same lists the card was drawn from.
 */
export function featureListsFor(prompt: string, opts: { requirementAware: boolean }): FeaturePlan {
  const text = String(prompt ?? '').trim();
  if (!text) return { show: false, named: [], suggested: [], domain: 'general' };
  const named = requestedFeatureLabels(text);
  let suggested: string[] = [];
  let domain = 'general';
  if (opts.requirementAware) {
    const g = analyzeRequirementGaps(text);
    domain = g.domain;
    if (shouldSurfaceRequirementGaps(g)) {
      const seen = new Set(named.map((n) => n.toLowerCase()));
      suggested = g.likelyMissing.filter((s) => !seen.has(s.toLowerCase())).slice(0, MAX_SUGGESTED);
    }
  }
  return { show: false, named, suggested, domain };
}

function labelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, MAX_CONFIRM_ITEMS)) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && s.length <= MAX_LABEL_CHARS && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Read a client's confirmation, keeping only labels the card really offered for THIS prompt. Returns
 * null when there is no confirmation at all (the build then behaves exactly as it always has).
 */
export function sanitizeConfirmation(raw: unknown, plan: FeaturePlan): FeatureConfirmation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { include?: unknown; exclude?: unknown };
  if (r.include === undefined && r.exclude === undefined) return null;
  const offered = new Set([...plan.named, ...plan.suggested]);
  const include = labelList(r.include).filter((l) => offered.has(l));
  const exclude = labelList(r.exclude).filter((l) => offered.has(l) && !include.includes(l));
  return { include, exclude };
}

/**
 * The features the builder is told to build. Without a confirmation: exactly the named list, as before.
 * With one: the named features the user kept, then the suggestions they ticked. Those were the user's
 * choice, so they belong in the contract, not in "include by default unless out of scope".
 */
export function confirmedContractLabels(plan: FeaturePlan, conf: FeatureConfirmation | null): string[] {
  if (!conf) return plan.named.slice();
  const dropped = new Set(conf.exclude);
  const kept = plan.named.filter((l) => !dropped.has(l));
  const ticked = plan.suggested.filter((l) => conf.include.includes(l) && !dropped.has(l));
  return [...kept, ...ticked];
}

/**
 * Once the user has answered, the domain's "include these by default" instruction must not run: every
 * suggestion was either confirmed into the contract above or declined, and re-adding the declined ones
 * behind the user's back is exactly the defect this module exists to remove.
 */
export function domainGuidanceStandsDown(conf: FeatureConfirmation | null): boolean {
  return conf !== null;
}
