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

export type PressVerdict = 'ok' | 'crashed' | 'blank' | 'broken-link' | 'error' | 'skipped';

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

const VERDICTS: ReadonlySet<string> = new Set(['ok', 'crashed', 'blank', 'broken-link', 'error', 'skipped']);

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
        ...(typeof o.via === 'string' && o.via.trim() ? { via: o.via.slice(0, 60) } : {}),
      });
    } else if (o.type === 'out-of-time') {
      run.outOfTime = true;
    }
  }
  return run;
}

const FAILING: ReadonlySet<PressVerdict> = new Set(['crashed', 'blank', 'broken-link', 'error']);

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
      outcome: 'failed', code: 'EXPLORE_FAILED', pressed: presses.length, failures, detail,
      message: `Pressed ${presses.length} control(s) in a real browser; ${failures.length} broke the app: ${names}.`,
    };
  }
  return {
    outcome: 'passed', code: 'EXPLORE_PASSED', pressed: presses.length, failures: [], detail,
    message: `Pressed ${presses.length} control(s) in a real browser; every one responded without breaking the app.`,
  };
}

export interface UserProof {
  ok: boolean;
  headline: string;
  steps: string[];
}

function failureSentence(p: PressResult): string {
  switch (p.verdict) {
    case 'crashed': return `Pressing ${pressName(p)} crashed the app into an error screen.`;
    case 'blank': return `Pressing ${pressName(p)} left the screen blank.`;
    case 'broken-link': return `${pressName(p)} leads to a page that does not exist.`;
    default: return `Pressing ${pressName(p)} caused an error in the app.`;
  }
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
      steps: [`Pressed ${verdict.pressed} button${verdict.pressed === 1 ? '' : 's'} and link${verdict.pressed === 1 ? '' : 's'} one by one — every one worked.`],
    };
  }
  if (verdict.outcome === 'failed') {
    return {
      ok: false,
      headline: 'NavBharatAI tested your app and found a problem',
      steps: [
        ...verdict.failures.slice(0, 3).map(failureSentence),
        ...(verdict.pressed > verdict.failures.length
          ? [`The other ${verdict.pressed - verdict.failures.length} button(s) pressed worked.`]
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

async function freshPage(browser) {
  const page = await browser.newPage(cfg.storageState ? { storageState: cfg.storageState } : {});
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
      await page.locator('[data-nbai-x="' + parent.i + '"]').first().click({ timeout: 4000 });
      await settle(page);
    }
    const again = await page.evaluate(collect, target.parentKey ? wide : cfg);
    const hit = again.chosen.find((c) => c.key === target.key);
    if (!hit) { res.note = 'the control was not there on a fresh load'; await page.close().catch(() => {}); return { res, revealed }; }
    const before = await page.evaluate(measure);
    const beforeUrl = page.url();
    armed = true;
    await page.locator('[data-nbai-x="' + hit.i + '"]').first().click({ timeout: 4000 });
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

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  let plan;
  {
    const page = await freshPage(browser);
    try {
      const resp = await load(page);
      if (resp && resp.status() >= 400) { say({ type: 'summary', loaded: false, note: 'the app answered HTTP ' + resp.status(), found: 0, chosen: 0, skipped: [] }); plan = null; }
      else plan = await page.evaluate(collect, cfg);
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
