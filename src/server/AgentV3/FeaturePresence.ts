// AgentV3 — "App Health Culture", slice 1: feature-presence check.
//
// The existing PreviewVerify answers "is the app ALIVE?" (did it render / blank / crash). This answers
// the next question — "does the living app DO the job the user asked for?" — the software equivalent of
// culturing an organism instead of only staining it (admin's biology analogy, 2026-07-12).
//
// It is DETERMINISTIC and CONSERVATIVE: from the user's prompt it derives which common interactive
// features were REQUESTED (add / delete / edit / filter / search / list / auth / theme), then checks the
// RENDERED preview HTML for a matching affordance. A feature is reported "missing" ONLY when its keyword
// is clearly in the prompt AND no matching affordance is found — so it highlights "user asked for Delete
// but there is no delete control" without false-flagging apps that simply used different wording.
//
// Pure + dependency-free (fully unit-testable). Advisory only — it records an honest finding; it never
// blocks or fails a build (a heuristic must never false-fail a working app — the one absolute rule).

import { isAffirmativelyRequested } from './featureRequest';
import { inFlagRollout } from './escalationRollout';
import { envFlag } from '../lib/envFlag';

/**
 * WHAT a "present" verdict actually rests on — and the distinction is load-bearing, not bookkeeping.
 *
 * `control` — a structural or attribute signal that can only come from a real affordance being in the
 *   captured DOM: an `<input>`, a `<button>`, `type="checkbox"`, `type="password"`, a `<ul>`/`<li>`,
 *   a `<form>`, or a `placeholder`/`aria-label` on a field.
 * `text`  — visible PROSE only. The page says the word somewhere. That is a hint about the app and it
 *   is NOT evidence that any control was captured, because `hasControlMatching` tests the page's whole
 *   visible-text blob and cannot tell a button's label from a sentence in a paragraph.
 */
export type PresenceEvidence = 'control' | 'text';

export interface FeatureProbeResult {
  /** The requested feature (stable slug, e.g. 'add', 'delete', 'filter'). */
  feature: string;
  /** A short human label for the report. */
  label: string;
  /** True when a matching affordance was found in the rendered HTML. */
  present: boolean;
  /** For a PRESENT probe, what the verdict rests on. Absent for a missing one. See PresenceEvidence. */
  via?: PresenceEvidence;
}

export interface FeaturePresenceResult {
  /** Every REQUESTED feature that we know how to probe, with its present/missing verdict. */
  probes: FeatureProbeResult[];
  /** Labels of requested features whose affordance was NOT found (the highlight list). */
  missing: string[];
  /** Labels of requested features whose affordance WAS found. */
  present: string[];
}

interface FeatureDef {
  feature: string;
  label: string;
  /** Any of these substrings in the (lowercased) prompt marks the feature as REQUESTED. */
  requested: RegExp;
  /**
   * The matching affordance in the rendered HTML, or `false`. Given (rawHtmlLower, visibleTextLower).
   * Returning the EVIDENCE KIND rather than a bare boolean is what lets the corroboration guard below
   * refuse a witness that only ever saw prose.
   */
  present: (htmlLower: string, textLower: string) => PresenceEvidence | false;
}

/** Strip to visible text (labels, button text) — same approach as PreviewVerify.visibleText. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many <input>/<textarea>/contenteditable fields the page shows. */
function inputCount(htmlLower: string): number {
  const inputs = (htmlLower.match(/<input\b/g) || []).length;
  const textareas = (htmlLower.match(/<textarea\b/g) || []).length;
  const editable = (htmlLower.match(/contenteditable=["']?true/g) || []).length;
  return inputs + textareas + editable;
}

/** How many clickable controls (button / role=button / <a>) the page shows. */
function buttonCount(htmlLower: string): number {
  const buttons = (htmlLower.match(/<button\b/g) || []).length;
  const roleBtn = (htmlLower.match(/role=["']button["']/g) || []).length;
  const links = (htmlLower.match(/<a\b/g) || []).length;
  return buttons + roleBtn + links;
}

/**
 * A clickable control (button/link/aria-label) whose text/label matches `re`.
 *
 * ⚠️ IT REPORTS *HOW* IT MATCHED, AND THAT IS THE WHOLE POINT. The `text` branch tests the page's
 * ENTIRE visible-text blob, so a word sitting in an ordinary paragraph satisfies it just as readily as
 * a button's own label — this function cannot tell the two apart, and pretending otherwise is what let
 * a sentence vouch for a control nobody captured (autopsy 56f0c645). An ATTRIBUTE match is different in
 * kind: `aria-label`/`placeholder`/`title`/`value`/`alt` only exist on real elements.
 */
function hasControlMatching(htmlLower: string, textLower: string, re: RegExp): PresenceEvidence | false {
  // Attributes first: strictly stronger evidence, and checking it first means a page that has BOTH is
  // credited with the control rather than the prose.
  const attrs = htmlLower.match(/(?:aria-label|title|value|placeholder|alt)=["']([^"']*)["']/g) || [];
  if (attrs.some((a) => re.test(a))) return 'control';
  if (re.test(textLower)) return 'text';                     // visible button/link text OR mere prose
  return false;
}

/** `true` only when the match came from a real element, never from prose. */
function matchedAControl(m: PresenceEvidence | false): boolean {
  return m === 'control';
}

/**
 * What follows "add" when it is an INSTRUCTION TO THE BUILDER rather than a request for an Add control.
 *
 * 🔴 WHY (autopsy `ad1596fc`, 2026-09-21). The prompt was *"**Add** pagination or infinite scroll to the
 * main list so long lists stay fast and easy to browse."* The very first word tripped the `add` probe,
 * no Add button was found in a memory game, and **"Add / create has no visible control" became the
 * build's reported root cause** — for a build that did exactly what was asked.
 *
 * This is the third occurrence of one class, and `featureRequest.ts` already names the other two: a
 * NEGATED mention ("no settings") and a DEFERRED one ("login in stage 3"). This is the present tense:
 * the word is there, affirmative and undeferred, and means something else. `add` is the worst offender
 * because it is also the commonest word an English sentence starts an instruction with.
 *
 * 🔑 The object decides. `add a task` names a thing the USER will add, so an Add control must exist.
 * `add pagination`, `add dark mode`, `add tests` name a CAPABILITY the builder is being told to build —
 * and the second half of report `1682cd03` is the Hinglish form of the same thing, *"…bhi **add karo**"*,
 * where `add karo` is simply "please make this change".
 *
 * ⚠️ A BLOCKLIST, DELIBERATELY, and only after a determiner. The opposite shape — an allowlist of data
 * nouns — has no end (`add a recipe`, `add a song`, `add a patient`), and being wrong there SILENCES a
 * real missing-control finding. Being wrong here only leaves today's false positive in place, which is
 * the safe direction. The known residual: `add a contact page` is not suppressed, because allowing
 * arbitrary words before the noun would swallow `add task and filter`.
 */
const BUILDER_INSTRUCTION_OBJECT =
  '(?:a\\s+|an\\s+|the\\s+|some\\s+|more\\s+|proper\\s+|basic\\s+)*' +
  '(?:pagination|infinite\\s+scroll(?:ing)?|lazy\\s+load(?:ing)?|search(?:ing)?|filter(?:s|ing)?|' +
  'sort(?:s|ing)?|dark\\s+mode|light\\s+mode|theme|login|log\\s*in|sign\\s*up|auth(?:entication)?|' +
  'tests?|validation|animations?|transitions?|charts?|graphs?|responsive(?:ness)?|offline|footer|header|' +
  'nav\\s*bar|navigation|sidebar|menu|pages?|screens?|routes?|tabs?|buttons?|icons?|loading|spinner|' +
  'empty\\s+state|error\\s+handling|modal|dialog|toast|notifications?|shortcuts?|accessibility|seo|' +
  'meta|service\\s+worker|analytics|cach(?:e|ing)|database|api|endpoints?|backend|styling|css|polish|' +
  'features?|functionality|support|ability|option)s?\\b' +
  // The instruction with no object at all: "add it", "add this", and the Hinglish "add karo".
  '|(?:it|this|that|them|these|those)\\b|(?:karo|kar\\s*do|kar\\s*dijiye|kijiye|kare)\\b';

const FEATURES: FeatureDef[] = [
  {
    feature: 'add', label: 'Add / create',
    // See BUILDER_INSTRUCTION_OBJECT above: `add a task` is a control, `add pagination` is an order.
    requested: new RegExp(
      `\\b(?:add|create|insert)\\b(?!\\s+(?:${BUILDER_INSTRUCTION_OBJECT}))` +
      '|\\bnew\\s+(?:task|item|note|todo|entry|record)\\b',
    ),
    // Needs an input to type into AND a control to submit it (button text or a form).
    present: (h, t) => (inputCount(h) >= 1 && (hasControlMatching(h, t, /\b(add|create|save|submit|new|\+)\b/) !== false || /<form\b/.test(h)))
      ? 'control' // an <input> was captured — that is a real affordance, whatever matched the verb
      : false,
  },
  {
    feature: 'delete', label: 'Delete / remove',
    requested: /\b(delete|remove|trash|clear (?:task|item|completed|all))\b/,
    present: (h, t) => hasControlMatching(h, t, /\b(delete|remove|trash|clear|✕|×|✖|🗑)\b/),
  },
  {
    feature: 'edit', label: 'Edit / update',
    requested: /\b(edit|update|rename|modify)\b/,
    present: (h, t) => hasControlMatching(h, t, /\b(edit|update|rename|save|✎|✏)\b/),
  },
  {
    feature: 'complete', label: 'Mark complete / toggle',
    // 🔴 SENSE, NOT JUST PRESENCE (autopsy 8a92e5ed, 2026-09-20). The old pattern accepted a BARE
    // `toggle`, `complete` or `done`. A password generator asked to *"toggle uppercase, numbers and
    // symbols"* was therefore recorded as requesting a task-completion control, found none, and that
    // false finding became the whole build's reported root cause. `toggle` there is a verb taking a
    // SETTING as its object; the feature this probe means always concerns an ITEM being finished. So
    // the keyword must arrive with the company that fixes its sense — which is the same lesson
    // `featureRequest.ts` already encodes for negation ("no settings") and deferral ("login in stage
    // 3"), in a third tense.
    requested: /\bmark\b[^.]{0,20}\b(?:complete|completed|done)\b|\b(?:complete|completed|done)\s+(?:task|item|todo|to-?do|entry|entries|chore)s?\b|\b(?:task|item|todo|to-?do|entry|entries|chore)s?\s+(?:as\s+)?(?:complete|completed|done)\b|\bcheckbox(?:es)?\b|\bchecklist\b|\btick\b[^.]{0,15}\boff\b|\btoggle\b[^.]{0,15}\b(?:complete|completed|done|task|item|todo)s?\b/,
    present: (h, t) => (/type=["']checkbox["']/.test(h) || /role=["']checkbox["']/.test(h))
      ? 'control'
      : hasControlMatching(h, t, /\b(complete|done|✓|✔)\b/),
  },
  {
    feature: 'filter', label: 'Filter',
    requested: /\b(filter|all\b.*\bactive|active\b.*\bcompleted|tabs?)\b/,
    // A filter UI is usually 2+ sibling toggle controls (All / Active / Completed).
    present: (h, t) => (hasControlMatching(h, t, /\b(all|active|completed|pending|show all)\b/) !== false && buttonCount(h) >= 2)
      ? 'control' // two or more buttons were captured
      : false,
  },
  {
    feature: 'search', label: 'Search',
    requested: /\b(search|find|lookup)\b/,
    present: (h) => (/type=["']search["']/.test(h) || /(?:placeholder|aria-label)=["'][^"']*search/.test(h))
      ? 'control'
      : false,
  },
  {
    feature: 'list', label: 'List / items',
    requested: /\b(list|tasks?|items?|notes?|todos?|entries|records|feed)\b/,
    // A real list OR an honest empty-state ("no tasks yet") both count as "the list surface exists".
    present: (h, t) => {
      if (/<(?:ul|ol)\b/.test(h) || /role=["']list["']/.test(h) || (h.match(/<li\b/g) || []).length >= 1) return 'control';
      // AN EMPTY-STATE SENTENCE IS NOT A CAPTURED LIST. It still counts as "the list surface exists",
      // but only as PROSE — this is the exact branch that vouched for a partial capture in 56f0c645.
      return /\bno (?:tasks?|items?|notes?|todos?|results?|entries)\b|\bempty\b|\badd (?:a|your first)\b/.test(t)
        ? 'text'
        : false;
    },
  },
  {
    feature: 'auth', label: 'Login / authentication',
    // `password` is GONE from this list, for the same reason (autopsy 8a92e5ed). It is the SUBJECT of
    // a password generator, a password manager and a strength meter, none of which is a login — and
    // in that report it probed PRESENT (the app has a `type="password"` field), which is worse than
    // a harmless extra line: the guard below only lets a "missing" finding through once some OTHER
    // probe is present, so this false POSITIVE is what certified the false NEGATIVE above as real.
    // (Since 56f0c645 that witness must rest on a real ELEMENT, so a `type="password"` field would
    // still have certified it — dropping the keyword is what closes this one, not the stricter guard.)
    // Nothing is lost by dropping it. An app that genuinely asks for a password field almost always
    // says login / sign in / sign up / register / account somewhere, and one that says only
    // "password" has the field, so it would have probed present and reported nothing either way.
    requested: /\b(login|log in|log-in|sign in|sign-in|signin|sign up|sign-up|signup|auth|authentication|authenticate|register|registration|user account)\b/,
    present: (h, t) => /type=["']password["']/.test(h)
      ? 'control'
      : hasControlMatching(h, t, /\b(login|log in|sign in|sign up|register|logout)\b/),
  },
  {
    feature: 'theme', label: 'Dark mode / theme toggle',
    requested: /\b(dark mode|light mode|theme (?:toggle|switch)|toggle theme)\b/,
    present: (h, t) => hasControlMatching(h, t, /\b(dark|light|theme|🌙|☀|mode)\b/),
  },
];

/**
 * Is this HTML an UN-rendered SPA shell — an empty root mount, no controls, negligible visible text?
 *
 * ROOT CAUSE (deep-test build #2, 2026-07-17): a Vite/React app is CLIENT-rendered — its served HTML is
 * `<div id="root"></div>` + a script; the inputs/buttons/lists only exist AFTER JS runs in a browser. When
 * the preview capture returns that shell (the browser DOM wasn't captured — a curl fallback, or a snapshot
 * that beat React's first paint), EVERY feature probes as absent → a FALSE "Present: none" that even became
 * the build's rootCause on a fully-working app. Detecting the shell lets the caller stay HONEST ("couldn't
 * verify the DOM") instead of lying that a working app has no features. Pure.
 */
export function isUnrenderedSpaShell(html: string): boolean {
  if (typeof html !== 'string') return true;
  const lower = html.toLowerCase();
  // A known SPA mount point that the framework renders INTO (React root, Next, Gatsby, Vue #app).
  const hasRootMount = /<(?:div|main|section)\b[^>]*\bid=["'](?:root|app|__next|___gatsby)["']/.test(lower);
  if (!hasRootMount) return false; // not a recognisable SPA shell → judge the HTML normally
  const controls = inputCount(lower) + buttonCount(lower)
    + (lower.match(/<(?:ul|ol|li|select|table|form|h[1-6])\b/g) || []).length;
  // A rendered app has real controls and/or meaningful visible text; a bare shell has ~neither.
  return controls === 0 && visibleText(html).length < 40;
}

/**
 * Check which REQUESTED interactive features are visibly present in the rendered preview HTML.
 * Only features whose keywords appear in the prompt are probed. Pure; never throws.
 */
/**
 * `declined` — feature ids the user unticked on the feature card (featurePlan.ts). Not probed, so a
 * declined feature is never reported missing and never "added" by the heal pass behind the user's back.
 */
export function checkFeaturePresence(prompt: string, html: string, declined?: ReadonlySet<string>): FeaturePresenceResult {
  const empty: FeaturePresenceResult = { probes: [], missing: [], present: [] };
  if (typeof prompt !== 'string' || typeof html !== 'string' || !html.trim()) return empty;
  // HONESTY GUARD (build #2): never judge features off an un-rendered SPA shell — we literally cannot see
  // the controls, so claiming they're missing is a false negative. Report nothing (probes:[]) instead.
  if (isUnrenderedSpaShell(html)) return empty;
  const promptLower = prompt.toLowerCase();
  const htmlLower = html.toLowerCase();
  const textLower = visibleText(html).toLowerCase();

  const probes: FeatureProbeResult[] = [];
  for (const def of FEATURES) {
    if (declined?.has(def.feature)) continue;
    // Negation-aware (deep-test App #1): a feature the user DECLINED ("no delete", "without search")
    // must not be probed, or we'd false-flag it missing. Shares the RequirementCoverage guard.
    if (!isAffirmativelyRequested(promptLower, def.requested)) continue; // not requested → don't probe
    let via: PresenceEvidence | false = false;
    try { via = def.present(htmlLower, textLower); } catch { via = false; }
    probes.push(via === false
      ? { feature: def.feature, label: def.label, present: false }
      : { feature: def.feature, label: def.label, present: true, via });
  }
  const presentProbes = probes.filter((p) => p.present);
  // CAPTURE-CORROBORATION GUARD (deep-test build #4, 2026-07-17; widened by real report 1682cd03,
  // 2026-07-17): only report a REQUESTED feature "missing" once the capture is CORROBORATED — i.e. at
  // least one OTHER requested feature probed PRESENT, proving the rendered DOM was really captured. When
  // ZERO probed features are present ("Present: none"), the far likelier cause is a pre-render/partial
  // capture or an over-broad keyword match than a build (which rendered and passed its preview self-check)
  // genuinely shipping none of its UI. A REAL missing-feature result is PARTIAL (some present, some
  // missing); an all-absent result is the capture-miss / false-trigger signature.
  //   • build #4: "renders correctly" at 468s yet FEATURE_COVERAGE claimed Present: none for all 6.
  //   • report 1682cd03: the Hinglish EDIT instruction "rest timer me 30s ka option bhi add karo" — where
  //     "add karo" means "please make this change", NOT "build an Add feature" — tripped the lone `add`
  //     probe, found no Add/create control, and falsely reported "Present: none" (it became the rootCause
  //     of a 95/100 PASSING build). A single unproven signal must not indict a working app.
  // So: any all-absent result (regardless of probe count) stays silent. Advisory-only — a genuinely blank
  // app is caught by the preview/readiness checks, not by this heuristic. Report nothing.
  if (probes.length >= 1 && presentProbes.length === 0) return empty;
  // 🔴 AND THE WITNESS MUST HAVE SEEN A CONTROL (autopsy 56f0c645, 2026-09-21). The guard above rests
  // on one premise — "another feature probed PRESENT, so the DOM really was captured" — and that premise
  // is FALSE for a probe satisfied by prose. The `list` rule counts an empty-state sentence ("No notes
  // yet"), `hasControlMatching` tests the whole visible-text blob, and neither proves one affordance was
  // captured.
  //
  // What that cost, reproduced exactly from the report: a quick-notes app whose search box is present,
  // labelled `aria-label="Search notes"` and wired to a real filter was reported as having NO search
  // control. The capture had painted the heading and the empty-state line and nothing else; `list`
  // matched the sentence, vouched for the capture, and released a false verdict against a working app.
  // 44 characters of text also carried it past `isUnrenderedSpaShell`'s 40-character floor.
  //
  // So corroboration now needs evidence of the right KIND, not merely of the right count — at least one
  // present probe must rest on a real element before any feature may be called missing.
  //
  // 🔒 IT GATES THE ACCUSATION, NOT THE WHOLE RESULT, and this repo's own suite is what established the
  // difference. The first version returned `empty` whenever no control-backed witness existed, which
  // also silenced results where NOTHING was missing — and an all-present result accuses nobody, so
  // there is nothing in it to be wrong about. ("an honest empty-state counts the list surface as
  // present" failed, correctly.) The false-verdict risk lives entirely in the missing list.
  //
  // ⚠️ THE TRADE, STATED: an app that really lacks a control, whose only present feature is
  // prose-matched, now stays SILENT instead of reporting that gap. That is the deliberate direction —
  // this check is advisory, a missed advisory costs one line in a report, and a false "your feature is
  // missing" tells a user their working app is broken (and, inside the AGENTV3_FEATURE_HEAL cohort,
  // spends a model pass adding a control that is already there).
  const missingProbes = probes.filter((p) => !p.present);
  if (missingProbes.length > 0 && !presentProbes.some((p) => p.via === 'control')) return empty;
  return {
    probes,
    missing: probes.filter((p) => !p.present).map((p) => p.label),
    present: presentProbes.map((p) => p.label),
  };
}

/** A short, human/agent-facing summary line for the build report. Empty when nothing was probed. */
export function featurePresenceSummary(r: FeaturePresenceResult): string {
  if (r.probes.length === 0) return '';
  if (r.missing.length === 0) {
    return `Feature coverage: all ${r.present.length} requested feature(s) are visibly present in the running app (${r.present.join(', ')}).`;
  }
  return `Feature coverage: ${r.missing.length} requested feature(s) have NO visible control in the running app — ${r.missing.join(', ')}. Present: ${r.present.join(', ') || 'none'}.`;
}

/**
 * What each verdict RESTED ON, for the admin report. PURE.
 *
 * 🔎 WHY THIS EXISTS AT ALL — it is the other half of the 56f0c645 fix, and the half that took the
 * longest to establish. The report recorded the VERDICT ("Search has no visible control") and none of
 * the evidence, so the finding could not be audited: settling whether a working app had really lost
 * its search box meant hashing the scaffold's `App.tsx`, re-running the probe against a reconstructed
 * DOM, and finally guessing the capture — an hour to answer a question one line could have answered.
 *
 * A finding nobody can check is re-litigated every time it appears. So a present probe now says which
 * KIND of evidence carried it, and the caller records the capture beside it.
 */
export function featurePresenceEvidence(r: FeaturePresenceResult): string {
  if (r.probes.length === 0) return '';
  return r.probes
    .map((p) => `${p.label}=${p.present ? (p.via ?? 'control') : 'absent'}`)
    .join(' · ');
}

/**
 * App Health Culture slice 2 (Phase 1b) — the missing-feature AUTO-FIX pass.
 *
 * Slice 1 only RECORDS a FEATURE_COVERAGE finding (advisory). This flag turns on the closed loop:
 * when the running app rendered but a requested control is missing, run ONE bounded heal pass that
 * adds the missing UI, then re-check. OFF by default (`AGENTV3_FEATURE_HEAL=on` to enable) because
 * it spends an extra repair pass — same opt-in discipline as the runtime auto-fix loop. It NEVER
 * blocks or fails a build: if the heal doesn't add the control, the honest finding still stands.
 */
export function featureHealEnabled(rolloutKey?: string): boolean {
  // Optional percentage canary: AGENTV3_FEATURE_HEAL_PCT=N enables it for N% of builds (keyed by
  // workspaceId) so the admin can measure before a global ramp. Unset PCT = 100% (a plain global "on").
  return inFlagRollout(envFlag('AGENTV3_FEATURE_HEAL'), process.env.AGENTV3_FEATURE_HEAL_PCT, rolloutKey, 'AGENTV3_FEATURE_HEAL_PCT');
}

/** An agent-facing repair instruction for the missing features (used only when a heal pass runs). */
export function featurePresenceRepairPrompt(r: FeaturePresenceResult): string {
  if (r.missing.length === 0) return '';
  return [
    'The app rendered, but these REQUESTED features have no visible control in the running UI:',
    ...r.missing.map((m) => `  - ${m}`),
    '',
    'Add the missing UI + wiring so each of these features is actually usable in the app. Read the',
    'relevant components first, make the minimum targeted edits, and keep the existing working features',
    'intact. Do not add anything the user did not ask for.',
  ].join('\n');
}
