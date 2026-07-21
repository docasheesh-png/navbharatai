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

export interface FeatureProbeResult {
  /** The requested feature (stable slug, e.g. 'add', 'delete', 'filter'). */
  feature: string;
  /** A short human label for the report. */
  label: string;
  /** True when a matching affordance was found in the rendered HTML. */
  present: boolean;
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
  /** Returns true when the rendered HTML shows a matching affordance. Given (rawHtmlLower, visibleTextLower). */
  present: (htmlLower: string, textLower: string) => boolean;
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

/** A clickable control (button/link/aria-label) whose text/label matches `re`. */
function hasControlMatching(htmlLower: string, textLower: string, re: RegExp): boolean {
  if (re.test(textLower)) return true;                       // visible button/link text
  // aria-label / title / value / placeholder attributes carrying the intent (icon-only buttons).
  const attrs = htmlLower.match(/(?:aria-label|title|value|placeholder|alt)=["']([^"']*)["']/g) || [];
  return attrs.some((a) => re.test(a));
}

const FEATURES: FeatureDef[] = [
  {
    feature: 'add', label: 'Add / create',
    requested: /\b(add|create|new (?:task|item|note|todo|entry|record)|insert)\b/,
    // Needs an input to type into AND a control to submit it (button text or a form).
    present: (h, t) => inputCount(h) >= 1 && (hasControlMatching(h, t, /\b(add|create|save|submit|new|\+)\b/) || /<form\b/.test(h)),
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
    requested: /\b(mark (?:as )?complete|complete|done|check(?:box)?|toggle)\b/,
    present: (h, t) => /type=["']checkbox["']/.test(h) || /role=["']checkbox["']/.test(h) || hasControlMatching(h, t, /\b(complete|done|✓|✔)\b/),
  },
  {
    feature: 'filter', label: 'Filter',
    requested: /\b(filter|all\b.*\bactive|active\b.*\bcompleted|tabs?)\b/,
    // A filter UI is usually 2+ sibling toggle controls (All / Active / Completed).
    present: (h, t) => hasControlMatching(h, t, /\b(all|active|completed|pending|show all)\b/) && buttonCount(h) >= 2,
  },
  {
    feature: 'search', label: 'Search',
    requested: /\b(search|find|lookup)\b/,
    present: (h) => /type=["']search["']/.test(h) || /(?:placeholder|aria-label)=["'][^"']*search/.test(h),
  },
  {
    feature: 'list', label: 'List / items',
    requested: /\b(list|tasks?|items?|notes?|todos?|entries|records|feed)\b/,
    // A real list OR an honest empty-state ("no tasks yet") both count as "the list surface exists".
    present: (h, t) => /<(?:ul|ol)\b/.test(h) || /role=["']list["']/.test(h) || (h.match(/<li\b/g) || []).length >= 1 || /\bno (?:tasks?|items?|notes?|todos?|results?|entries)\b|\bempty\b|\badd (?:a|your first)\b/.test(t),
  },
  {
    feature: 'auth', label: 'Login / authentication',
    requested: /\b(login|log in|sign in|sign-in|auth|authentication|password|register|sign up)\b/,
    present: (h, t) => /type=["']password["']/.test(h) || hasControlMatching(h, t, /\b(login|log in|sign in|sign up|register|logout)\b/),
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
export function checkFeaturePresence(prompt: string, html: string): FeaturePresenceResult {
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
    // Negation-aware (deep-test App #1): a feature the user DECLINED ("no delete", "without search")
    // must not be probed, or we'd false-flag it missing. Shares the RequirementCoverage guard.
    if (!isAffirmativelyRequested(promptLower, def.requested)) continue; // not requested → don't probe
    let present = false;
    try { present = def.present(htmlLower, textLower); } catch { present = false; }
    probes.push({ feature: def.feature, label: def.label, present });
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
  return inFlagRollout(process.env.AGENTV3_FEATURE_HEAL === 'on', process.env.AGENTV3_FEATURE_HEAL_PCT, rolloutKey);
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
