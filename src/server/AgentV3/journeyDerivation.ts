// AgentV3 — DOES THE APP ACTUALLY WORK, or does it only render? (Mission 10/10, Phase 4 · §7)
//
// THE GAP. Everything we run after a build asks a version of "did it paint": the preview verifier loads
// home, PageRouteCheck opens each route and checks it renders, the console capture watches for errors,
// RouteSmokeCheck curls the API. All of it is necessary and none of it presses a single button.
//
// So the most common invisible failure in a generated app survives every check we own: the UI PRETENDS.
// You type a task, hit Add, the item appears — because it was pushed into a local useState array. You
// reload, and it is gone. The app rendered perfectly, threw no errors, returned 200 everywhere, and does
// not work. A user finds that in about ninety seconds, and we told them it was ready.
//
// THE ONE ASSERTION THAT CATCHES IT is create → reload → is it still there. Nothing else separates real
// persistence from a convincing illusion, and no amount of rendering evidence implies it.
//
// EVERY SELECTOR IS READ OUT OF THE APP'S OWN SOURCE. Nothing here guesses a selector, invents a
// data-testid we hope exists, or assumes a convention. A field we cannot address honestly means the
// journey is not derived at all — because a failing test handed to someone alongside a working app is
// worse than no test: it teaches them our reports are noise, and the next one, the one that is real,
// goes unread.
//
// A FAILURE TO REACH A STEP IS NOT A FAILURE OF THE APP. A journey that dies before its first action
// (a login wall, a route that needs a seeded id) is reported UNREACHABLE, never FAILED. Conflating the
// two would manufacture alarms about working apps, which is the same mistake in a different coat.
//
// PURE. The runner script is a STRING built here and executed by the caller in the sandbox's pre-baked
// browser — no I/O, no clock, no model call in this module.

/** How a single element is addressed, in the order Playwright should be asked for it. */
export type SelectorKind = 'testid' | 'name' | 'id' | 'placeholder' | 'label' | 'text' | 'role';

export interface Target {
  kind: SelectorKind;
  value: string;
}

export interface JourneyField {
  target: Target;
  /** What to type. Derived from the input's own type/name so an email field gets an email. */
  value: string;
}

export type JourneyKind = 'create-persists' | 'form-submit' | 'nav-click';

export interface Journey {
  id: string;
  kind: JourneyKind;
  /** The route the journey starts on. */
  route: string;
  /** A sentence a human can read in a report. */
  title: string;
  fields: JourneyField[];
  submit: Target | null;
  /**
   * True when this journey WRITES data. The caller must not run one of these against an app wired to
   * the user's own database — creating a junk row in somebody's real Supabase project is a side effect
   * nobody asked for, and "it was only a test item" is not a defence.
   */
  writes: boolean;
}

/** How many journeys to derive. A journey is a browser session; twenty of them is a build delay. */
export const MAX_JOURNEYS = 3;
/** Per-journey wall clock inside the browser. */
export const JOURNEY_TIMEOUT_MS = 20_000;
/** Where the pre-baked Playwright lives inside the sandbox image (same path PageRouteCheck uses). */
export const TOOLS_DIR = '/home/user/.e-tools';

// ---------------------------------------------------------------------------------------------
// READING THE APP'S OWN MARKUP
// ---------------------------------------------------------------------------------------------

const ATTR = (tag: string, attr: string): string | null => {
  const m = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? m[1] : null;
};

/** Every `<input …>` / `<textarea …>` / `<select …>` opening tag in a file. */
function inputTags(source: string): string[] {
  return source.match(/<(?:input|textarea|select)\b[^>]*>/gi) || [];
}

/**
 * True when the app has NO data-entry surface ANYWHERE — no input/textarea/select/form element, no
 * common form component, and no change/submit handler in any source file.
 *
 * Such an app — a game, a dashboard, a landing page, an animation, a calculator with no form — has no
 * "save" journey to prove, so the release gate must not imply one is missing (BENCHMARK #1 & #2, a game
 * reported YELLOW with "whether it actually SAVES anything is untested" — a category error for something
 * that saves nothing). CONSERVATIVE BY DESIGN: any sign of data entry returns false, so a real data app
 * is never mislabelled "stateless" — the worst a false positive could do is soften a YELLOW headline, and
 * it can NEVER promote anything to GREEN (rendering alone still cannot earn green). Pure.
 */
export function appHasNoDataEntry(files: Record<string, string>): boolean {
  for (const src of Object.values(files ?? {})) {
    if (!src) continue;
    if (/<(?:input|textarea|select|form)\b/i.test(src)) return false;           // real HTML form elements
    if (/<(?:Input|Textarea|TextField|Select|Form|Autocomplete|Checkbox|Radio|Switch|Slider)\b/.test(src)) return false; // UI-library form components
    if (/\bon(?:Submit|Change|Input)\s*=/.test(src)) return false;              // a change/submit handler
    if (/\bcontentEditable\b/i.test(src)) return false;                         // an editable surface
  }
  return true;
}

/**
 * How to address this input, or null when it carries nothing we can honestly select it by.
 *
 * The order is deliberate: a `data-testid` is a promise the author made to tests, a `name` is what the
 * form itself submits, and a placeholder is the last resort because it is user-visible text that
 * translation or a copy edit will change.
 */
export function targetForInput(tag: string): Target | null {
  const testid = ATTR(tag, 'data-testid') || ATTR(tag, 'data-test-id');
  if (testid) return { kind: 'testid', value: testid };
  const name = ATTR(tag, 'name');
  if (name && !name.includes('{')) return { kind: 'name', value: name };
  const id = ATTR(tag, 'id');
  if (id && !id.includes('{')) return { kind: 'id', value: id };
  const placeholder = ATTR(tag, 'placeholder');
  if (placeholder && !placeholder.includes('{')) return { kind: 'placeholder', value: placeholder };
  const aria = ATTR(tag, 'aria-label');
  if (aria && !aria.includes('{')) return { kind: 'label', value: aria };
  return null;
}

/** A value appropriate to the field, so an email input is not filled with the word "test". */
export function valueForInput(tag: string, marker: string): string {
  const type = (ATTR(tag, 'type') || '').toLowerCase();
  const hint = `${ATTR(tag, 'name') || ''} ${ATTR(tag, 'placeholder') || ''} ${ATTR(tag, 'id') || ''}`.toLowerCase();
  if (type === 'email' || /e-?mail/.test(hint)) return `${marker}@example.com`;
  if (type === 'password' || /password|passwd/.test(hint)) return 'Test-Passw0rd!';
  if (type === 'number' || /amount|price|qty|quantity|count|age/.test(hint)) return '7';
  if (type === 'tel' || /phone|mobile|contact/.test(hint)) return '9876543210';
  if (type === 'url' || /url|website|link/.test(hint)) return 'https://example.com';
  if (type === 'date') return '2030-01-01';
  if (type === 'checkbox' || type === 'radio') return '';
  return marker;
}

/** Inputs that must not be typed into — a file picker, a hidden field, a submit button. */
function skippableInput(tag: string): boolean {
  const type = (ATTR(tag, 'type') || '').toLowerCase();
  return ['hidden', 'file', 'submit', 'reset', 'button', 'image', 'checkbox', 'radio'].includes(type);
}

const CREATE_WORDS = /\b(add|create|new|save|submit|post|send|register|sign\s*up|signup)\b/i;

/**
 * The button that submits this form.
 *
 * `type="submit"` is the honest answer when it exists. Otherwise the button's own visible text has to
 * carry it, and only when that text says something unambiguous — a page whose only button says "Menu"
 * yields no journey rather than a journey that clicks the wrong thing.
 */
export function submitTargetIn(source: string): Target | null {
  const buttons = source.match(/<button\b[^>]*>([\s\S]{0,80}?)<\/button>/gi) || [];
  for (const b of buttons) {
    const testid = ATTR(b, 'data-testid');
    if (testid && (/(submit|save|add|create)/i.test(testid) || /type\s*=\s*["']submit["']/i.test(b))) {
      return { kind: 'testid', value: testid };
    }
  }
  for (const b of buttons) {
    if (/type\s*=\s*["']submit["']/i.test(b)) {
      const text = b.replace(/<[^>]*>/g, '').trim();
      if (text && !text.includes('{')) return { kind: 'text', value: text };
      return { kind: 'role', value: 'submit' };
    }
  }
  for (const b of buttons) {
    const text = b.replace(/<[^>]*>/g, '').trim();
    if (text && !text.includes('{') && CREATE_WORDS.test(text)) return { kind: 'text', value: text };
  }
  // `<input type="submit" value="Add">` — older markup, still real.
  const inputSubmit = (source.match(/<input\b[^>]*type\s*=\s*["']submit["'][^>]*>/gi) || [])[0];
  if (inputSubmit) {
    const v = ATTR(inputSubmit, 'value');
    if (v && !v.includes('{')) return { kind: 'text', value: v };
  }
  return null;
}

/**
 * Does this file render a LIST from data — the other half of "create then check it is there"?
 *
 * `.map(` over an array into JSX is how every React list is written. Without one, "the item appeared"
 * has nothing to appear IN, and the journey would be asserting against a page that was never going to
 * show it.
 */
export function rendersList(source: string): boolean {
  return /\.map\s*\(\s*\(?\s*[A-Za-z_$][\w$]*/.test(source) && /<\/?[A-Za-z]/.test(source);
}

/**
 * Does this app talk to a database the USER owns?
 *
 * A create journey writes a real row. Against the app's own local state or a sandbox database that is
 * harmless; against the user's own Supabase or Firebase project it is us putting junk data into
 * somebody's real account without asking. So this is checked, and a write journey is refused when it
 * is true — the read-only journeys still run.
 */
export function writesToUserDatabase(files: Record<string, string>): boolean {
  const joined = Object.entries(files ?? {})
    .filter(([p]) => /\.(t|j)sx?$|\.env|\.json$/.test(p))
    .map(([, c]) => c)
    .join('\n');
  return /createClient\s*\(\s*[^)]*supabase|@supabase\/supabase-js|firebase\/firestore|getFirestore\s*\(|mongodb(\+srv)?:\/\/|DATABASE_URL/i
    .test(joined);
}

// ---------------------------------------------------------------------------------------------
// DERIVATION
// ---------------------------------------------------------------------------------------------

/**
 * The files a journey could come from — deterministic order, so the same project always yields the same
 * journeys, and shared with noJourneyReason so the explanation can never describe a different search.
 */
export function journeyCandidates(files: Record<string, string>): string[] {
  const out = Object.keys(files ?? {}).filter(isPageFile).sort();
  // A single-page app keeps everything in App.tsx, which is not under a pages directory.
  for (const extra of ['src/App.tsx', 'src/App.jsx', 'App.tsx']) {
    if (files?.[extra] && !out.includes(extra)) out.push(extra);
  }
  return out;
}

const isPageFile = (p: string): boolean =>
  /(^|\/)(pages|screens|views|routes|app)\//i.test(p) && /\.(t|j)sx$/.test(p);

/** The route a page file serves, best-effort, or null. Only used for a label and a starting URL. */
function routeForFile(path: string, knownRoutes: readonly string[]): string {
  const stem = path.replace(/\.(t|j)sx$/, '').split('/').pop() || '';
  const lower = stem.toLowerCase();
  if (/^(home|index|page|app)$/.test(lower)) return '/';
  const match = knownRoutes.find((r) => r.toLowerCase().replace(/[^a-z]/g, '').includes(lower.replace(/[^a-z]/g, '')));
  return match || '/';
}

export interface DeriveJourneysInput {
  files: Record<string, string>;
  /** Routes the app is known to serve (PageRouteCheck already extracts these). */
  routes?: readonly string[];
  /** A unique string this run will type, so an assertion cannot pass on pre-existing data. */
  marker: string;
}

/**
 * Derive the journeys this app's own code supports. Pure. Returns [] freely — most apps will yield one
 * journey or none, and none is a correct answer.
 */
export function deriveJourneys(input: DeriveJourneysInput): Journey[] {
  const files = input?.files ?? {};
  const routes = input?.routes ?? [];
  const marker = String(input?.marker || 'nbai-check');
  const out: Journey[] = [];
  const noWrites = writesToUserDatabase(files);

  const candidates = journeyCandidates(files);

  for (const path of candidates) {
    if (out.length >= MAX_JOURNEYS) break;
    const source = files[path] || '';
    const tags = inputTags(source).filter((t) => !skippableInput(t));
    if (tags.length === 0) continue;

    const fields: JourneyField[] = [];
    let addressable = true;
    for (const tag of tags.slice(0, 6)) {
      const target = targetForInput(tag);
      if (!target) { addressable = false; break; }
      const value = valueForInput(tag, marker);
      if (value) fields.push({ target, value });
    }
    // One unaddressable field means the form cannot be filled honestly, so no journey at all.
    if (!addressable || fields.length === 0) continue;

    const submit = submitTargetIn(source);
    if (!submit) continue;

    const route = routeForFile(path, routes);
    const listed = rendersList(source);
    // The marker has to actually be typed somewhere, or "did it appear" is unanswerable.
    const markerTyped = fields.some((f) => f.value.includes(marker));

    if (listed && markerTyped && !noWrites) {
      out.push({
        id: `create-persists:${path}`,
        kind: 'create-persists',
        route,
        title: `Create an item on ${route} and check it survives a reload`,
        fields, submit, writes: true,
      });
    } else {
      out.push({
        id: `form-submit:${path}`,
        kind: 'form-submit',
        route,
        title: `Fill and submit the form on ${route} without the app breaking`,
        fields, submit,
        // A submit still POSTs. Treated as a write unless it is plainly a search/filter form.
        writes: !/search|filter|query/i.test(path),
      });
    }
  }
  return out.slice(0, MAX_JOURNEYS);
}

/**
 * Does this project actually DRAW something — a canvas, a 3D renderer, a DOM mount?
 *
 * ⚠️ POSITIVE EVIDENCE, and it exists because I got this wrong twice in one sitting. "No data entry
 * found" is an ABSENCE, and an absence is true of a canvas game, of an empty file map, and of a
 * project we happen to be holding one utility file for. Concluding "this is a game, a dashboard or a
 * landing page" from an absence is the same mistake this whole module was built to stop — a report
 * confidently describing an app it has no evidence about. Two existing tests caught it.
 *
 * So the "nothing to prove here" answer now requires a reason to believe there IS a user interface,
 * and merely fails to find data entry in it. Deliberately broad in WHAT counts as drawing (a game, a
 * chart dashboard and a landing page reach the screen very differently) and strict in requiring that
 * something does.
 */
function hasRenderSurface(files: Record<string, string>): boolean {
  for (const src of Object.values(files ?? {})) {
    if (!src) continue;
    if (/<canvas\b|getContext\s*\(|\brenderer\.render\s*\(|\bnew\s+THREE\./i.test(src)) return true;
    if (/createRoot\s*\(|ReactDOM\.render\s*\(|\.mount\s*\(|createApp\s*\(/.test(src)) return true;
    if (/document\.(?:body|getElementById|querySelector)\b[^\n]{0,60}(?:innerHTML|appendChild)/.test(src)) return true;
  }
  return false;
}

/** Why a derivation produced nothing — so a quiet report is explained rather than merely quiet. */
export function noJourneyReason(files: Record<string, string>): string {
  // THE SAME CANDIDATE LIST THE DERIVATION USES. When these two disagree the report gives a reason that
  // is simply untrue: the first real build said "no page components were found to derive a user journey
  // from" about a React game whose whole UI lives in src/App.tsx — a file deriveJourneys looks at and
  // this function did not. One list, so the explanation always describes what actually happened.
  const pages = journeyCandidates(files ?? {});
  if (pages.length === 0) {
    // ⚠️ NO PAGE FOUND HAS TWO VERY DIFFERENT MEANINGS, AND ONLY ONE IS A FINDING ABOUT THE APP
    // (admin benchmark reports, 2026-08-24). A Three.js racing game has no App.tsx, no pages/
    // directory and no form — its whole UI is a canvas in src/game.ts. All of that is CORRECT for a
    // game, yet the single old sentence, "no page components were found to derive a user journey
    // from", reads as a deficiency. It appeared on all four of the admin's benchmark builds.
    //
    // `appHasNoDataEntry` already exists for exactly this distinction, and the release gate already
    // reads it ('none-derivable'). It simply was not consulted by the sentence a human reads. Asking
    // it here separates "there is nothing here to check" from "we could not find where to check",
    // which are not the same fact and only one of them is about the app's quality.
    //
    // REQUIRES POSITIVE EVIDENCE OF A UI — see hasRenderSurface. An absence of data entry is equally
    // true of a canvas game, an empty file map and a project we are holding one utility file for, and
    // only the first of those is "there is nothing here to prove".
    if (hasRenderSurface(files ?? {}) && appHasNoDataEntry(files ?? {})) {
      return 'this app has no data-entry surface at all — a game, a dashboard or a landing page has '
        + 'nothing to save and reload, so there is no such journey to prove';
    }
    return 'no page components were found to derive a user journey from';
  }
  const anyForm = pages.some((p) => inputTags(files[p] || '').length > 0);
  if (!anyForm) return 'this app has no form for a journey to fill in — nothing here takes user input';
  return 'the forms in this app have no field this check could address honestly (no name, id, placeholder, '
    + 'label or test id), so no journey was derived rather than one that would fail for the wrong reason';
}

// ---------------------------------------------------------------------------------------------
// THE RUNNER
// ---------------------------------------------------------------------------------------------

/** Playwright locator source for a target. Values are JSON-encoded at the call site. */
function locatorExpr(t: Target): string {
  switch (t.kind) {
    case 'testid': return `page.locator('[data-testid=' + JSON.stringify(${JSON.stringify(t.value)}) + ']')`;
    case 'name': return `page.locator('[name=' + JSON.stringify(${JSON.stringify(t.value)}) + ']')`;
    // An attribute selector, NOT '#' + CSS.escape: CSS.escape is a browser global and this script runs
    // in node, where referencing it throws before the journey starts.
    case 'id': return `page.locator('[id=' + JSON.stringify(${JSON.stringify(t.value)}) + ']')`;
    case 'placeholder': return `page.getByPlaceholder(${JSON.stringify(t.value)})`;
    case 'label': return `page.getByLabel(${JSON.stringify(t.value)})`;
    case 'text': return `page.getByRole('button', { name: ${JSON.stringify(t.value)} })`;
    case 'role': return `page.locator('button[type=submit], input[type=submit]')`;
    default: return `page.locator('body')`;
  }
}

/**
 * The sandbox script that drives the journeys in the pre-baked browser.
 *
 * Mirrors `pageCheckScript`: an ES module written to /tmp and run by node, importing Playwright by
 * ABSOLUTE path (NODE_PATH is a CJS-only mechanism and an ESM import ignores it entirely). No backticks
 * anywhere inside — this lives in a TypeScript template literal, where one would close the literal.
 * That mistake has been made here before; it is spelled out so it is not made again.
 */
export function journeyScript(previewUrl: string, journeys: readonly Journey[], marker: string): string {
  const base = previewUrl.replace(/\/+$/, '');
  const steps = journeys.map((j) => {
    const fills = j.fields.map((f) =>
      `    { locator: () => ${locatorExpr(f.target)}, value: ${JSON.stringify(f.value)} },`).join('\n');
    return `  {
    id: ${JSON.stringify(j.id)},
    kind: ${JSON.stringify(j.kind)},
    route: ${JSON.stringify(j.route)},
    fields: (page) => [
${fills}
    ],
    submit: (page) => ${j.submit ? locatorExpr(j.submit) : `page.locator('button[type=submit]')`},
  },`;
  }).join('\n');

  return `cat > /tmp/nbai-journey.mjs <<'NBAI_EOF'
import { chromium } from '${TOOLS_DIR}/node_modules/playwright/index.js';
const base = ${JSON.stringify(base)};
const marker = ${JSON.stringify(marker)};
const journeys = [
${steps}
];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const j of journeys) {
  // 'unreachable' is the DEFAULT, not a failure state. A journey that never got to press anything has
  // told us nothing about the app, and reporting that as a defect would be an invented alarm.
  const out = { id: j.id, kind: j.kind, route: j.route, verdict: 'unreachable', step: 'load', note: '', errors: [] };
  const page = await browser.newPage();
  page.on('pageerror', (e) => { if (out.errors.length < 3) out.errors.push(String(e.message).slice(0, 200)); });
  page.on('console', (m) => { if (m.type() === 'error' && out.errors.length < 3) out.errors.push(String(m.text()).slice(0, 200)); });
  try {
    await page.goto(base + j.route, { waitUntil: 'domcontentloaded', timeout: ${JOURNEY_TIMEOUT_MS} });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    out.step = 'fill';
    let filled = 0;
    for (const f of j.fields(page)) {
      const el = f.locator().first();
      if (await el.count() === 0) continue;
      await el.fill(f.value, { timeout: 4000 });
      filled++;
    }
    if (filled === 0) { out.note = 'none of the form fields were present on the running page'; throw new Error('no-fields'); }
    out.step = 'submit';
    const btn = j.submit(page).first();
    if (await btn.count() === 0) { out.note = 'the submit control was not present on the running page'; throw new Error('no-submit'); }
    await btn.click({ timeout: 5000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    // From here on, a failure IS the app's failure: we reached the app's own behaviour.
    out.step = 'after-submit';
    const crashed = await page.locator('vite-error-overlay, #nextjs-portal, .react-error-overlay').count();
    if (crashed > 0) { out.verdict = 'failed'; out.note = 'the app crashed into an error overlay after submitting'; }
    else if (j.kind === 'create-persists') {
      const appeared = await page.getByText(marker, { exact: false }).count();
      if (appeared === 0) {
        out.verdict = 'failed';
        out.note = 'the item was submitted but never appeared on the page';
      } else {
        out.step = 'reload';
        await page.reload({ waitUntil: 'domcontentloaded', timeout: ${JOURNEY_TIMEOUT_MS} });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
        const survived = await page.getByText(marker, { exact: false }).count();
        out.verdict = survived > 0 ? 'passed' : 'failed';
        out.note = survived > 0
          ? 'created an item and it was still there after a reload'
          : 'the item appeared, then vanished on reload — it was never actually saved anywhere';
      }
    } else {
      out.verdict = 'passed';
      out.note = 'the form submitted and the app kept working';
    }
  } catch (err) {
    if (out.verdict === 'unreachable' && !out.note) {
      out.note = 'could not reach this journey (' + String(err && err.message ? err.message : err).slice(0, 120) + ')';
    }
  }
  await page.close().catch(() => {});
  console.log('NBAI_JOURNEY ' + JSON.stringify(out));
}
await browser.close();
NBAI_EOF
node /tmp/nbai-journey.mjs 2>&1 | grep '^NBAI_JOURNEY ' || true`;
}

export type JourneyVerdict = 'passed' | 'failed' | 'unreachable';

export interface JourneyResult {
  id: string;
  kind: JourneyKind;
  route: string;
  verdict: JourneyVerdict;
  step: string;
  note: string;
  errors: string[];
}

/** Parse the runner's output. A malformed line is dropped, never guessed at. Pure; never throws. */
export function parseJourneyResults(stdout: string | null | undefined): JourneyResult[] {
  const out: JourneyResult[] = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('NBAI_JOURNEY ');
    if (at < 0) continue;
    try {
      const o = JSON.parse(line.slice(at + 'NBAI_JOURNEY '.length)) as JourneyResult;
      if (o && typeof o.id === 'string' && ['passed', 'failed', 'unreachable'].includes(o.verdict)) out.push(o);
    } catch { /* a truncated line is not a result */ }
  }
  return out;
}

/**
 * The honest sentence for the report.
 *
 * `ok` is false ONLY for a real failure. Unreachable journeys never make a build look broken — we
 * learned nothing, and saying nothing is the correct thing to do with nothing.
 */
export function summarizeJourneys(results: readonly JourneyResult[]): { ok: boolean; summary: string } {
  const failed = results.filter((r) => r.verdict === 'failed');
  const passed = results.filter((r) => r.verdict === 'passed');
  const unreachable = results.filter((r) => r.verdict === 'unreachable');
  if (results.length === 0) return { ok: true, summary: 'No user journey was run.' };

  if (failed.length > 0) {
    const lost = failed.filter((f) => f.kind === 'create-persists' && /vanished/.test(f.note));
    const lead = lost.length > 0
      // This is the finding. It deserves the first sentence, not a bullet three lines down.
      ? `Your app looks like it saves data but does not: ${lost.map((f) => f.route).join(', ')} accepted an entry, showed it, and lost it on reload.`
      : `${failed.length} user journey(s) failed.`;
    return {
      ok: false,
      summary: `${lead} ${failed.map((f) => `${f.route}: ${f.note}`).join('; ')}`
        + (passed.length ? ` (${passed.length} other journey(s) passed.)` : ''),
    };
  }
  const parts = [`${passed.length} user journey(s) passed — filled in a real form in a real browser and checked the result.`];
  if (unreachable.length > 0) {
    parts.push(`${unreachable.length} could not be reached and were NOT counted either way (${unreachable.map((u) => u.note).join('; ')}).`);
  }
  return { ok: true, summary: parts.join(' ') };
}
