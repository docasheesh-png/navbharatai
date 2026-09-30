// AgentV3 — PRESS EVERY SAFE BUTTON, the way a person trying the app would (competitive gap G1,
// admin 2026-09-28: "best solution jo gaps ko fill kar ke navbharatai ko competitors se aage la jaye").
//
// THE GAP. Everything we run after a build either watches the app PAINT (the preview verifier, the page
// checks, the console capture) or drives ONE derived form (the journey check). Nothing presses the rest
// of the app. So the commonest thing a person does in their first minute — tap the tabs, open the
// menu, press "Start", switch the filter — is the one thing no check of ours has ever done, and the
// commonest failure of a generated app lives exactly there: a button whose handler throws, a tab that
// white-screens the whole app, a link to a page that was never written. The app renders, the build
// says "ready", and the first tap breaks it.
//
// WHAT THIS DOES, and why it costs nothing: one browser (pre-baked into the sandbox image, the same one
// PageRouteCheck and the journey use), no model call, no npm install. It reads the RUNNING page for its
// visible clickable controls, and presses each one on a FRESH load of the page — so a failure is
// attributable to exactly one control, never to the ones pressed before it. After each press it asks
// four questions, each of which has only one honest answer:
//   • did the app crash into an error overlay?
//   • did the screen go blank (the root had content before and has none now)?
//   • did an in-app link land on a page that does not exist?
//   • did the press throw an uncaught error (or log a real one)?
//
// ONE LEVEL DEEPER (same day): a press that worked and changed the screen — a tab, a menu, an in-app
// link — may have opened an inner screen, and that is where "the first page works, the rest is broken"
// lives. The controls it revealed (never ones the first screen already had) are pressed too, bounded by
// MAX_SECOND_LEVEL_CLICKS and MAX_SECOND_LEVEL_PER_PARENT, each reached by pressing its parent UNARMED
// on a fresh load so nothing the parent does is blamed on the child.
//
// 🔒 IT MUST NEVER HARM THE APP OR ITS OWNER, so what it will NOT press is the design, not a detail:
//   • anything whose name says it deletes, clears, pays, buys, sends, shares, logs out, uploads or
//     downloads — a check that empties somebody's list to prove the button works is a check nobody
//     would switch on twice;
//   • a form's submit button — the journey check owns forms, and it types a marker it can clean up;
//   • links that leave the app (another origin, mailto:, tel:, a new tab, a download);
//   • a control with no readable name — an unnamed icon is as likely a trash can as anything else;
//   • and when the app talks to a database the USER owns, every creating or saving verb too, because a
//     row written into somebody's real Supabase is not ours to write (`writesToUserDatabase`, the same
//     rule the journey check obeys).
// Browser dialogs (confirm/alert/prompt) are DISMISSED, so a "Are you sure?" on something we missed
// answers "no".
//
// 🔒 A CHECK THAT COULD NOT LOOK IS NOT A PASS. Three outcomes, never two — the class this repo has paid
// for with `JOURNEY_PASSED` and `PAGE_RENDER_FAILED`: the runner loaded the app and pressed controls
// (`ran`, then passed or failed); it loaded the app and found nothing safe to press (`nothing`); or it
// never reached the app at all (`not run`). Each has its own code.
//
// EVIDENCE, NEVER A GATE. A red result here never fails a build and never spends a model call; it tells
// the user, in their build card, which control broke — and offers the fix as the next step.
//
// PURE. The runner is a STRING built here and executed by the caller in the sandbox. No I/O, no clock,
// no model call in this module.

import { browserScriptRunLine, parseScriptDiagnostic, browserScriptFailureNote, playwrightImport } from './sandboxBrowserScript';
import { BROWSER_PAGE_OPTIONS } from './signInExplore';

/** Where the pre-baked Playwright and its browsers live inside the sandbox image. */
export const EXPLORE_TOOLS_DIR = '/home/user/.e-tools';

/** Every result line starts with this — named once, so the parser and the script cannot drift. */
export const EXPLORE_RESULT_MARKER = 'NBAI_EXPLORE ';

/** How many controls on the FIRST screen one build may press. */
export const MAX_EXPLORE_CLICKS = 12;

/**
 * How many SECOND-LEVEL controls may be pressed — the buttons that only appear after a tab, a menu or
 * an in-app link has been opened (2026-09-28). A generated app's inner screens are where "the first
 * page is fine and everything else is broken" lives, and the first-screen pass never saw them.
 */
export const MAX_SECOND_LEVEL_CLICKS = 8;

/** At most this many second-level presses under any one first-level control, so one busy tab cannot spend the budget. */
export const MAX_SECOND_LEVEL_PER_PARENT = 2;

/** How long one fresh page load may take before that control is given up on. */
export const EXPLORE_LOAD_TIMEOUT_MS = 12_000;

/** The runner's own wall clock. It stops starting new presses before this, and says so. */
export const EXPLORE_BUDGET_MS = 75_000;

/** The kill switch. Default ON; `off` restores the pre-change build exactly. */
export function clickExplorerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CLICK_EXPLORE ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Names a control must never be pressed for, whatever the app. A word boundary on each side, so
 * "Order summary" is skipped (conservative) while "Borders" is not. Missing a harmless press costs
 * nothing; pressing a harmful one costs the user's data.
 */
export const NEVER_PRESS = /\b(delete|remove|clear|reset|erase|wipe|empty|discard|archive|trash|destroy|log ?out|sign ?out|logoff|deactivate|unsubscribe|cancel (?:subscription|order|plan|booking)|pay|payment|buy|checkout|check out|purchase|subscribe|donate|order|place order|upgrade|share|send|email|mail|call|whatsapp|sms|print|download|install|upload|export|import|report|block|ban|kick|revoke)\b/i;

/** Names that create or save something — refused only when the app writes to the USER's own database. */
export const WRITE_VERBS = /\b(add|new|create|save|submit|post|publish|book|confirm|update|apply|join|register|sign ?up|enroll|enrol|invite|approve|reject|accept|decline|mark|complete|done|vote|like|follow|rate|comment)\b/i;

/**
 * Console lines that are not a defect of the click: React's development warnings, the DevTools advert,
 * the dev server's own chatter, and a failed resource load (a missing favicon is not a broken button).
 * An UNCAUGHT exception is never filtered — that arrives as `pageerror`, not as a console line.
 */
export const CONSOLE_NOISE = /^(warning:|download the react devtools|\[vite\]|\[hmr\]|failed to load resource|%c)|favicon|react-refresh|each child in a list should have a unique/i;

/**
 * 🔎 A SEARCH BOX AND A SORT MENU ARE TRIED TOO (admin 2026-09-30, after autopsy ee0e6de5: *"haan,
 * search/sort wala check bana do"*). Pressing buttons proves nothing about a control you TYPE into or
 * PICK from, so a lookup app — a table of every country with a search box and an A–Z / Z–A sort — had
 * both of its controls go untested ("nothing safe to press"), and a search box that filters nothing
 * would have passed every check we own. After the first-screen presses, each qualifying control is tried
 * on a fresh load: a word from the list's own items is typed, or another option is chosen, and the
 * screen's text is compared before and after.
 *
 * 🔒 PRECISION FIRST, because a failure here offers — and on a paid tier runs — a repair:
 *   • only a control that NAMES itself a search (type="search", role="searchbox", or its label, name,
 *     placeholder or id says search / filter / find, in English or Hindi) or a sort/filter menu (its
 *     name or its options say sort, order, filter, category, A–Z, newest, price …);
 *   • never one inside a form (the journey owns forms), a dialog, or a row of the list itself (a row's
 *     own "status" menu is that row's setting, and changing it may save something);
 *   • no menu at all when the app writes to the user's own database;
 *   • only with a list of at least three items (search) or two different items (sort) on the screen,
 *     and a search word taken from those items that not every item contains;
 *   • "did nothing" is decided only after the typing, a wait, Enter and another wait — and a search box
 *     with a button beside it is reported as untested, never as broken, because it may search only
 *     when that button is pressed.
 * A control that did nothing is `unresponsive`: a failure, reported and repaired like a crash.
 */
export const MAX_NARROWING_PROBES = 3;

/** Names that make an input a search box. Hindi forms included: the lookup app in that autopsy said "खोजें". */
export const SEARCH_CONTROL = /search|filter|find|look ?up|query|खोज|ढूं?ढ|ढूँढ|khoj|dhoon?dh|dhund/i;

/** Names or options that make a menu a sort or filter menu. Deliberately not "type", "status" or "show". */
export const SORT_CONTROL = /sort|order by|arrange|filter|categor|\ba\s*[-–]\s*z\b|\bz\s*[-–]\s*a\b|ascending|descending|\basc\b|\bdesc\b|newest|oldest|latest|price|low to high|high to low|क्रम|छा[ँं]ट|श्रेणी/i;

/**
 * The word to type into a search box: a word of three or more letters from one of the list's own items
 * that NOT every item contains — so a working search must change what is shown. Unicode-aware, marks
 * included, because a Hindi word split at its vowel signs is not a word. '' when no such word exists.
 * PURE; the runner carries a copy of this body (it cannot import), and a test holds the two equal.
 */
export function pickSearchWord(items: readonly string[]): string {
  const list = (items ?? []).map((t) => String(t ?? ''));
  const lower = list.map((t) => t.toLowerCase());
  const order = [Math.floor(list.length / 2), list.length - 1, 1, 0];
  for (const i of order) {
    const words = (list[i] || '').match(/[\p{L}\p{M}\p{N}]{3,}/gu) || [];
    for (const w of words) {
      const n = lower.filter((t) => t.includes(w.toLowerCase())).length;
      if (n >= 1 && n < list.length) return w;
    }
  }
  return '';
}

/** Whether a control should be pressed, and if not, why — the one rule the in-page collector mirrors. */
export function pressDecision(input: {
  label: string;
  tag: string;
  href?: string | null;
  opensNewTab?: boolean;
  download?: boolean;
  sameOrigin?: boolean;
  submitsForm?: boolean;
  blockWrites?: boolean;
}): { press: true } | { press: false; why: string } {
  const label = String(input.label ?? '').replace(/\s+/g, ' ').trim();
  if (input.tag === 'a') {
    const href = String(input.href ?? '');
    if (input.opensNewTab || input.download) return { press: false, why: 'opens outside the app' };
    if (/^(mailto|tel|sms|javascript):/i.test(href)) return { press: false, why: 'leaves the app' };
    if (input.sameOrigin === false) return { press: false, why: 'goes to another website' };
  }
  if (input.submitsForm) return { press: false, why: 'submits a form (the form check covers it)' };
  if (!label) return { press: false, why: 'has no readable name' };
  if (NEVER_PRESS.test(label)) return { press: false, why: 'could change, send or delete something' };
  if (input.blockWrites && WRITE_VERBS.test(label)) return { press: false, why: 'would write to your own database' };
  return { press: true };
}

export type PressVerdict = 'ok' | 'crashed' | 'blank' | 'broken-link' | 'error' | 'unresponsive' | 'skipped';

/** How a control was tried: pressed, typed into (a search box) or picked from (a sort/filter menu). */
export type PressKind = 'press' | 'type' | 'pick';

export interface PressResult {
  /** The control's visible name, as a person would read it. */
  label: string;
  tag: string;
  verdict: PressVerdict;
  /** A plain-language sentence about what happened. */
  note: string;
  /** Up to three error messages that appeared AFTER this press — never the page's own load errors. */
  errors: string[];
  /** Whether anything on the page visibly changed — recorded, never judged (a Copy button changes nothing). */
  changed: boolean;
  /** How it was tried. Absent means pressed — every record written before 2026-09-30. */
  kind?: PressKind;
  /**
   * The first-screen control pressed to REACH this one, when it is a second-level control. Absent on
   * a first-screen press. It is a name a person can follow ("open Settings, then press Save").
   */
  via?: string;
}

/** How a press is named to a person: the control, and the screen it was found on when that is not the first. */
export function pressName(p: Pick<PressResult, 'label' | 'via'>): string {
  return p.via ? `"${p.label}" (on the "${p.via}" screen)` : `"${p.label}"`;
}

export interface ExploreSummaryLine {
  /** Whether the app loaded at all. False means the check never reached it. */
  loaded: boolean;
  /** Why it did not load, when it did not. */
  note: string;
  /** How many clickable controls were on the page, and how many were chosen to press. */
  found: number;
  chosen: number;
  /** Up to eight controls that were deliberately not pressed, with the reason. */
  skipped: Array<{ label: string; why: string }>;
}

export interface ExploreRun {
  summary: ExploreSummaryLine | null;
  presses: PressResult[];
  /** True when the runner stopped starting new presses because its own clock ran out. */
  outOfTime: boolean;
  /** The runner's own last words, when it produced nothing useful. */
  diagnostic: string | null;
}

const VERDICTS: ReadonlySet<string> = new Set(['ok', 'crashed', 'blank', 'broken-link', 'error', 'unresponsive', 'skipped']);

/** Parse the runner's output. Malformed lines are dropped, never guessed at. PURE; never throws. */
export function parseExploreOutput(stdout: string | null | undefined): ExploreRun {
  const run: ExploreRun = { summary: null, presses: [], outOfTime: false, diagnostic: parseScriptDiagnostic(stdout) };
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf(EXPLORE_RESULT_MARKER);
    if (at < 0) continue;
    let o: any;
    try { o = JSON.parse(line.slice(at + EXPLORE_RESULT_MARKER.length)); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'summary') {
      run.summary = {
        loaded: o.loaded === true,
        note: String(o.note ?? '').slice(0, 200),
        found: Number.isFinite(o.found) ? Number(o.found) : 0,
        chosen: Number.isFinite(o.chosen) ? Number(o.chosen) : 0,
        skipped: Array.isArray(o.skipped)
          ? o.skipped.slice(0, 8).map((s: any) => ({ label: String(s?.label ?? '').slice(0, 60), why: String(s?.why ?? '').slice(0, 80) }))
          : [],
      };
    } else if (o.type === 'press' && VERDICTS.has(o.verdict)) {
      run.presses.push({
        label: String(o.label ?? '').slice(0, 60),
        tag: String(o.tag ?? ''),
        verdict: o.verdict as PressVerdict,
        note: String(o.note ?? '').slice(0, 200),
        errors: Array.isArray(o.errors) ? o.errors.slice(0, 3).map((e: unknown) => String(e).slice(0, 200)) : [],
        changed: o.changed === true,
        ...(o.kind === 'type' || o.kind === 'pick' ? { kind: o.kind as PressKind } : {}),
        ...(typeof o.via === 'string' && o.via.trim() ? { via: o.via.slice(0, 60) } : {}),
      });
    } else if (o.type === 'out-of-time') {
      run.outOfTime = true;
    }
  }
  return run;
}

/**
 * The verdicts that mean the app is broken. ONE set, read by the summary here AND by the repair
 * (`explorerRepair.ts`), which used to keep its own copy — a new failure kind added to one would have
 * been reported and never repaired, or repaired and never reported.
 */
export const FAILING_VERDICTS: ReadonlySet<PressVerdict> = new Set<PressVerdict>(['crashed', 'blank', 'broken-link', 'error', 'unresponsive']);
const FAILING = FAILING_VERDICTS;

/** "Pressed 3 control(s)", "Tried 2 search or sort control(s)", or both. PURE. */
export function describeTries(presses: readonly PressResult[]): string {
  const pressed = presses.filter((p) => !p.kind || p.kind === 'press').length;
  const tried = presses.length - pressed;
  const parts = [
    pressed > 0 ? `pressed ${pressed} control(s)` : '',
    tried > 0 ? `tried ${tried} search or sort control(s)` : '',
  ].filter(Boolean).join(' and ');
  return parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : 'Tried nothing';
}

export type ExploreOutcome = 'passed' | 'failed' | 'nothing' | 'not-run';

export interface ExploreVerdict {
  outcome: ExploreOutcome;
  /** The admin report's code — one per outcome, so a check that could not look never borrows a pass. */
  code: 'EXPLORE_PASSED' | 'EXPLORE_FAILED' | 'EXPLORE_NOTHING_TO_PRESS' | 'EXPLORE_NOT_RUN';
  /** One line for the admin report. */
  message: string;
  /** One line per press, for the report's detail. */
  detail: string;
  pressed: number;
  failures: PressResult[];
  /** Every control actually tried (pressed, typed into or picked from), for the user's card. */
  attempts?: PressResult[];
}

/** Decide what the run proved. PURE; never throws. */
export function summarizeExplore(run: ExploreRun): ExploreVerdict {
  const presses = run.presses.filter((p) => p.verdict !== 'skipped');
  const failures = presses.filter((p) => FAILING.has(p.verdict));
  const detail = [
    ...run.presses.map((p) => `${p.verdict.toUpperCase()} ${pressName(p)} — ${p.note}${p.errors.length ? ` [${p.errors[0]}]` : ''}${p.verdict === 'ok' && !p.changed ? ' (nothing visibly changed)' : ''}`),
    ...(run.summary?.skipped ?? []).map((s) => `NOT PRESSED "${s.label}" — ${s.why}`),
    ...(run.outOfTime ? ['Stopped starting new presses: the check reached its own time limit.'] : []),
  ].join('\n');

  if (!run.summary || !run.summary.loaded) {
    const why = run.summary?.note || 'the browser produced no result';
    return {
      outcome: 'not-run', code: 'EXPLORE_NOT_RUN', pressed: 0, failures: [], detail,
      message: `The buttons of the app were not pressed — ${why}.${browserScriptFailureNote(run.diagnostic)}`,
    };
  }
  if (presses.length === 0) {
    return {
      outcome: 'nothing', code: 'EXPLORE_NOTHING_TO_PRESS', pressed: 0, failures: [], detail,
      message: run.summary.chosen > 0
        ? 'Controls were found but none could be pressed on a fresh load, so nothing was proven about them.'
        : `No control on the home screen was safe to press (${run.summary.found} found, all deliberately skipped).`,
    };
  }
  if (failures.length > 0) {
    const names = failures.slice(0, 3).map(pressName).join(', ');
    return {
      outcome: 'failed', code: 'EXPLORE_FAILED', pressed: presses.length, failures, attempts: presses, detail,
      message: `${describeTries(presses)} in a real browser; ${failures.length} did not work: ${names}.`,
    };
  }
  return {
    outcome: 'passed', code: 'EXPLORE_PASSED', pressed: presses.length, failures: [], attempts: presses, detail,
    message: `${describeTries(presses)} in a real browser; every one responded without breaking the app.`,
  };
}

export interface UserProof {
  ok: boolean;
  headline: string;
  steps: string[];
}

function failureSentence(p: PressResult): string {
  const doing = p.kind === 'type' ? 'Typing into' : p.kind === 'pick' ? 'Changing' : 'Pressing';
  switch (p.verdict) {
    case 'crashed': return `${doing} ${pressName(p)} crashed the app into an error screen.`;
    case 'blank': return `${doing} ${pressName(p)} left the screen blank.`;
    case 'broken-link': return `${pressName(p)} leads to a page that does not exist.`;
    case 'unresponsive': return p.kind === 'pick'
      ? `Choosing a different option in ${pressName(p)} changed nothing on the screen.`
      : `Typing into ${pressName(p)} changed nothing on the screen — it does not search the list.`;
    default: return `${doing} ${pressName(p)} caused an error in the app.`;
  }
}

/** The pass sentences for the user's card, one per kind of control that was tried. PURE. */
function passSentences(attempts: readonly PressResult[], fallbackCount: number): string[] {
  const all = attempts.length ? attempts : [];
  const pressed = all.length ? all.filter((p) => !p.kind || p.kind === 'press').length : fallbackCount;
  const typed = all.filter((p) => p.kind === 'type').length;
  const picked = all.filter((p) => p.kind === 'pick').length;
  const out: string[] = [];
  if (pressed > 0) out.push(`Pressed ${pressed} button${pressed === 1 ? '' : 's'} and link${pressed === 1 ? '' : 's'} one by one — every one worked.`);
  if (typed > 0) out.push(`Typed into the search box — the list changed to match.`);
  if (picked > 0) out.push(`Changed the sort or filter menu — the list changed with it.`);
  return out;
}

/**
 * What the user sees in their build card. Branded, no codes, no tool names, no provider names.
 * Returns an empty headline when nothing was proven, so the card says nothing rather than an
 * encouraging sentence about work that did not happen. PURE.
 */
export function exploreUserSummary(verdict: ExploreVerdict): UserProof {
  if (verdict.outcome === 'passed') {
    return {
      ok: true,
      headline: 'NavBharatAI tested your app in a real browser',
      steps: passSentences(verdict.attempts ?? [], verdict.pressed),
    };
  }
  if (verdict.outcome === 'failed') {
    return {
      ok: false,
      headline: 'NavBharatAI tested your app and found a problem',
      steps: [
        ...verdict.failures.slice(0, 3).map(failureSentence),
        ...(verdict.pressed > verdict.failures.length
          ? [`The other ${verdict.pressed - verdict.failures.length} control(s) tried worked.`]
          : []),
      ],
    };
  }
  return { ok: false, headline: '', steps: [] };
}

/**
 * One card, several checks. The build card has one slot, so the journey's proof and this one are
 * merged rather than one replacing the other: every step is kept, the card is green only when every
 * proof that said something is green, and a problem's headline wins over a pass's. PURE.
 */
export function mergeUserProofs(...proofs: ReadonlyArray<UserProof | null | undefined>): UserProof {
  const spoken = proofs.filter((p): p is UserProof => !!p && !!p.headline && Array.isArray(p.steps) && p.steps.length > 0);
  if (spoken.length === 0) return { ok: false, headline: '', steps: [] };
  if (spoken.length === 1) return spoken[0];
  const ok = spoken.every((p) => p.ok);
  const firstProblem = spoken.find((p) => !p.ok);
  return {
    ok,
    headline: ok ? 'NavBharatAI tested your app in a real browser' : (firstProblem?.headline || 'NavBharatAI tested your app and found a problem'),
    steps: spoken.flatMap((p) => p.steps),
  };
}

/** Build the in-sandbox runner. PURE — returns a shell command string. */
export function clickExplorerScript(previewUrl: string, opts: { blockWrites: boolean; maxClicks?: number; budgetMs?: number; storageState?: string | null }): string {
  const base = String(previewUrl ?? '').trim();
  const cfg = {
    base,
    marker: EXPLORE_RESULT_MARKER,
    maxClicks: Math.max(1, Math.min(MAX_EXPLORE_CLICKS, opts.maxClicks ?? MAX_EXPLORE_CLICKS)),
    maxSecond: MAX_SECOND_LEVEL_CLICKS,
    perParent: MAX_SECOND_LEVEL_PER_PARENT,
    budgetMs: Math.max(10_000, opts.budgetMs ?? EXPLORE_BUDGET_MS),
    loadMs: EXPLORE_LOAD_TIMEOUT_MS,
    blockWrites: opts.blockWrites === true,
    // Behind the sign-in page when the app has one — see signInExplore.ts. Null opens it signed out.
    storageState: opts.storageState ?? null,
    neverSrc: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags,
    writeSrc: WRITE_VERBS.source, writeFlags: WRITE_VERBS.flags,
    noiseSrc: CONSOLE_NOISE.source, noiseFlags: CONSOLE_NOISE.flags,
    maxNarrow: MAX_NARROWING_PROBES,
    searchSrc: SEARCH_CONTROL.source, searchFlags: SEARCH_CONTROL.flags,
    sortSrc: SORT_CONTROL.source, sortFlags: SORT_CONTROL.flags,
  };
  return `cat > /tmp/nbai-explore.mjs <<'NBAI_EOF'
${clickExplorerModule(cfg)}
NBAI_EOF
${browserScriptRunLine({ toolsDir: EXPLORE_TOOLS_DIR, scriptPath: '/tmp/nbai-explore.mjs', marker: EXPLORE_RESULT_MARKER })}`;
}

/**
 * The ES module the runner executes. Split from the shell wrapper so a test can run it as-is in a real
 * browser. `importLine` defaults to the sandbox's pre-baked Playwright.
 */
export function clickExplorerModule(cfg: Record<string, unknown>, importLine: string = playwrightImport(EXPLORE_TOOLS_DIR)): string {
  return `${importLine}
const cfg = ${JSON.stringify(cfg)};
const say = (o) => console.log(cfg.marker + JSON.stringify(o));
const started = Date.now();
const noise = new RegExp(cfg.noiseSrc, cfg.noiseFlags);

// Runs INSIDE the page. It must mirror pressDecision() exactly — the same regexes are passed in.
function collect(a) {
  // A previous collect on this page left its marks; a stale mark would point a press at the wrong control.
  for (const old of Array.from(document.querySelectorAll('[data-nbai-x]'))) old.removeAttribute('data-nbai-x');
  const never = new RegExp(a.neverSrc, a.neverFlags);
  const writes = new RegExp(a.writeSrc, a.writeFlags);
  const nodes = Array.from(document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], [role=link], summary'));
  const seen = new Set();
  const chosen = [];
  const skipped = [];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest('vite-error-overlay, #nextjs-portal')) continue;
    // Our own "made by NavBharatAI" badge is not the app's control (its × hides it; nothing to test).
    if (el.closest('[data-nbai-signature]')) continue;
    const tag = el.tagName.toLowerCase();
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    const href = tag === 'a' ? (el.getAttribute('href') || '') : '';
    const key = tag + '|' + label + '|' + href;
    if (seen.has(key)) continue;
    seen.add(key);
    let why = '';
    if (tag === 'a') {
      if (el.target === '_blank' || el.hasAttribute('download')) why = 'opens outside the app';
      else if (/^(mailto|tel|sms|javascript):/i.test(href)) why = 'leaves the app';
      else { try { if (new URL(href, location.href).origin !== location.origin) why = 'goes to another website'; } catch { why = 'goes to another website'; } }
    }
    const inForm = !!el.closest('form');
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (!why && tag === 'button' && inForm && (type === 'submit' || type === '')) why = 'submits a form (the form check covers it)';
    if (!why && !label) why = 'has no readable name';
    if (!why && never.test(label)) why = 'could change, send or delete something';
    if (!why && a.blockWrites && writes.test(label)) why = 'would write to your own database';
    if (why) { if (skipped.length < 8) skipped.push({ label: label || '(unnamed)', why }); continue; }
    if (chosen.length < a.maxClicks) {
      el.setAttribute('data-nbai-x', String(chosen.length));
      chosen.push({ i: chosen.length, tag, label, key });
    }
  }
  return { found: nodes.length, chosen, skipped, keys: Array.from(seen) };
}

// The page's CONTENT, not its size: a calculator's 0 becoming 7 changes no length (autopsy 972acde5).
function measure() {
  const root = document.querySelector('#root, #app, #__next') || document.body;
  const text = (root && root.innerText || '').trim();
  const rich = !!(root && root.querySelector('img, svg, canvas, video, iframe, input, button, textarea, select'));
  const hash = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return x; };
  return { len: text.length, head: text.slice(0, 160), rich, sig: document.body ? hash(document.body.innerHTML) + ':' + hash(document.body.innerText || '') : '' };
}

// Runs INSIDE the page, so it must be self-contained (page.evaluate sends only this function's
// source). One function, three answers, chosen by a.mode:
//   'list'   — the text of the main list's items: the element with the most visible same-tag
//              children that carry text. Its items are what a search narrows and a sort reorders.
//   'text'   — the screen's words with every form control taken out, so a typed query or a chosen
//              option is never mistaken for the app responding to it.
//   'narrow' — the search boxes and sort/filter menus worth trying (see SEARCH_CONTROL), marked.
function narrowingPage(a) {
  const root = document.querySelector('#root, #app, #__next') || document.body;
  const listItems = () => {
    let best = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.closest('select, nav, header, footer, form, vite-error-overlay')) continue;
      const kids = Array.from(el.children);
      if (kids.length < 2) continue;
      const tag = kids[0].tagName;
      const same = kids.filter((k) => k.tagName === tag);
      if (same.length < kids.length * 0.8) continue;
      const vis = same.filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (k.innerText || '').trim().length > 0; });
      if (vis.length > best.length) best = vis;
    }
    return best;
  };
  const textOf = (node) => {
    if (!node) return '';
    const c = node.cloneNode(true);
    for (const x of Array.from(c.querySelectorAll('input, select, textarea, option, script, style'))) x.remove();
    return (c.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  if (a.mode === 'list') return listItems().map((k) => (k.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200));
  if (a.mode === 'text') return textOf(root);

  for (const old of Array.from(document.querySelectorAll('[data-nbai-n]'))) old.removeAttribute('data-nbai-n');
  const search = new RegExp(a.searchSrc, a.searchFlags);
  const sort = new RegExp(a.sortSrc, a.sortFlags);
  const rows = listItems();
  const out = [];
  for (const el of Array.from(document.querySelectorAll('input, select'))) {
    if (out.length >= a.maxNarrow) break;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (el.disabled || el.readOnly) continue;
    if (el.closest('form, dialog, [role=dialog], vite-error-overlay')) continue;
    // A control inside a row of the list is that row's own setting, not the list's filter.
    if (rows.some((row) => row.contains(el))) continue;
    const tag = el.tagName.toLowerCase();
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const labelText = textOf(byFor) || textOf(el.closest('label'));
    const name = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id, el.getAttribute('title'), labelText].filter(Boolean).join(' ');
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type !== 'search' && type !== 'text') continue;
      if (type !== 'search' && el.getAttribute('role') !== 'searchbox' && !search.test(name)) continue;
    } else {
      if (a.blockWrites) continue;
      const opts = Array.from(el.options).filter((o) => !o.disabled);
      if (opts.length < 2) continue;
      if (!sort.test(name) && !sort.test(opts.map((o) => o.text).join(' '))) continue;
    }
    const shown = (el.getAttribute('aria-label') || labelText || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 60)
      || (tag === 'input' ? 'the search box' : 'the sort menu');
    el.setAttribute('data-nbai-n', String(out.length));
    out.push({ i: out.length, tag, label: shown, key: tag + '|' + shown + '|' + out.length });
  }
  return out;
}

// The word to type — the same body as pickSearchWord() in clickExplorer.ts, held equal by a test.
function pickSearchWord(items) {
  const list = (items || []).map((t) => String(t || ''));
  const lower = list.map((t) => t.toLowerCase());
  const order = [Math.floor(list.length / 2), list.length - 1, 1, 0];
  for (const i of order) {
    const words = (list[i] || '').match(/[\\p{L}\\p{M}\\p{N}]{3,}/gu) || [];
    for (const w of words) {
      const n = lower.filter((t) => t.includes(w.toLowerCase())).length;
      if (n >= 1 && n < list.length) return w;
    }
  }
  return '';
}

async function freshPage(browser) {
  // Reduced motion (the one definition every lane uses — signInExplore.ts), plus the saved session.
  const page = await browser.newPage(Object.assign(${JSON.stringify(BROWSER_PAGE_OPTIONS)}, cfg.storageState ? { storageState: cfg.storageState } : {}));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('popup', (p) => p.close().catch(() => {}));
  return page;
}

async function load(page) {
  const resp = await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: cfg.loadMs });
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  return resp;
}

// Wide enough to find controls a first-level press revealed, which may sit beyond the first-screen cap.
const wide = Object.assign({}, cfg, { maxClicks: 40 });

// Press a control. An element that never stops moving (an app's own infinite animation that does not
// honour reduced motion) fails Playwright's stability wait however long it waits; for THAT failure
// alone the click is dispatched on the element itself — the same element, no coordinates, so nothing
// covering it can receive the press instead. Every other failure still means "could not be pressed".
async function press(page, i) {
  const loc = page.locator('[data-nbai-x="' + i + '"]').first();
  try {
    await loc.click({ timeout: 4000 });
  } catch (e) {
    if (!/not stable/i.test(String(e && e.message || e))) throw e;
    await loc.dispatchEvent('click');
  }
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Presses one control on a fresh load. A second-level control is reached by first pressing its
// parent, UNARMED: the parent's own behaviour was judged on its own press, so nothing it does here is
// attributed to the child. Returns the new controls this press revealed when asked to.
async function pressOne(browser, target, discoverAgainst) {
  const res = { type: 'press', label: target.label, tag: target.tag, verdict: 'skipped', note: '', errors: [], changed: false };
  if (target.via) res.via = target.via;
  const page = await freshPage(browser);
  let armed = false;
  let navStatus = 0;
  let revealed = [];
  page.on('pageerror', (e) => { if (armed && res.errors.length < 3) res.errors.push(String(e && e.message || e).slice(0, 200)); });
  page.on('console', (m) => { if (armed && m.type() === 'error') { const t = String(m.text()); if (!noise.test(t) && res.errors.length < 3) res.errors.push(t.slice(0, 200)); } });
  page.on('response', (r) => { try { if (armed && r.request().isNavigationRequest() && r.frame() === page.mainFrame()) navStatus = r.status(); } catch {} });
  try {
    await load(page);
    if (target.parentKey) {
      const first = await page.evaluate(collect, wide);
      const parent = first.chosen.find((c) => c.key === target.parentKey);
      if (!parent) { res.note = 'the screen it lives on could not be reopened'; await page.close().catch(() => {}); return { res, revealed }; }
      await press(page, parent.i);
      await settle(page);
    }
    const again = await page.evaluate(collect, target.parentKey ? wide : cfg);
    const hit = again.chosen.find((c) => c.key === target.key);
    if (!hit) { res.note = 'the control was not there on a fresh load'; await page.close().catch(() => {}); return { res, revealed }; }
    const before = await page.evaluate(measure);
    const beforeUrl = page.url();
    armed = true;
    await press(page, hit.i);
    await settle(page);
    const overlay = await page.locator('vite-error-overlay, #nextjs-portal, .react-error-overlay').count().catch(() => 0);
    const after = await page.evaluate(measure).catch(() => null);
    const moved = page.url() !== beforeUrl;
    res.changed = moved || !after || after.sig !== before.sig;
    const missingPage = moved && (navStatus >= 400 || (after && after.len < 300 && /^(cannot get|404\\b|page not found|not found)/i.test(after.head)));
    if (overlay > 0) { res.verdict = 'crashed'; res.note = 'the app crashed into an error overlay'; }
    else if (before.len > 0 && after && after.len === 0 && !after.rich) { res.verdict = 'blank'; res.note = 'the screen went blank'; }
    else if (missingPage) { res.verdict = 'broken-link'; res.note = 'it opened a page that does not exist'; }
    else if (res.errors.length > 0) { res.verdict = 'error'; res.note = 'the app threw an error when it was pressed'; }
    else { res.verdict = 'ok'; res.note = moved ? 'it opened another page, which loaded' : 'it responded'; }
    armed = false;
    // Only a press that WORKED and CHANGED the screen can open a new screen worth exploring; a broken
    // one has already been reported, and exploring past it would report its damage a second time.
    if (discoverAgainst && res.verdict === 'ok' && res.changed) {
      const next = await page.evaluate(collect, wide).catch(() => null);
      if (next) revealed = next.chosen.filter((c) => !discoverAgainst.has(c.key));
    }
  } catch (e) {
    // The press itself could not complete (covered, detached, timed out). That is our instrument,
    // not the app — reported as skipped, never as a failure.
    res.verdict = 'skipped';
    res.note = 'could not be pressed: ' + String(e && e.message || e).split('\\n')[0].slice(0, 120);
  }
  armed = false;
  await page.close().catch(() => {});
  return { res, revealed };
}

// Tries one search box or sort menu on a fresh load: type a word from the list, or choose another
// option, and see whether the screen's words change. Nothing typed is ever submitted.
async function narrowOne(browser, target) {
  const kind = target.tag === 'select' ? 'pick' : 'type';
  const res = { type: 'press', kind, label: target.label, tag: target.tag, verdict: 'skipped', note: '', errors: [], changed: false };
  const page = await freshPage(browser);
  let armed = false;
  page.on('pageerror', (e) => { if (armed && res.errors.length < 3) res.errors.push(String(e && e.message || e).slice(0, 200)); });
  page.on('console', (m) => { if (armed && m.type() === 'error') { const t = String(m.text()); if (!noise.test(t) && res.errors.length < 3) res.errors.push(t.slice(0, 200)); } });
  try {
    await load(page);
    const found = await page.evaluate(narrowingPage, Object.assign({}, cfg, { mode: 'narrow' }));
    const hit = found.find((c) => c.key === target.key);
    if (!hit) { res.note = 'the control was not there on a fresh load'; await page.close().catch(() => {}); return res; }
    const loc = page.locator('[data-nbai-n="' + hit.i + '"]').first();
    const items = await page.evaluate(narrowingPage, { mode: 'list' });
    const enough = kind === 'type' ? items.length >= 3 : new Set(items).size >= 2;
    if (!enough) { res.note = 'there was no list on the screen for it to change'; await page.close().catch(() => {}); return res; }
    const before = await page.evaluate(narrowingPage, { mode: 'text' });
    const beforeMeasure = await page.evaluate(measure);
    const waitChange = async (ms) => {
      const until = Date.now() + ms;
      for (;;) {
        const now = await page.evaluate(narrowingPage, { mode: 'text' }).catch(() => null);
        if (now !== before) return true;
        if (Date.now() >= until) return false;
        await page.waitForTimeout(250);
      }
    };
    let tried = '';
    let changed = false;
    if (kind === 'type') {
      tried = pickSearchWord(items);
      if (!tried) { res.note = 'every item on the list shares the same words, so no search could narrow it'; await page.close().catch(() => {}); return res; }
      armed = true;
      await loc.fill(tried, { timeout: 4000 });
      changed = await waitChange(2500);
      if (!changed) { await loc.press('Enter', { timeout: 2000 }).catch(() => {}); changed = await waitChange(1500); }
    } else {
      const choices = await loc.evaluate((s) => Array.from(s.options).filter((o) => !o.disabled && o.value !== s.value).map((o) => ({ v: o.value, t: (o.text || '').trim() })));
      if (!choices.length) { res.note = 'it has no other option to choose'; await page.close().catch(() => {}); return res; }
      armed = true;
      for (const c of choices.slice(0, 2)) {
        tried = c.t || c.v;
        await loc.selectOption(c.v, { timeout: 4000 });
        changed = await waitChange(2000);
        if (changed) break;
      }
    }
    await settle(page);
    const overlay = await page.locator('vite-error-overlay, #nextjs-portal, .react-error-overlay').count().catch(() => 0);
    const after = await page.evaluate(measure).catch(() => null);
    res.changed = changed;
    if (overlay > 0) { res.verdict = 'crashed'; res.note = 'the app crashed into an error overlay'; }
    else if (beforeMeasure.len > 0 && after && after.len === 0 && !after.rich) { res.verdict = 'blank'; res.note = 'the screen went blank'; }
    else if (res.errors.length > 0) { res.verdict = 'error'; res.note = 'the app threw an error when it was used'; }
    else if (changed) { res.verdict = 'ok'; res.note = (kind === 'type' ? 'typing "' : 'choosing "') + tried + '" changed what the screen shows'; }
    else {
      const buttonBeside = kind === 'type' && await loc.evaluate((el) => {
        const box = el.parentElement && (el.parentElement.parentElement || el.parentElement);
        return !!(box && box.querySelector('button, [role=button], input[type=submit], input[type=button]'));
      }).catch(() => true);
      if (buttonBeside) { res.verdict = 'skipped'; res.note = 'nothing changed while typing; it may search only when the button beside it is pressed'; }
      else { res.verdict = 'unresponsive'; res.note = (kind === 'type' ? 'typing "' : 'choosing "') + tried + '" changed nothing on the screen'; }
    }
  } catch (e) {
    res.verdict = 'skipped';
    res.note = 'could not be used: ' + String(e && e.message || e).split('\\n')[0].slice(0, 120);
  }
  armed = false;
  await page.close().catch(() => {});
  return res;
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  let plan;
  {
    const page = await freshPage(browser);
    try {
      const resp = await load(page);
      if (resp && resp.status() >= 400) { say({ type: 'summary', loaded: false, note: 'the app answered HTTP ' + resp.status(), found: 0, chosen: 0, skipped: [] }); plan = null; }
      else {
        plan = await page.evaluate(collect, cfg);
        plan.narrow = await page.evaluate(narrowingPage, Object.assign({}, cfg, { mode: 'narrow' })).catch(() => []);
      }
    } catch (e) {
      say({ type: 'summary', loaded: false, note: 'the app could not be opened: ' + String(e && e.message || e).slice(0, 120), found: 0, chosen: 0, skipped: [] });
      plan = null;
    }
    await page.close().catch(() => {});
  }
  if (plan) {
    say({ type: 'summary', loaded: true, note: '', found: plan.found, chosen: plan.chosen.length, skipped: plan.skipped });
    // Every control the first screen carries, pressed or not: a second-level control is one that was
    // NOT already there, so a header button present on every screen is never pressed twice.
    const firstScreen = new Set(plan.keys);
    const second = [];
    const queued = new Set();
    let outOfTime = false;
    for (const target of plan.chosen) {
      if (Date.now() - started > cfg.budgetMs - 8000) { outOfTime = true; break; }
      const { res, revealed } = await pressOne(browser, target, firstScreen);
      say(res);
      let taken = 0;
      for (const c of revealed) {
        if (taken >= cfg.perParent || queued.has(c.key)) continue;
        queued.add(c.key);
        second.push({ key: c.key, label: c.label, tag: c.tag, parentKey: target.key, via: target.label });
        taken++;
      }
    }
    // The search boxes and sort menus of the first screen, before any inner screen.
    for (const target of (plan.narrow || [])) {
      if (outOfTime || Date.now() - started > cfg.budgetMs - 8000) { outOfTime = true; break; }
      say(await narrowOne(browser, target));
    }
    for (const target of second.slice(0, cfg.maxSecond)) {
      if (outOfTime || Date.now() - started > cfg.budgetMs - 8000) { outOfTime = true; break; }
      const { res } = await pressOne(browser, target, null);
      say(res);
    }
    if (outOfTime) say({ type: 'out-of-time' });
  }
} finally {
  await browser.close().catch(() => {});
}
`;
}
