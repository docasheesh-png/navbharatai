// AgentV3 — Reviewer Agent (Level 8 — multi-agent post-build review).
//
// After the main Architect build loop finishes successfully, a focused
// ReviewerAgent evaluates the complete result against the user's original
// request: "Does the app do what was asked? Is anything missing? Any bugs?"
//
// This is the multi-agent review pattern — a separate AI perspective,
// independent from the agent that built the app. It runs on the same free router
// (via sub-agent spawn) so it costs no extra credits and its findings are emitted
// as narration events visible in the chat. Best-effort — never throws.

import type { SubAgentSpawn } from './ToolDispatcher';

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'suggestion';
  file?: string;
  message: string;
  /**
   * The reviewer tagged this finding `[BROKEN]` — it says the behaviour is broken, rather than leaving
   * us to infer that from its prose (autopsy 536c8189; see `BROKEN_TAG_RE`). The tag is stripped out of
   * `message` so it never reaches a user; this flag is what the repair selectors read.
   */
  broken?: boolean;
}

export interface ReviewResult {
  /** False only when at least one CRITICAL issue was found. */
  passed: boolean;
  /** 0 = review was skipped; 1-100 = quality score from the reviewer. */
  score: number;
  /**
   * False when the reviewer printed no "Score: N" and `score` is the inferred 85/40 — then the number is
   * never SHOWN to the user (autopsy 4d538ca3: "⚠️ Build Review (85/100): [PASS]" on a clean review whose
   * reviewer wrote no score at all). Undefined on results built elsewhere, which keep today's display.
   */
  scoreStated?: boolean;
  issues: ReviewIssue[];
  summary: string;
}

/**
 * A MARKDOWN SECTION HEADING is not a finding. Reviewers routinely write a header like
 * "### [CRITICAL] Issues", "## Critical Issues", or "**Findings**" above the actual list —
 * and a naive per-line `[tag]` scan mis-counts that header as a real critical. Deep-test
 * 66ec5c1e: a "### [CRITICAL] Issues" header became a PHANTOM critical that FAILED a working,
 * render-verified app (and drove the auto-fix loop until the 29-min wall-clock cap). After the
 * severity tag + markdown is stripped, a bare section label is never a finding — skip it.
 */
const SECTION_LABEL_RE =
  /^(critical\s+|major\s+|minor\s+|high\s+|low\s+|potential\s+|other\s+)?(issues?|findings?|problems?|warnings?|suggestions?|concerns?|observations?|summary|assessment|overview|conclusion|review|code review( report)?|report)\s*:?\s*$/i;

/**
 * SELF-DISMISSAL inside a single finding: the reviewer tagged the line [CRITICAL] (often only
 * because a tool flagged it) but then, in the SAME finding, concludes it is NOT real — "this is
 * a false positive", "not a genuine issue". A finding the reviewer discharged in its own words
 * must NOT fail the build. Deep-test 66ec5c1e: the reviewer wrote "this may be a false positive
 * from the tool … the project appears to build and run without it" for BOTH of its criticals, yet
 * the app was reported broken and the auto-fix loop chased the phantoms until the wall-clock cap.
 * Conservative — only the unambiguous "false positive" / "not a real/genuine issue" phrasings, so
 * a genuine critical is never silently downgraded. Such a finding is demoted to a suggestion:
 * retained for the admin audit trail, but never a build-failing critical/warning.
 */
/**
 * A LINE THAT REPORTS THE ABSENCE OF FINDINGS IS NOT A FINDING (autopsy 31dc61fd, 2026-09-20).
 *
 * 🔴 WHAT THE USER ACTUALLY SAW, verbatim from the build report:
 *
 *     I also noticed one thing I could improve if you want
 *     (I left your working app exactly as it is, rather than changing it without asking):
 *       1. No  or  issues were found. The app structure, imports, accessibility, security, and
 *          privacy checks all pass. The historical `write-typecheck` errors in the two
 *     Want me to? Just reply "fix these" …
 *
 * Three defects in one sentence, and this rule is the root of the first two. The reviewer had written
 * *"No [CRITICAL] or [WARNING] issues were found"* — a clean bill of health. `lower.includes('[critical]')`
 * treats a MENTION of the tag as the tag, so the sentence became a critical finding; the tag-stripper
 * then removed both brackets wherever they appeared, leaving the two holes; and the whole thing was
 * offered to the user as something to fix.
 *
 * This is the same class the two guards below already handle — a section HEADER is not a finding
 * (`SECTION_LABEL_RE`), a finding the reviewer discharged is not a finding (`SELF_DISMISSED_RE`) — and
 * it belongs beside them rather than in a fourth place downstream.
 *
 * ⚠️ CONSERVATIVE BY CONSTRUCTION, because the opposite error is silent and worse: swallowing a REAL
 * finding would hide a defect from the user for ever. It matches only the "nothing was FOUND" shape —
 * a noun of finding (issues / problems / …) followed by found / detected / identified. So
 * *"No error handling on the save button"* is a real finding and stays; *"No accessibility issues were
 * found"* is a verdict and goes.
 */
const NO_FINDINGS_RE =
  /^\s*(no|none|zero)\b[^.!?]{0,90}?\b(issues?|problems?|findings?|errors?|violations?|concerns?|defects?|bugs?)\b[^.!?]{0,40}?\b(found|detected|identified|present|reported|observed)\b/i;

const SELF_DISMISSED_RE =
  /\bfalse[\s-]?positive\b|\bnot (a |an )?(real|actual|genuine|true|valid) (issue|problem|bug|concern|error|violation|vulnerability)\b/i;

/**
 * EXPLICIT LOW CONFIDENCE on a finding (M4-S4.1): the reviewer is instructed to tag each [CRITICAL] with
 * its confidence — "(confidence: high|medium|low)". A weak/cheap reviewer that is UNSURE a thing is
 * really broken must NOT fail the whole build on a guess (a working app reported broken is the worst
 * outcome — the finance-app phantom-critical class). Only an EXPLICIT medium/low tag downgrades a
 * critical to a warning (surfaced, non-blocking); an un-tagged critical is treated as high-confidence and
 * still fails, so a reviewer that ignores the format keeps today's stricter behaviour (backward-safe).
 * Matches the tag OR a bare hedge like "(low confidence)" / "confidence: medium".
 */
const LOW_CONFIDENCE_RE = /\bconfidence\s*[:=]?\s*(low|medium)\b|\b(low|medium)[- ]confidence\b/i;

/**
 * THE REVIEWER'S OWN DECLARATION that a finding names broken behaviour, not polish.
 *
 * 🔑 THE STRUCTURAL HALF of autopsy 536c8189 (see `FUNCTIONAL_WARNING_RE`): the reviewer is a model we
 * prompt, so the honest way to learn whether a finding describes a BREAK is to have it say so — not to
 * guess from its prose with a list of phrases that has now been wrong twice. The instruction asks for
 * `[BROKEN]` beside the severity tag; the marker is read here and then stripped from the message, so it
 * never reaches a user's screen.
 *
 * 🔒 IT IS ADDITIVE, SO NOTHING REGRESSES WHEN THE REVIEWER IGNORES IT. A reviewer that never writes the
 * tag keeps exactly today's behaviour (the classifier), and a tagged finding is still subject to the
 * cosmetic veto — "[BROKEN] the aria-label is missing" stays advisory, because a model may not widen
 * what a verified repair is allowed to touch on a working app just by typing a word.
 */
const BROKEN_TAG_RE = /\[broken\]/i;

/**
 * Strip ALL leading finding-list noise — markdown heading (#), blockquote (>), the severity emoji,
 * bullets, list numbers and whitespace — ORDER-INDEPENDENTLY, so a heading is recognised whether the
 * reviewer wrote "### Issues", "🚨 ### Issues", or "- 🚨 Issues". Real report 8a6e4585 exposed the gap:
 * a single-pass strip that removed `#` BEFORE the emoji left "###  Issues" intact after the emoji was
 * peeled, so the heading slipped through as a phantom critical. Looping until stable removes the markers
 * regardless of their order. Pure.
 */
function stripLeadingFindingNoise(s: string): string {
  let out = s;
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(/^[#>🚨⚠️💡•\-*\s]+/, '')   // markdown heading / quote / severity emoji / bullet / whitespace
      .replace(/^\d+[.)]\s*/, '');           // a leading list number ("1. ", "2) ")
  } while (out !== prev);
  return out;
}

/** Parse structured reviewer text into typed issues (best-effort). Exported for direct unit tests. */
/**
 * A heading line that names the file the findings under it are about — "Review of `src/a.ts`:",
 * "### `src/a.ts`", "**src/a.ts**". Only a whole-line heading counts, never a path mentioned inside a
 * finding. Autopsy f496c75b: the findings came under "Review of `src/hooks/useInput.ts`:" and carried no
 * file, so once a repair deleted that file the user was still offered a fix for it.
 */
/**
 * A FINDING WRITTEN WITHOUT OUR TAG IS STILL A FINDING (autopsy d798ddd3, 2026-10-04).
 *
 * 🔴 The lean review of a finished calculator answered *"I found genuine correctness issues"* and listed
 * them as `**1. Bug: entering \`.\` after an operator produces \`NaN\`**` and `**2. Bug: entering a digit
 * after \`Error\` corrupts the display**` — no `[WARNING]`, no `[BROKEN]`. `parseReviewOutput` reads a
 * severity ONLY from a tag, so it returned no issues: the review was shown headed ✅, the one verified
 * repair (`selectGreenRepairable`) had nothing to select, and the report carried no `REVIEW_FUNCTIONAL_*`
 * code at all. Two real bugs shipped, found and named by our own reviewer.
 *
 * 🔑 THE CLASS: the finding FORMAT is prose a model writes, and a format we only recognise when the model
 * obeys it fails silently when it does not. #3474 closed the same class for the finding's WORDS inside a
 * tagged line; this is its sibling for the line itself. A heading-shaped line that LABELS itself — "Bug:",
 * "Defect:", "Issue:", "Problem:", optionally numbered, bolded or under a `#` — is a finding. "Bug" and
 * "Defect" are the reviewer saying the behaviour is broken, so they carry `broken`; "Issue" and "Problem"
 * are left to the classifier. Every guard below (no-findings, self-dismissal, the cosmetic veto in the
 * selectors) applies unchanged.
 *
 * ⚠️ Precision first: only the START of a line, only those four nouns, and only with a colon or dash after
 * them, so "This bug was fixed earlier" or "No issues found" is never read as a finding.
 */
const LABELLED_FINDING_RE =
  /^\s*(?:#{1,6}\s*)?(?:[-*•]\s+)?(?:\*\*|__)?\s*(?:\d+[.)]\s*)?(?:\*\*|__)?\s*(bug|defect|issue|problem)\s*(?:#?\d+)?\s*(?:\*\*|__)?\s*[:—–-]\s*(?:\*\*|__)?\s*(.+?)\s*(?:\*\*|__)?\s*$/i;

/** A labelled finding's severity and message, or null when the line is not one. PURE. */
export function readLabelledFinding(line: string): { message: string; broken: boolean } | null {
  const m = LABELLED_FINDING_RE.exec(line);
  if (!m) return null;
  const message = m[2].replace(/\*+/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  if (message.split(/\s+/).length < 3) return null;
  return { message, broken: /^(bug|defect)$/i.test(m[1]) };
}

const FILE_HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:(?:review|findings|issues)\s+(?:of|for|in)\s+)?[`*]{1,2}([\w./@-]+\.[a-z0-9]{1,5})[`*]{1,2}\s*:?\s*$/i;

export function parseReviewOutput(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let currentFile: string | undefined;
  for (const line of text.split('\n')) {
    const heading = FILE_HEADING_RE.exec(line);
    if (heading) { currentFile = heading[1]; continue; }
    const lower = line.toLowerCase();
    let severity: ReviewIssue['severity'] | null = null;
    if (lower.includes('[critical]') || lower.startsWith('critical:') || line.includes('🚨'))
      severity = 'critical';
    else if (lower.includes('[warning]') || lower.startsWith('warning:') || line.includes('⚠️'))
      severity = 'warning';
    else if (lower.includes('[suggestion]') || lower.startsWith('suggestion:') || line.includes('💡'))
      severity = 'suggestion';
    if (!severity) {
      // An untagged finding that labels itself (see LABELLED_FINDING_RE) — read, never invented.
      const labelled = readLabelledFinding(line);
      if (labelled && !NO_FINDINGS_RE.test(labelled.message) && !SECTION_LABEL_RE.test(labelled.message)) {
        const dismissed = SELF_DISMISSED_RE.test(line);
        issues.push({
          severity: dismissed ? 'suggestion' : 'warning',
          ...(currentFile ? { file: currentFile } : {}),
          message: labelled.message,
          ...(labelled.broken && !dismissed ? { broken: true } : {}),
        });
      }
      continue;
    }
    if (severity) {
      // THE REVIEWER'S OWN "this is broken" MARKER. Read from the raw line, then stripped with the
      // severity tags so a user never reads our internal vocabulary off their screen (autopsy 536c8189).
      const broken = BROKEN_TAG_RE.test(line);
      const message = stripLeadingFindingNoise(
        line
          .replace(/\[(critical|warning|suggestion|broken)\]/gi, '')
          .replace(/^(critical|warning|suggestion):/gi, ''),
      )
        .replace(/\*+/g, '') // strip markdown bold/italic asterisks
        // A tag removed from MID-SENTENCE leaves a hole: "No [CRITICAL] or [WARNING] issues" became
        // "No  or  issues" on a real user's screen. The tag-strip above is global on purpose (a
        // reviewer writes "1. [CRITICAL] foo" as often as "[CRITICAL] foo"), so the gap is closed
        // here rather than by making the strip positional and losing those.
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (!message) continue;
      // A markdown SECTION HEADER ("### [CRITICAL] Issues", "🚨 ### Issues") is not a finding — never count it.
      if (SECTION_LABEL_RE.test(message)) continue;
      // Nor is a clean bill of health. See NO_FINDINGS_RE — this is what put "No  or  issues were
      // found" in front of a user as something to fix.
      if (NO_FINDINGS_RE.test(message)) continue;
      // The reviewer discharged its own finding as a false positive → demote so it can't fail the build.
      let effective: ReviewIssue['severity'] =
        severity !== 'suggestion' && SELF_DISMISSED_RE.test(line) ? 'suggestion' : severity;
      // CONFIDENCE GATE (M4-S4.1): an EXPLICITLY low/medium-confidence critical is a reviewer guess —
      // downgrade it to a warning so it is surfaced but never fails a working build. Un-tagged criticals
      // stay critical (backward-safe). Never UPGRADES anything.
      if (effective === 'critical' && LOW_CONFIDENCE_RE.test(line)) effective = 'warning';
      issues.push({ severity: effective, ...(currentFile ? { file: currentFile } : {}), message, ...(broken ? { broken: true } : {}) });
    }
  }
  return issues;
}

// Post-review auto-fix scope (autopsy 2026-07-11, Notes report): the C9 repair pass fixes the
// reviewer's [CRITICAL] findings, but the Notes app's REAL functional bugs were all [WARNING]
// severity ("auto-focus broke", "sort ignores edits", "isAtLimit blocks Add") — so they shipped
// unfixed. Not every warning deserves an (expensive) repair pass though: a11y polish, landmarks,
// naming and pure style are advisory. These two pure classifiers split a WARNING into "functional
// (a stated behaviour is broken/missing → worth fixing)" vs "cosmetic (advisory polish → leave it)".

/** Cosmetic / advisory warning signals — NOT worth an auto-repair pass (a11y polish, naming, style). */
const COSMETIC_WARNING_RE = /\b(aria-?\w*|landmark|<main>|semantic|role=|naming|readability|consider (adding|using|renaming)|could be|would be (nice|better|cleaner)|stylistic|cosmetic|whitespace|formatting|indentation|spacing|margin|padding|comment(s|ing)?|prefer\b|nit\b|minor)\b/i;

/**
 * Functional / correctness signals — a warning that names BROKEN behaviour or an unmet requirement.
 *
 * 🔴 `never \w+` IS DELIBERATELY OPEN, AND THAT IS THE FIX (autopsy 536c8189, 2026-10-01). It used to be
 * the closed list `never (fires|works|holds|updates|renders)`, and the reviewer of a finished word-match
 * game wrote: *"`setMatchedKeys` is never CALLED in `handleMatchClick` or elsewhere. The guard … always
 * evaluates to `false`, so a key can be matched multiple times."* A real bug, in plain words, and not one
 * of those five verbs — so nothing was selected, no repair ran, and the report carried no
 * `REVIEW_FUNCTIONAL_*` code at all. Measured, every one of these was MISSED too: never invoked, never
 * set, never read, never runs, never used, never enabled, never persisted.
 *
 * 🔑 THE CLASS, and it is why this is not a third list: a CLOSED set of phrases is being matched against
 * open-ended prose a MODEL wrote. The same class was patched once already (ac41a924 added
 * `FUNCTIONAL_OUTCOME_RE` for the same reason), and a third list would be patched again. Two changes
 * together: the verb after `never` is now ANY word — the cosmetic veto below is what keeps precision, and
 * it already catches "the aria-label is never set" and "consider never using inline styles" — and the
 * reviewer now DECLARES it with `[BROKEN]` (`BROKEN_TAG_RE`), so the common case stops being inferred.
 */
const FUNCTIONAL_WARNING_RE = /\b(broke\w*|does ?n'?t|do ?n'?t|not work\w*|fail\w*|bug|incorrect|wrong|invalid|missing|never [a-z]+|steal\w* focus|conflict\w*|ignor\w*|unnecessar\w*|block\w*|mismatch\w*|off-by|race\b|crash\w*|throw\w*|undefined\b|null\b|requirement|logic error)\b/i;

/**
 * A guard or branch that can never be taken — the other half of the same report's missed finding.
 * "always evaluates to false", "is always true", "will always be false": a dead condition is a defect
 * with no verdict word in it. Deliberately NOT a bare `always`, which is how advice is written
 * ("always use the kit classes", "always wrap it in a try").
 */
const DEAD_CONDITION_RE = /\balways (?:be |evaluates? to |returns? )?(?:true|false)\b|\balways (?:evaluates|returns the same)\b/i;

/**
 * Functional signals written as an OUTCOME the user would see, not as a verdict word (autopsy
 * ac41a924, 2026-09-23). The reviewer found two real bugs in a finished news site and neither was
 * picked: "the literal backslash-n sequence is not present and the content will render as one long
 * paragraph", and "no routes or pages exist for them; clicking them will show the NotFound page …
 * dead-end navigation". Neither says "bug", "broken" or "missing" — they describe what the user sees.
 * Kept to outcomes that are unambiguous on their own; still subject to the cosmetic veto below.
 */
const FUNCTIONAL_OUTCOME_RE = /\b(not present|(?:do|does) not exist|no (?:\w+ ){0,3}exists?|dead[- ]end|notfound|renders? as (?:one|a single|plain|raw|blank|empty)\b|one long paragraph|blank (?:page|screen)|nothing happens|has no effect|goes nowhere)/i;

/**
 * From a reviewer's issues, pick the WARNINGs worth an automatic repair pass: functional/correctness
 * warnings (a behaviour the user asked for is broken or missing), excluding purely cosmetic/advisory
 * ones. Pure & deterministic — a fuzzy classifier over the reviewer's own text, kept conservative
 * (must match a functional signal AND not read as cosmetic) so it never churns on style nits.
 */
export function selectAutoFixableWarnings(issues: ReviewIssue[]): ReviewIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter((i) => i && i.severity === 'warning' && namesBrokenBehaviour(i));
}

/**
 * Does this finding name broken behaviour? The reviewer's own `[BROKEN]` tag when it wrote one, our
 * classifier otherwise — and the cosmetic veto applies either way, so the tag can never widen what a
 * repair may touch on a working app. One definition for both selectors. PURE.
 */
export function namesBrokenBehaviour(issue: ReviewIssue | null | undefined): boolean {
  if (!issue || typeof issue.message !== 'string') return false;
  if (COSMETIC_WARNING_RE.test(issue.message)) return false;
  return issue.broken === true || isFunctionalFinding(issue.message);
}

/** One definition of "names broken behaviour, not polish" — shared by both selectors below. PURE. */
export function isFunctionalFinding(message: unknown): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  const declared = BROKEN_TAG_RE.test(message);
  return (declared || FUNCTIONAL_WARNING_RE.test(message) || FUNCTIONAL_OUTCOME_RE.test(message)
    || DEAD_CONDITION_RE.test(message))
    && !COSMETIC_WARNING_RE.test(message);
}

/**
 * What a WORKING app's one verified repair may touch (greenReviewPolicy.ts, `greenFunctionalRepairEnabled`).
 * Criticals as well as warnings — but only the ones that name broken behaviour. A critical is the
 * reviewer's confidence, not its subject: "secrets should live in a vault" can be tagged critical, and
 * that kind of opinion, repaired silently on a green app, is what erased a user's .env on 2026-08-12.
 */
export function selectGreenRepairable(issues: ReviewIssue[]): ReviewIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter((i) => i && (i.severity === 'critical' || i.severity === 'warning') && namesBrokenBehaviour(i));
}

/** Source-file extensions that mean "there is real reviewable code in the workspace". */
const SOURCE_RE = /\.(tsx?|jsx?|html?|css|scss|vue|svelte|astro|mjs|cjs|py|go|java|php|rb|rs|swift|kt)$/i;

/**
 * Whether the file listing contains real source the reviewer can judge. Used to GUARD the
 * post-build review: if the workspace read came back empty (a sandbox read hiccup after a
 * successful build, where files genuinely exist), the reviewer has nothing to look at — and must
 * NOT be allowed to declare "missing all source code, 0/100", which is a false negative that
 * contradicts the build the user just watched succeed.
 */
export function hasReviewableSource(fileTree: string[]): boolean {
  return Array.isArray(fileTree) && fileTree.some((p) => SOURCE_RE.test(p));
}

/**
 * Spawn a focused post-build review sub-agent that checks the built app against
 * the user's original request. Returns a structured ReviewResult.
 * Best-effort — resolves to a neutral score-0 result if the spawn fails.
 */

/**
 * Should the review focus on what THIS TURN changed, instead of surveying the whole project?
 *
 * ROOT CAUSE (Shiv Medical Store report, 2026-08-10): a turn that changed 3 files in a 78-file project
 * sent the reviewer through ~25 read_file calls over the whole app. That is expensive — tokens are the
 * user's bill — and it is also the wrong review: it re-litigates code the user did not touch and did
 * not ask about, which is how a clean edit collects "issues" about pre-existing decisions.
 *
 * A NEW build changed everything, so everything is in scope — that must not change. Focus only when a
 * genuinely small edit lands in a project big enough for the distinction to matter.
 *
 * Pure + exported for testing.
 */
export function reviewScope(changedFiles: readonly string[] | undefined, treeSize: number): {
  focused: boolean;
  files: string[];
} {
  const changed = (changedFiles ?? []).filter((f) => typeof f === 'string' && f.trim().length > 0);
  // Nothing recorded → we cannot know what moved; review as before rather than guess a narrow scope
  // and miss the very thing that broke.
  if (changed.length === 0) return { focused: false, files: [] };
  // A small project is cheap to review whole, and "3 of 5 files" is not a focused edit.
  if (treeSize < 12) return { focused: false, files: changed };
  // More than a third of the project moved → this is a rebuild in all but name.
  if (changed.length > Math.max(6, Math.floor(treeSize / 3))) return { focused: false, files: changed };
  return { focused: true, files: changed };
}

export interface ReviewBuildOpts {
  userRequest: string;
  fileTree: string[];
  fileSample: { path: string; content: string }[];
  spawn: SubAgentSpawn;
  /**
   * The files THIS TURN actually changed. When a small edit lands in a large project, reviewing the
   * whole app is both expensive and wrong — see reviewScope.
   */
  changedFiles?: string[];
  /**
   * `suggest` when the app is PROVEN green and this review can only ever produce a suggestion
   * (greenReviewPolicy.ts). The instruction then says so and sets a reading budget; the caller pairs
   * it with a hard step cap and a small time budget. `full` (the default) is today's review, unchanged.
   */
  mode?: 'full' | 'suggest';
  /**
   * The changed source files IN FULL, for a suggest-only review (see `leanReviewInline`). Present ⇒ the
   * instruction carries them and tells the reviewer to answer from them rather than read them again.
   */
  inlineFiles?: LeanReviewInline;
}

/**
 * 🔴 A LEAN REVIEW MUST BE HANDED THE CODE IT IS ASKED TO JUDGE (autopsy 728a402d, 2026-09-30).
 *
 * The suggest-only review has a 12-step cap and a 45 s budget, and it had never once returned a
 * verdict on a real app: it spent its steps reading files one tool call at a time and timed out. The
 * "sample" it was handed was the FIRST FIVE paths of the listing, 500 characters each — on that
 * build `.gitignore`, `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.build.json`. Not
 * one line of the app. So the files that changed are now put in the instruction in full, bounded, and
 * the reviewer answers in one call instead of eleven. Fewer tokens, too: one call carrying the code
 * instead of eleven each re-sending a growing transcript.
 */
export interface LeanReviewInline {
  files: { path: string; content: string }[];
  /** Changed source files that did not fit the bound — named, so the reviewer can read one it needs. */
  omitted: string[];
}

const LEAN_SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|html)$/i;
const LEAN_SKIP = /(^|\/)(node_modules|dist|build|e2e|tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$|\.d\.ts$|(^|\/)(vite|vitest|playwright|tailwind|postcss|eslint)\.config\.[cm]?[jt]s$/i;
/** Total characters of code a lean review is handed, and the most any one file may take of it. */
export const LEAN_REVIEW_INLINE_CHARS = 60_000;
export const LEAN_REVIEW_FILE_CHARS = 16_000;

/** The app's own entry and screens first, then the rest — what a reviewer reads first by hand. */
function leanPriority(path: string): number {
  if (/(^|\/)src\/App\.[jt]sx?$/.test(path)) return 0;
  if (/(^|\/)(pages|screens|routes|views)\//.test(path)) return 1;
  if (/(^|\/)(components|hooks|lib|store|context|services|utils|data)\//.test(path)) return 2;
  if (/\.css$|\.html$/i.test(path)) return 4;
  return 3;
}

/**
 * Pick the changed source files a lean review is handed in full, bounded. PURE — the caller supplies
 * contents (the freshest copy it holds).
 */
export function leanReviewInline(
  changed: readonly string[],
  contentOf: (path: string) => string | undefined,
  maxChars = LEAN_REVIEW_INLINE_CHARS,
): LeanReviewInline {
  const paths = [...new Set(changed)]
    .filter((p) => LEAN_SOURCE.test(p) && !LEAN_SKIP.test(p))
    .sort((a, b) => leanPriority(a) - leanPriority(b) || a.localeCompare(b));
  const files: { path: string; content: string }[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const path of paths) {
    const content = contentOf(path);
    if (typeof content !== 'string' || !content.trim()) continue;
    if (content.length > LEAN_REVIEW_FILE_CHARS || used + content.length > maxChars) { omitted.push(path); continue; }
    files.push({ path, content });
    used += content.length;
  }
  return { files, omitted };
}

/**
 * The paths this turn really changed, for the review: every written path, minus the files our own finishing
 * passes wrote, minus a pre-seeded template file the build never touched (its content is still the seed).
 *
 * 🔴 WHY (autopsy 8257ca59, 2026-10-01). A calculator's builder edited ONE file, App.tsx. The 12 template
 * files we pre-seeded were counted as "changed this turn" too, the template's 18 KB stylesheet was over
 * the inline bound, so the lean review lost its no-tools, one-call mode (`leanReviewAnswersInOneCall`),
 * ran glob/read/evaluate, overran its 45 s budget, and opened its reply with "I'll help you build the
 * calculator app" — shown to the user after their app was finished. A template file the builder rewrote
 * is real work and stays. PURE.
 */
export function reviewChangedPaths(
  written: ReadonlyMap<string, string>,
  finishing: ReadonlySet<string>,
  preseeded: ReadonlyMap<string, string> = new Map(),
): string[] {
  return [...written.keys()].filter((p) => !finishing.has(p) && !(preseeded.has(p) && preseeded.get(p) === written.get(p)));
}

/** Changed files first, then the rest, capped at `REVIEW_TREE_CAP` with the remainder counted. Pure. */
export const REVIEW_TREE_CAP = 60;
export function reviewFileList(fileTree: readonly string[], changed: readonly string[]): string {
  const ordered = [...new Set([...changed, ...fileTree])];
  const shown = ordered.slice(0, REVIEW_TREE_CAP);
  const rest = ordered.length - shown.length;
  return shown.join('\n') + (rest > 0 ? `\n…and ${rest} more (use glob to list them)` : '');
}

/**
 * 🔴 ADVICE WAS NOT ENOUGH (autopsy bee95692, 2026-09-30). The lean review was handed all eleven
 * changed files in full and told not to read them again, and it ran `glob` and then read all eleven
 * anyway, one call each, and timed out at 45 s with no verdict — in three of that day's four reports.
 * A green app's review is also what finds a real bug for the one verified repair
 * (`selectGreenRepairable`), so a review that never lands loses that repair too.
 *
 * So when EVERY changed source file is in the instruction, the review is given NO tools: it can only
 * answer, in one call. When a changed file did not fit (`omitted`), or nothing could be inlined, it
 * keeps its read tools, because then reading is the only way to see the code. PURE.
 */
export function leanReviewAnswersInOneCall(inline: LeanReviewInline | undefined): boolean {
  return !!inline && inline.files.length > 0 && inline.omitted.every(isStylesheetPath);
}

/**
 * 🔴 A STYLESHEET TOO BIG TO INLINE IS NOT A REASON TO READ (autopsy cf09c03c, 2026-10-04). The builder
 * changed `src/App.tsx` and appended a few rules to `src/index.css`, which carries our ~18 KB design kit and
 * so is over `LEAN_REVIEW_FILE_CHARS`. That one omission gave the lean review its tools back, and it read
 * `src/App.tsx` twice although the file was in its instruction in full. A review judges behaviour from the
 * code; it has never needed the kit's rules to do it. Any other omitted file still keeps the tools, and a
 * turn that changed only a stylesheet inlines nothing, so it keeps them too. PURE.
 */
const STYLESHEET_PATH = /\.(css|scss|sass|less)$/i;
export function isStylesheetPath(path: string): boolean {
  return STYLESHEET_PATH.test(path);
}

/**
 * The reviewer's instruction, as a pure function of its inputs — exported so the suggest-mode block
 * can be asserted rather than trusted. PURE.
 */
export function reviewerInstruction(opts: Omit<ReviewBuildOpts, 'spawn'>): string {
  const { userRequest, fileTree, fileSample } = opts;
  const scope = reviewScope(opts.changedFiles, fileTree.length);
  const fileContext = fileSample
    .slice(0, 5)
    .map(
      ({ path, content }) =>
        `\n--- ${path} (${content.length} chars) ---\n${content.slice(0, 500)}`,
    )
    .join('\n');

  return [
    'You are a code reviewer. Evaluate whether the app fully meets the user\'s request.',
    '',
    `USER REQUEST: "${userRequest}"`,
    '',
    `FILES BUILT (${fileTree.length} total):`,
    // 🔴 THE FILES THIS TURN WROTE COME FIRST, AND THE LIST IS LONG ENOUGH TO HOLD THEM (autopsy 0bb437b4).
    // A game carries ~30 platform library files; the first 20 of the tree were all library, the app's own
    // src/game/racing/* were cut, and the reviewer guessed `src/components/RaceGame.tsx` and three other
    // paths that did not exist, spent its budget finding them, and timed out with no suggestions. Paths
    // are cheap; a guessed path costs a step.
    reviewFileList(fileTree, scope.files),
    '',
    ...(scope.focused ? [
      `CHANGED THIS TURN (${scope.files.length} file(s)) — REVIEW THESE:`,
      scope.files.slice(0, 20).join('\n'),
      '',
      'Focus your review on those files and anything they directly affect. Do NOT survey the rest of the',
      'project: the user asked for this change, not an audit of code they did not touch, and re-reading',
      'the whole app costs them real money. If a changed file depends on something untouched, read that',
      'one file — but do not go looking for unrelated issues elsewhere.',
      '',
    ] : []),
    'SAMPLE FILE CONTENTS:',
    fileContext,
    '',
    'For each issue, prefix the line with [CRITICAL], [WARNING], or [SUGGESTION]:',
    'Start EVERY finding\'s line with its tag — a finding written without one ("**1. Bug: …**") is not read, so it is never fixed.',
    '  [CRITICAL] = feature is missing or completely broken.',
    '  [WARNING]  = works but has a bug or missing edge case.',
    '  [SUGGESTION] = minor improvement that would help.',
    '',
    // THE REVIEWER SAYS IT, SO WE STOP GUESSING IT (autopsy 536c8189). "setMatchedKeys is never called,
    // so the guard always evaluates to false" is a real bug our classifier did not recognise, so no
    // repair ran. Severity is confidence; this is SUBJECT. Both are needed.
    'Also add [BROKEN] to any finding where the app really MISBEHAVES for the user — a handler that is',
    'never called, a guard that can never be true, state that is never saved, a control that does',
    'nothing, a wrong result. Use it next to the severity tag: "[WARNING] [BROKEN] …". Do NOT add it to',
    'advice, polish, naming, styling, accessibility wording or anything that merely "could be better" —',
    'a [BROKEN] finding may be repaired automatically, so only tag what you are sure is really wrong.',
    '',
    'Be precise with [CRITICAL] — it fails the whole build, so only use it for a real, confirmed break:',
    '  • Put the severity tag on the FINDING itself, never on a section heading (do not write "### [CRITICAL] Issues").',
    '  • If you inspect a tool-reported problem and conclude it is a false positive, or the app builds and',
    '    runs fine despite it, do NOT tag it [CRITICAL] — omit it, or use [SUGGESTION]. Never label a finding',
    '    [CRITICAL] and then explain in the same finding that it is a false positive.',
    '  • PRESENT-BUT-DIFFERENT is NOT [CRITICAL]. If a requested feature EXISTS and runs but was built',
    '    differently than asked — a different value, a partial variant, or an alternative that still works',
    '    (e.g. "shows 5 lives instead of 3", "timer counts per frame not per second") — it is at most a',
    '    [WARNING], usually a [SUGGESTION]. [CRITICAL] is ONLY for a feature that is genuinely ABSENT or',
    '    completely non-functional in the running app. Do NOT roll several present-but-imperfect items up',
    '    into one [CRITICAL] "Missing Required Features" — that reports a working app as failing.',
    '  • Add your CONFIDENCE to every [CRITICAL] like "[CRITICAL] (confidence: high)". Use high ONLY when',
    '    you are certain it is really broken; use medium/low when you are unsure — an unsure critical will',
    '    be treated as a warning, not a build failure, so do NOT block a working app on a guess.',
    '',
    'End with: "Score: N/100" (where N = your quality assessment).',
    'If everything looks good, just write: [PASS] App looks complete. Score: 90',
    ...(opts.mode === 'suggest' && opts.inlineFiles && opts.inlineFiles.files.length > 0 ? [
      '',
      `THE FILES THAT CHANGED, IN FULL (${opts.inlineFiles.files.length}). They are complete and current — review them`,
      'from here and answer directly. Do NOT read any of these again with a tool.',
      ...opts.inlineFiles.files.map(({ path, content }) => `\n=== ${path} ===\n${content}`),
      ...(opts.inlineFiles.omitted.length > 0 ? [
        '',
        leanReviewAnswersInOneCall(opts.inlineFiles)
          ? `Changed but not included (a stylesheet too large for this review): ${opts.inlineFiles.omitted.join(', ')}. You have no tools in this review — judge the code above.`
          : `Changed but not included (too large for this review): ${opts.inlineFiles.omitted.join(', ')} — read one only if a finding depends on it.`,
      ] : []),
    ] : []),
    ...(opts.mode === 'suggest' ? [
      '',
      // 🔴 THIS SENTENCE USED TO PROMISE THE REVIEWER THAT NOTHING WOULD BE REPAIRED, which stopped being true on
      // 2026-09-23 when `AGENTV3_GREEN_FUNCTIONAL_REPAIR` shipped: a [BROKEN]-class finding on a working
      // app DOES get one verified repair. Telling the reviewer its findings are inert is exactly the
      // wrong incentive for the one tag we now ask it to be careful with.
      'THIS APP IS PROVEN TO RENDER IN A REAL BROWSER, AND THIS REVIEW IS SUGGEST-ONLY: nothing you',
      'report can fail the build. A finding you tag [BROKEN] may get ONE automatic repair, which is undone',
      'unless it is proven to work; everything else is shown to the user as',
      ...(leanReviewAnswersInOneCall(opts.inlineFiles) ? [
      'an offer. You have NO tools in this review: every file that changed is above, in full. Answer',
      'from it now, in this one reply. If nothing is genuinely wrong, say [PASS] immediately.',
      ] : [
      'an offer. So spend accordingly. Read each file you need ONCE (you were already handed samples above',
      'and a file you have read does not change while you review it — re-reading it buys nothing and costs',
      'the user money). Do not survey the project; look at what changed and answer. Do not call',
      'second_opinion. If nothing is genuinely wrong, say [PASS] immediately.',
      ]),
    ] : []),
  ].join('\n');
}

export async function reviewBuild(opts: ReviewBuildOpts): Promise<ReviewResult> {
  const { fileTree } = opts;

  // Defensive: never review an unreadable/empty workspace — an empty listing means we could not
  // read the files, NOT that the app has no code. Return a neutral, honest skipped result so the
  // user never sees a false "missing all source code, 0/100" after a successful build.
  if (!hasReviewableSource(fileTree)) {
    return {
      passed: true,
      score: 0,
      issues: [],
      summary: 'Review skipped — the workspace file listing could not be read (the build still completed).',
    };
  }

  const instruction = reviewerInstruction(opts);

  try {
    const { ok, summary } = await opts.spawn('reviewer', instruction);
    // VAJRA V4-2 honesty: a reviewer that FAILED (ok:false — e.g. its own prompt hit a provider
    // limit) or whose "summary" is itself a provider-failure error must NOT render as a real review
    // with a made-up "(85/100)" score (report 2026-07-07: "⚠️ Build Review (85/100): Error: All v5.0
    // providers failed…"). Score 0 → formatReview shows nothing; the build stands on its own gates.
    if (ok === false || isReviewFailureSummary(summary)) {
      return { passed: true, score: 0, issues: [], summary: 'Review did not complete.' };
    }
    const issues = parseReviewOutput(summary);
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const passed = criticalCount === 0;
    const scoreMatch = summary.match(/score[:\s]+(\d+)/i);
    const score = scoreMatch
      ? Math.min(100, Math.max(1, parseInt(scoreMatch[1], 10)))
      : passed
      ? 85
      : 40;
    return { passed, score, scoreStated: Boolean(scoreMatch), issues, summary: trimReviewSummary(summary) };
  } catch {
    return { passed: true, score: 0, issues: [], summary: 'Review skipped.' };
  }
}

/** True when a reviewer's returned summary is actually a failure/error string, not a real review. Pure. */
export function isReviewFailureSummary(summary: unknown): boolean {
  if (typeof summary !== 'string' || !summary.trim()) return true;
  return /^\s*error\b|all v3\.0 providers failed|providers? (failed|are unavailable)|too large for every ai provider|step limit reached|budget (cap|limit) reached/i.test(summary);
}

/** Format a ReviewResult as a narration string. Returns '' if score is 0 (skipped). */
/**
 * The review's prose, cut at a paragraph or sentence boundary — never mid-word (autopsy d798ddd3: the
 * user's review ended "Fix: start with `0.` when the first digit is a d"). An open code fence is closed
 * so the cut cannot leave the rest of the chat rendered as code. PURE.
 */
export const REVIEW_SUMMARY_MAX = 600;
export function trimReviewSummary(summary: string, max = REVIEW_SUMMARY_MAX): string {
  const text = typeof summary === 'string' ? summary : '';
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const para = head.lastIndexOf('\n\n');
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  const cut = para >= max * 0.4 ? para : sentence >= max * 0.4 ? sentence + 1 : head.lastIndexOf(' ');
  let out = head.slice(0, cut > 0 ? cut : max).trimEnd();
  if ((out.match(/```/g) ?? []).length % 2 === 1) out += '\n```';
  return `${out} …`;
}

/**
 * A review that says it found bugs and from which we read none (autopsy d798ddd3). Every finding format
 * we know is parsed above; this is the honest net for the next one we do not — the admin is told the
 * review's findings were not read, and the user is never shown a ✅ over "I found genuine issues". PURE.
 */
const REVIEW_DEFECT_SENTENCE_RE = /\b(bugs?|broken|incorrect|wrong (?:result|value|output|answer)|crash(?:es)?|NaN|corrupts?|does not work|doesn'?t work)\b/i;
export function reviewHasUnreadFindings(review: Pick<ReviewResult, 'issues' | 'summary'> | null | undefined): boolean {
  if (!review || typeof review.summary !== 'string' || (review.issues?.length ?? 0) > 0) return false;
  if (/\[pass\]/i.test(review.summary)) return false;
  return review.summary
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => REVIEW_DEFECT_SENTENCE_RE.test(sentence) && !NO_FINDINGS_RE.test(sentence.replace(/^[#>*\s\d.)-]+/, '')));
}

export function formatReview(review: ReviewResult): string {
  if (review.score === 0) return '';
  // AN INFERRED NUMBER IS NEVER SHOWN, AND NEVER PICKS THE ICON (autopsy 4d538ca3). A clean [PASS]
  // with no findings was headed "⚠️ (85/100)" because the score it never stated was inferred as 85.
  // A stated score keeps its bands (it is the reviewer's own judgement); without one, the icon follows
  // the findings: a critical is ❌, a warning ⚠️, none ✅.
  const shownScore = review.scoreStated !== false;
  const icon = shownScore
    ? (review.score >= 90 ? '✅' : review.score >= 70 ? '⚠️' : '❌')
    : review.issues.some((i) => i.severity === 'critical') ? '❌'
      : review.issues.some((i) => i.severity === 'warning') || reviewHasUnreadFindings(review) ? '⚠️' : '✅';
  const header = shownScore
    ? `${icon} Build Review (${review.score}/100): ${review.summary}`
    : `${icon} Build Review: ${review.summary}`;
  if (review.issues.length === 0) return header;
  const issueLines = review.issues
    .slice(0, 5)
    .map(
      (i) =>
        `  ${i.severity === 'critical' ? '🚨' : i.severity === 'warning' ? '⚠️' : '💡'} ${i.message}`,
    );
  return [header, ...issueLines].join('\n');
}
