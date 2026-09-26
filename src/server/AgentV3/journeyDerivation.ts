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

import { browserScriptRunLine, parseScriptDiagnostic, browserScriptFailureNote, playwrightImport } from './sandboxBrowserScript';
import { rendersDataList } from './DesignCoverage';

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

/**
 * The prefix one journey RESULT line carries. Named once because it is read in three places — the
 * in-sandbox script that prints it, the run line that greps for it, and the parser that reads it —
 * and three hand-written copies of one string is how the sibling of this module lost its browser path.
 * ⚠️ The trailing space is part of it.
 */
export const JOURNEY_RESULT_MARKER = 'NBAI_JOURNEY ';

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
/**
 * The one sentence for "there is genuinely nothing here to prove".
 *
 * A constant because TWO branches now reach it — no pages at all, and pages with no form — and this
 * file's own history is of the same explanation drifting into two slightly different claims.
 */
export const NO_DATA_ENTRY_REASON =
  'this app has no data-entry surface at all — a game, a dashboard or a landing page has '
  + 'nothing to save and reload, so there is no such journey to prove';

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
  // A select's fixed choices (`PAYMENT_METHODS.map((m) => <option>…`) are not a list anything can
  // "appear in" — the same false signal DesignCoverage had (autopsy ea07382a). ONE definition of
  // "renders a data list", read by both.
  return /\.map\s*\(\s*\(?\s*[A-Za-z_$][\w$]*/.test(source) && rendersDataList(source) && /<\/?[A-Za-z]/.test(source);
}

/**
 * Does submitting THIS form add anything to a list?
 *
 * 🔴 AUTOPSY b9287f85 (2026-09-25): a working e-commerce site was declared RED, *"Not shippable — a
 * real user journey failed"*. The journey had typed an email into the Home page's NEWSLETTER box,
 * pressed Subscribe, and then looked for that email among the FEATURED PRODUCTS. A form and a list in
 * the same file had been taken to be one feature. `rendersList` answers "is there a list here?", and
 * nothing asked "does this form put anything into it?" — and a store's home page has both, unrelated,
 * on every site on the internet: newsletter, contact, login, search.
 *
 * So the form's OWN submit handler is read, and it is the only evidence used:
 *
 *   - `yes`     — it builds a new array (`[...items, x]`, `prev => [`), or pushes / concats.
 *   - `no`      — its body was found, and it does nothing but harmless bookkeeping: preventDefault,
 *                 plain setters (`setSubscribed(true)`, `setEmail('')`), a toast, a timeout, a log.
 *   - `unknown` — no handler could be found, or it calls something we cannot see into (`addTask(t)`,
 *                 `onAdd(t)`, `dispatch(...)`, `fetch(...)`). Today's behaviour stands.
 *
 * 🔒 ONLY `no` CHANGES ANYTHING, and it only makes the journey SMALLER: a create-persists journey
 * becomes a form-submit journey, which still fills and submits the form and still fails on a crash.
 * An unreadable handler never loses the persistence check — the module's first rule is that a failing
 * test handed over beside a working app is worse than none, and this is that rule applied to which
 * test we write, not only to whether we write one. Pure.
 */
export type FormFeedsList = 'yes' | 'no' | 'unknown';

/** A body shape that builds or grows an array — the only positive proof a submit adds an item. */
const APPENDS_RE = /\[\s*\.\.\.|\.\.\.[\w$.]+\s*\]|\.(?:concat|push|unshift|splice)\s*\(|\bset[A-Z][\w$]*\s*\(\s*\(?\s*[\w$]*\s*\)?\s*=>\s*\[/;

/** Calls a handler may make without adding anything anywhere. Matched on the LAST name segment. */
const HARMLESS_CALLS = new Set([
  'preventDefault', 'stopPropagation', 'trim', 'toLowerCase', 'toUpperCase', 'includes', 'test', 'match',
  'replace', 'alert', 'confirm', 'setTimeout', 'clearTimeout', 'log', 'warn', 'error', 'info', 'debug',
  'String', 'Number', 'Boolean', 'focus', 'blur', 'reset', 'success', 'showToast', 'notify', 'toast',
]);
const NOT_A_CALL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await']);

/** The `{ … }` block that opens at `open` (which must be a `{`), braces balanced; null if unbalanced. */
function balancedBlock(src: string, open: number): string | null {
  if (src[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

/** The body of an arrow whose `=>` ends just before `at`: a block, or the expression up to the line end. */
function arrowBody(src: string, at: number): string | null {
  const rest = src.slice(at);
  const lead = rest.length - rest.trimStart().length;
  if (rest[lead] === '{') return balancedBlock(src, at + lead);
  const line = rest.split('\n')[0];
  return line.replace(/[;,]?\s*$/, '').trim() || null;
}

/** The body of a handler named in this file, or null when it is not defined here. */
function namedHandlerBody(src: string, name: string): string | null {
  const n = name.replace(/[$]/g, '\\$');
  const arrow = new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*(?::[^=]+)?=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]+)?=>`).exec(src);
  if (arrow) return arrowBody(src, arrow.index + arrow[0].length);
  const fn = new RegExp(`\\bfunction\\s+${n}\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{`).exec(src);
  if (fn) return balancedBlock(src, fn.index + fn[0].length - 1);
  return null;
}

/** Every handler body this form's submit can run — `onSubmit` on a form, else `onClick` on the submit button. */
function submitHandlerBodies(src: string, submit: Target | null): string[] | null {
  const attrs: Array<{ index: number; len: number }> = [];
  const onSubmit = /\bonSubmit\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = onSubmit.exec(src)) !== null) attrs.push({ index: m.index, len: m[0].length });
  if (attrs.length === 0 && submit?.kind === 'text') {
    const text = submit.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const btn = new RegExp(`<button\\b[^>]*?\\bonClick\\s*=\\s*\\{(?=[\\s\\S]{0,200}?>\\s*${text}\\s*<)`).exec(src);
    if (btn) attrs.push({ index: btn.index, len: btn[0].length });
  }
  if (attrs.length === 0) return null;
  const bodies: string[] = [];
  for (const a of attrs) {
    const open = a.index + a.len - 1;
    const expr = balancedBlock(src, open);
    if (expr === null) return null;
    const trimmed = expr.trim();
    const bare = /^[A-Za-z_$][\w$]*$/.exec(trimmed);
    if (bare) {
      const body = namedHandlerBody(src, bare[0]);
      if (body === null) return null; // a prop, an import, a hook's function — we cannot see into it
      bodies.push(body);
      continue;
    }
    const inline = /^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(trimmed);
    if (inline) {
      const body = arrowBody(trimmed, inline[0].length);
      if (body === null) return null;
      // `(e) => handleSubscribe(e)` only forwards: judge the handler it forwards to, when it is here.
      const forwards = /^([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*;?$/.exec(body.trim());
      const target = forwards ? namedHandlerBody(src, forwards[1]) : null;
      bodies.push(target ?? body);
      continue;
    }
    return null;
  }
  return bodies;
}

export function formFeedsList(source: string, submit: Target | null): FormFeedsList {
  const bodies = submitHandlerBodies(String(source ?? ''), submit);
  if (!bodies) return 'unknown';
  let opaque = false;
  for (const body of bodies) {
    if (APPENDS_RE.test(body)) return 'yes';
    const calls = body.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/g) || [];
    for (const raw of calls) {
      const name = raw.replace(/\s*\($/, '');
      const last = name.split('.').pop() || '';
      if (NOT_A_CALL.has(name) || HARMLESS_CALLS.has(last) || /^set[A-Z]/.test(name) || /^toast\b/.test(name)) continue;
      opaque = true;
    }
  }
  return opaque ? 'unknown' : 'no';
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

/** How many local imports of one page we will look inside. A barrel file must not explode the search. */
export const MAX_IMPORTS_PER_PAGE = 12;

/**
 * Resolve a RELATIVE import specifier against the file map, the way a bundler would. Returns the
 * matching path or null. Local only: a bare specifier is a package and never resolvable here.
 */
export function resolveLocalImport(
  fromPath: string,
  spec: string,
  files: Record<string, string>,
): string | null {
  if (!spec || !fromPath) return null;
  // `@/x` is the near-universal alias for `src/x` in this repo's scaffolds; anything else bare is a package.
  let base: string;
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith('./') || spec.startsWith('../')) {
    const dir = fromPath.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') dir.pop();
      else dir.push(part);
    }
    base = dir.join('/');
  } else return null;
  for (const cand of [base, `${base}.tsx`, `${base}.jsx`, `${base}.ts`, `${base}.js`,
    `${base}/index.tsx`, `${base}/index.jsx`, `${base}/index.ts`, `${base}/index.js`]) {
    if (typeof files?.[cand] === 'string') return cand;
  }
  return null;
}

/**
 * 🔴 THE FORM IS USUALLY NOT IN THE PAGE (autopsy e4ebcb5f, 2026-09-17 — second occurrence; first
 * recorded as an open root cause in PR #2988).
 *
 * `deriveJourneys` and `noJourneyReason` both used to read ONLY `files[page]`. A React page that
 * composes its UI from components — which is how React is written — has no `<input>` of its own, so
 * both concluded the app takes no input at all.
 *
 * What that cost, in the report's own words: a CHAT app, whose `ChatInput.tsx` the agent had just
 * read, was described as *"this app has no form for a journey to fill in — nothing here takes user
 * input"* — **while `ACCESSIBILITY`, in the same report, found "4 form field(s) with no label".** Two
 * of our own scanners, the same files, opposite answers. The journey was never derived, so a check
 * that could have produced real evidence produced a false explanation instead.
 *
 * So a page's form sources are the page AND the local components it imports, ONE level deep. One
 * level, not a graph walk: it covers how a page actually composes a form, stays bounded, and keeps
 * the result predictable enough to explain in a report.
 *
 * 🔒 WHY THIS CANNOT MANUFACTURE A RED GATE, which mattered more than the fix itself — `journeys` is
 * in `releaseGate`'s `RED_ON_FAILURE`, so a wrongly-failed journey would flip the verdict and make
 * the build free. It cannot: the runner defaults every journey to `unreachable` and only treats a
 * failure as the APP's after a submit has actually gone through ("From here on, a failure IS the
 * app's failure"). A component that is not rendered on the route yields no fields, throws `no-fields`
 * and stays `unreachable` — evidence we did not get, never an accusation.
 *
 * Deterministic: the page first, then its imports in source order. Pure.
 */
export function formSourcesFor(
  page: string,
  files: Record<string, string>,
): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = [];
  const own = files?.[page];
  if (typeof own === 'string') out.push({ path: page, source: own });
  if (typeof own !== 'string') return out;
  const seen = new Set<string>([page]);
  // Matches `import X from './x'`, `import { X } from "../x"` and a bare `import './x'` alike.
  const specs = own.match(/\bfrom\s*["'][^"']+["']|\bimport\s*["'][^"']+["']/g) || [];
  for (const raw of specs) {
    if (out.length > MAX_IMPORTS_PER_PAGE) break;
    const spec = /["']([^"']+)["']/.exec(raw)?.[1];
    if (!spec) continue;
    const resolved = resolveLocalImport(page, spec, files);
    if (!resolved || seen.has(resolved) || !/\.(t|j)sx$/.test(resolved)) continue;
    seen.add(resolved);
    out.push({ path: resolved, source: files[resolved] || '' });
  }
  return out;
}

/** The route a page file serves, best-effort, or null. Only used for a label and a starting URL. */
function routeForFile(path: string, knownRoutes: readonly string[]): string {
  const stem = path.replace(/\.(t|j)sx$/, '').split('/').pop() || '';
  const lower = stem.toLowerCase();
  if (/^(home|index|page|app)$/.test(lower)) return '/';
  // `ChatPage` serves `/chat`: the suffix names what the FILE is, not the URL. Without dropping it, no
  // real route contains "chatpage" and the journey fell back to home, where its form is not (SignBridge).
  const key = lower.replace(/[^a-z]/g, '').replace(/(page|screen|view|route)$/, '') || lower.replace(/[^a-z]/g, '');
  const flat = (r: string) => r.toLowerCase().replace(/[^a-z]/g, '');
  const match = knownRoutes.find((r) => flat(r) === key) ?? knownRoutes.find((r) => flat(r).includes(key));
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
  // One form, one journey. `App.tsx` imports `Home.tsx` (formSourcesFor looks one level deep), so the
  // same newsletter box was derived twice and failed twice — autopsy b9287f85 reported "2 user
  // journey(s) failed" about ONE form. The form's own file is the identity, not the page that reached it.
  const usedForms = new Set<string>();

  for (const path of candidates) {
    if (out.length >= MAX_JOURNEYS) break;
    // The page itself, then the local components it composes its UI from — see formSourcesFor. The
    // ROUTE always stays the PAGE's: a component does not have one, and naming the component's own
    // filename would send the journey to the wrong URL.
    let source = '';
    let fields: JourneyField[] = [];
    let submit: Target | null = null;
    let formPath = '';
    for (const candidate of formSourcesFor(path, files)) {
      if (usedForms.has(candidate.path)) continue;
      const tags = inputTags(candidate.source).filter((t) => !skippableInput(t));
      if (tags.length === 0) continue;

      const got: JourneyField[] = [];
      let addressable = true;
      for (const tag of tags.slice(0, 6)) {
        const target = targetForInput(tag);
        if (!target) { addressable = false; break; }
        const value = valueForInput(tag, marker);
        if (value) got.push({ target, value });
      }
      // One unaddressable field means this form cannot be filled honestly — try the next source.
      if (!addressable || got.length === 0) continue;

      const btn = submitTargetIn(candidate.source);
      if (!btn) continue;
      source = candidate.source;
      formPath = candidate.path;
      fields = got;
      submit = btn;
      break;
    }
    if (!submit || fields.length === 0) continue;
    usedForms.add(formPath);

    const route = routeForFile(path, routes);
    const listed = rendersList(source);
    // The marker has to actually be typed somewhere, or "did it appear" is unanswerable.
    const markerTyped = fields.some((f) => f.value.includes(marker));

    // A list on the page is not enough: the form must be one that ADDS to a list (see formFeedsList).
    // Only a handler we could read, and that plainly adds nothing, downgrades the journey.
    const feeds = formFeedsList(source, submit) !== 'no';

    if (listed && markerTyped && feeds && !noWrites) {
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
      return NO_DATA_ENTRY_REASON;
    }
    return 'no page components were found to derive a user journey from';
  }
  // THE SAME SOURCES THE DERIVATION READS, for the same reason the candidate list is shared: a page
  // composes its form from components, and asking a narrower question here is how this sentence came
  // to tell a chat app it takes no user input (see formSourcesFor).
  const anyForm = pages.some((p) => formSourcesFor(p, files).some((s) => inputTags(s.source).length > 0));
  if (!anyForm) {
    // 🔴 A REACT GAME HAS A PAGE, SO IT NEVER REACHED THE SENTENCE WRITTEN FOR IT (autopsy f97eb0ec,
    // 2026-09-20 — the THIRD time this line has told an app it takes no input when it does).
    //
    // The branch above is gated on `pages.length === 0`, and its own comment describes "a React game
    // whose whole UI lives in src/App.tsx". But such a game HAS a page, so `journeyCandidates` finds
    // one, this function walks straight past that branch, and the falling-block game the admin built
    // was told: *"nothing here takes user input"* — with a canvas, touch handlers, arrow keys AND
    // on-screen ←/→ buttons. The release gate then repeated it as "no data-entry flow to exercise".
    //
    // 🔒 THE SAME PAIR OF QUESTIONS, ASKED IN BOTH PLACES — not a new rule, and precise for the same
    // reason it is precise above: `appHasNoDataEntry` scans EVERY file for inputs, UI-library form
    // components, change/submit handlers and contentEditable, so an app whose form merely sits deeper
    // than `formSourcesFor` looks (the real defect this sentence is for) still gets the form wording.
    // Only an app with a render surface and no data entry anywhere reads as a game.
    if (hasRenderSurface(files ?? {}) && appHasNoDataEntry(files ?? {})) return NO_DATA_ENTRY_REASON;
    return 'this app has no form for a journey to fill in — nothing here takes user input';
  }
  // ⚠️ THE REMEDY, NOT ONLY THE SYMPTOM (autopsy a48d0f9e, 2026-09-19). This sentence used to stop at
  // "no journey was derived", which reads like an environmental limit of the CHECK. It is not: it is a
  // fixable defect in the generated app, and in that report the SAME build's accessibility pass had
  // already counted the very same fields — "34 form field(s) with no label" across three named files.
  // One cause, reported as two unrelated lines, and the release gate then said "whether it actually
  // SAVES anything is untested" as though nothing could be done about it. Naming the fix costs nothing
  // and is what turns this line into something a build can act on.
  return 'the forms in this app have no field this check could address honestly (no name, id, placeholder, '
    + 'label or test id), so no journey was derived rather than one that would fail for the wrong reason. '
    + 'Give each field a `name` and a label and this check can prove the app really saves what is typed — '
    + 'the same fix a screen reader needs.';
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
${playwrightImport(TOOLS_DIR)}
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
  console.log('${JOURNEY_RESULT_MARKER}' + JSON.stringify(out));
}
await browser.close();
NBAI_EOF
${browserScriptRunLine({ toolsDir: TOOLS_DIR, scriptPath: '/tmp/nbai-journey.mjs', marker: JOURNEY_RESULT_MARKER })}`;
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
    const at = line.indexOf(JOURNEY_RESULT_MARKER);
    if (at < 0) continue;
    try {
      const o = JSON.parse(line.slice(at + JOURNEY_RESULT_MARKER.length)) as JourneyResult;
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
export function summarizeJourneys(
  results: readonly JourneyResult[],
  /** How many journeys we actually ASKED the browser to run. */
  attempted = results.length,
  /** The runner's raw output, so a run that produced nothing can say why. */
  stdout?: string | null,
): { ok: boolean; ran: boolean; summary: string } {
  const failed = results.filter((r) => r.verdict === 'failed');
  const passed = results.filter((r) => r.verdict === 'passed');
  const unreachable = results.filter((r) => r.verdict === 'unreachable');
  // 🔴 `ran` EXISTS BECAUSE `ok` ALONE MADE A CHECK THAT NEVER RAN LOOK LIKE A PASS (2026-09-17).
  // This returned `{ ok: true }` for an empty result set, and the caller maps ok → JOURNEY_PASSED at
  // severity info with autoResolved: true. So for as long as the runner was launching no browser at
  // all — see the module header — every build recorded a PASSING journey code whose own message read
  // "No user journey was run." The message was honest and the CODE was not, and the code is what a
  // reader scanning a report actually sees. Three outcomes, never two: ran-and-passed, ran-and-failed,
  // and did-not-run, which is neither.
  if (results.length === 0) {
    return attempted > 0
      ? {
        ok: false,
        ran: false,
        summary: `The user-journey check could not be completed for ${attempted} journey${attempted === 1 ? '' : 's'}`
          + ' — the runner produced no result, so nothing about them was verified.'
          + browserScriptFailureNote(parseScriptDiagnostic(stdout)),
      }
      : { ok: true, ran: false, summary: 'No user journey was run.' };
  }

  if (failed.length > 0) {
    const lost = failed.filter((f) => f.kind === 'create-persists' && /vanished/.test(f.note));
    const lead = lost.length > 0
      // This is the finding. It deserves the first sentence, not a bullet three lines down.
      ? `Your app looks like it saves data but does not: ${lost.map((f) => f.route).join(', ')} accepted an entry, showed it, and lost it on reload.`
      : `${failed.length} user journey(s) failed.`;
    return {
      ok: false,
      ran: true,
      summary: `${lead} ${failed.map((f) => `${f.route}: ${f.note}`).join('; ')}`
        + (passed.length ? ` (${passed.length} other journey(s) passed.)` : ''),
    };
  }
  // Every journey UNREACHABLE is not a pass: nothing was filled in, so nothing was proven. It used to fall
  // through to here and be coded JOURNEY_PASSED with the sentence "0 user journey(s) passed" (SignBridge,
  // 2026-09-26) — the exact two-state-for-three-states defect the empty case above already fixed.
  if (passed.length === 0) {
    return {
      ok: true,
      ran: false,
      summary: `No user journey could be completed: ${unreachable.length} could not be reached and were NOT counted either way (${unreachable.map((u) => u.note).join('; ')}).`,
    };
  }
  const parts = [`${passed.length} user journey(s) passed — filled in a real form in a real browser and checked the result.`];
  if (unreachable.length > 0) {
    parts.push(`${unreachable.length} could not be reached and were NOT counted either way (${unreachable.map((u) => u.note).join('; ')}).`);
  }
  return { ok: true, ran: true, summary: parts.join(' ') };
}
