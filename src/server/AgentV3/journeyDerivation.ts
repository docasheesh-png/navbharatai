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
import { newPageOptionsExpr, isSignInRoute } from './signInExplore';
import { declaredRoutes } from './routerPaths';
import { rendersDataList } from './DesignCoverage';
import { scanMarkup, enclosingTag, isHtmlElement, tagName, type ScannedTag } from './jsxTags';
import { NEVER_PRESS, WRITE_VERBS } from './clickExplorer';
import { withoutAppSignature } from './appSignature';

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
  /**
   * A form on a screen no URL reaches (a wizard step, a tab switched by state): the word the control
   * that shows it carries — `design` for `src/steps/DesignStep.tsx`. The runner presses a visible
   * control whose name contains it, and only such a control, before looking for the form, and presses
   * it again after a reload. Absent ⇒ the form is reached by its route, as before. (Autopsy 2b1f845e.)
   */
  reach?: string;
  /**
   * The form asks for a password: a sign-in or sign-up form. It is driven signed OUT (a session would
   * only redirect away from it), and it never becomes a create-persists journey — what is typed into it
   * is a login, not an item that should appear in a list (autopsy 70e030bb).
   */
  signIn?: boolean;
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

/**
 * Every `<input …>` / `<textarea …>` / `<select …>` opening tag in a file, read with the shared JSX reader.
 *
 * 🔴 THIS WAS `source.match(/<(?:input|textarea|select)\b[^>]*>/gi)` UNTIL 2026-09-26 (autopsy 7d79254b),
 * the fourth reader of the class `jsxTags.ts` exists to end. In JSX the first `>` of
 * `onChange={(e) => setEmail(e.target.value)}` belongs to the arrow, so the tag "ended" there and every
 * attribute written after the handler — `name`, `id`, `placeholder`, `aria-label` — was invisible. The
 * report said the app's forms "carry no name or label", and they did carry them: the ordinary React
 * input writes `value` and `onChange` first. Every such form was declared unaddressable and no journey
 * was ever derived. Components (`<Input>`) stay out: their props are not the DOM's attributes.
 */
function inputScans(source: string): ScannedTag[] {
  return scanMarkup(source).filter((t) => t.isElement && /^(?:input|textarea|select)$/.test(t.name));
}

function inputTags(source: string): string[] {
  return inputScans(source).map((t) => t.tag);
}

/**
 * The visible text of the `<label>` that wraps the control opening at `index`, or null.
 *
 * `<label>Title <input value={t} onChange={…} /></label>` is labelled by its text, and Playwright's
 * `getByLabel` finds it that way. Only a label whose own text is PLAIN is used — no `{expression}` and
 * no other markup — because the accessible name must be exactly what we type into the selector, and an
 * interpolated label is text we cannot know. PURE.
 */
export function wrappingLabelText(source: string, index: number): string | null {
  const open = source.lastIndexOf('<label', index);
  if (open < 0) return null;
  const close = source.indexOf('</label>', open);
  if (close < 0 || close < index) return null;
  const openEnd = scanMarkup(source.slice(open, close)).find((t) => t.name === 'label');
  if (!openEnd) return null;
  const inner = source.slice(open + openEnd.tag.length, close);
  const withoutControls = inputScans(inner).reduce((acc, t) => acc.replace(t.tag, ' '), inner);
  if (/[{}<>]/.test(withoutControls)) return null;
  const text = withoutControls.replace(/\s+/g, ' ').trim();
  return text.length >= 2 && text.length <= 60 ? text : null;
}

/**
 * The fields of a form, each with the tag and — when its own attributes cannot address it — the text of
 * the label wrapping it. A label is used only when no other label in the file shares its text, so
 * `getByLabel` can never match two controls.
 */
function formFields(source: string): Array<{ tag: string; labelText: string | null }> {
  const scans = inputScans(source).filter((t) => !skippableInput(t.tag));
  const texts = scans.map((t) => wrappingLabelText(source, t.index));
  return scans.map((t, i) => {
    const text = texts[i];
    const unique = text !== null && texts.filter((x) => x !== null && x.toLowerCase().includes(text.toLowerCase())).length === 1;
    return { tag: t.tag, labelText: unique ? text : null };
  });
}

/**
 * 🔴 A FORM THAT ASKS FOR A PASSWORD IS A SIGN-IN, NOT A WAY TO ADD AN ITEM (autopsy 70e030bb, 2026-10-04).
 * A notes app kept its login form and its notes list in one `App.tsx`; the journey typed a marker into
 * the username box, pressed Login, and looked for it among the notes — "the item was submitted but
 * never appeared on the page", RELEASE_GATE RED, on an app that worked. A password field is the one
 * fact that settles it. PURE.
 */
export function isCredentialForm(tags: ReadonlyArray<{ tag: string }>): boolean {
  return tags.some(({ tag }) => /\btype\s*=\s*\{?\s*["'\x60]password["'\x60]/i.test(tag)
    || /\b(?:name|id|autoComplete)\s*=\s*\{?\s*["'\x60](?:current-|new-)?password["'\x60]/i.test(tag));
}

/** Every `<button>` in a file with its inner text, read with the shared JSX reader (see `inputScans`). */
function buttonsIn(source: string): Array<{ tag: string; inner: string }> {
  const out: Array<{ tag: string; inner: string }> = [];
  for (const t of scanMarkup(source)) {
    if (!t.isElement || t.name !== 'button') continue;
    const start = t.index + t.tag.length;
    const end = source.indexOf('</button>', start);
    if (end < 0 || end - start > 200) continue;
    out.push({ tag: t.tag, inner: source.slice(start, end) });
  }
  return out;
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

/**
 * The files with OUR markup removed — what every "does the app do X?" question here reads (autopsy
 * 2b1f845e: the badge's checkbox was read as the app taking input). PURE.
 */
export function appOwnFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, src] of Object.entries(files ?? {})) {
    out[path] = /\.html?$/i.test(path) && typeof src === 'string' ? withoutAppSignature(src) : src;
  }
  return out;
}

export function appHasNoDataEntry(files: Record<string, string>): boolean {
  return dataEntryEvidence(files) === null;
}

const DATA_ENTRY_SIGNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<(?:input|textarea|select|form)\b/i, 'a form element'],                                                     // real HTML form elements
  [/<(?:Input|Textarea|TextField|Select|Form|Autocomplete|Checkbox|Radio|Switch|Slider)\b/, 'a form component'], // UI-library form components
  [/\bon(?:Submit|Change|Input)\s*=/, 'a change/submit handler'],                                               // a change/submit handler
  [/\bcontentEditable\b/i, 'an editable surface'],                                                             // an editable surface
];

/**
 * 🔴 A SPEED SLIDER IS NOT DATA THE USER WANTS SAVED (autopsy 8b8743a3, 2026-10-04). A 3D driving game
 * — a road, street lights, a start button and a score — was read as a data app because its one
 * `<input type="range">` speed control matched "a form element" (and its `onChange` matched "a
 * change/submit handler"). So the journey could not be derived from a form that does not exist, and the
 * release gate told the user *"whether it actually SAVES anything is untested"* about an app with
 * nothing to save.
 *
 * These `type` values cannot hold data a person would expect to find again after a reload: `range` is a
 * setting, and `button` / `submit` / `reset` / `image` are buttons, `hidden` is not user input at all.
 *
 * ⚠️ DELIBERATELY NARROW, BECAUSE THE ASYMMETRY RUNS THE OTHER WAY HERE. Reading a data app as having
 * no data entry skips the save-and-reload journey AND says there is nothing to prove — which can let a
 * real data app reach GREEN on presses alone. So only an `input` whose literal `type` is one of these
 * stands down: a text box, a checkbox, a `<select>`, a `<textarea>`, a UI-library `<Slider>` or
 * `<Switch>` (whose contract we cannot know) and `type={expr}` all still count exactly as before.
 */
const NON_DATA_INPUT_TYPE = /(?<![-\w])type\s*=\s*["']\s*(?:range|button|submit|reset|hidden|image)\s*["']/i;

/** Is the markup at `offset` inside an `<input>` that cannot hold saveable data? PURE. */
function insideNonDataControl(src: string, offset: number): boolean {
  const tag = enclosingTag(src, offset);
  if (!tag || !isHtmlElement(tag) || tagName(tag).toLowerCase() !== 'input') return false;
  return NON_DATA_INPUT_TYPE.test(tag);
}

/**
 * WHICH file made `appHasNoDataEntry` answer false, and why — or null when nothing did.
 *
 * 🔴 WHY (autopsy 8257ca59, 2026-10-01). A calculator built from our own template was reported as a data
 * app ("whether it actually SAVES anything is untested") although the template and every file the platform
 * wrote pass this check; the report could not say which file tipped it. The answer is now written beside
 * JOURNEY_NOT_DERIVED, so the next such report names its cause instead of leaving it to be guessed. PURE.
 */
export function dataEntryEvidence(files: Record<string, string>): { path: string; what: string; line: string } | null {
  const unused = unreferencedComponents(files);
  for (const [path, src] of Object.entries(appOwnFiles(files))) {
    if (!src || unused.has(path.replace(/^\.?\/+/, ''))) continue;
    for (const [re, what] of DATA_ENTRY_SIGNS) {
      // EVERY occurrence, not the first: one slider's `onChange` must not hide a real text box below it.
      const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (let m = all.exec(src); m; m = all.exec(src)) {
        if (insideNonDataControl(src, m.index + 1)) continue;
        const start = src.lastIndexOf('\n', m.index) + 1;
        const end = src.indexOf('\n', m.index);
        return { path, what, line: src.slice(start, end < 0 ? undefined : end).trim().slice(0, 140) };
      }
    }
  }
  return null;
}

/** A file the app starts from, or one a framework loads by its place (Next `app/`, `pages/`). */
const LOADED_BY_PLACE = /(?:^|\/)(?:main|index|App|_app|_document|layout|page)\.(?:tsx|jsx|ts|js)$|(?:^|\/)(?:app|pages|routes)\//;
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

function stemOf(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\.(?:tsx|jsx|ts|js|mjs)$/i, '').replace(/\/index$/, '');
}

function joinRelative(fromFile: string, spec: string): string {
  const parts = fromFile.replace(/^\.?\/+/, '').split('/');
  parts.pop();
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * 🔴 A SCREEN NOTHING SHOWS IS NOT THE APP (autopsy 3f959fde, 2026-10-01). The build pivoted from a
 * generic data analyser to a lottery analyser and left `DataPreview.tsx` and `AlgorithmSuggestions.tsx`
 * behind, imported by nothing. `JOURNEY_NOT_DERIVED` then named DataPreview's `<select` as the reason the
 * app "takes input": a fact about code no user can reach.
 *
 * The component files (`.tsx` / `.jsx`) that no other file imports and that no framework loads by its
 * name or place. Precision first: a file is set aside only when it is PROVEN unreferenced — any import
 * whose path resolves to it keeps it, and a graph with an entry missing or an import that resolves to no
 * file we were given sets nothing aside. PURE.
 */
export function unreferencedComponents(files: Record<string, string>): Set<string> {
  const paths = Object.keys(files ?? {}).map((p) => p.replace(/^\.?\/+/, ''));
  const present = new Set(paths);
  const stems = new Set(paths.map(stemOf));
  const referenced = new Set<string>();
  let imports = 0;
  for (const [raw, src] of Object.entries(files ?? {})) {
    if (typeof src !== 'string') continue;
    const from = raw.replace(/^\.?\/+/, '');
    IMPORT_SPEC.lastIndex = 0;
    for (let m = IMPORT_SPEC.exec(src); m; m = IMPORT_SPEC.exec(src)) {
      const target = joinRelative(from, m[1]);
      // A graph with a hole proves nothing: an import of a file we were not given could be the one that
      // shows the component, so nothing is called unreferenced.
      if (!present.has(target) && !stems.has(stemOf(target))) return new Set();
      referenced.add(stemOf(target));
      imports++;
    }
  }
  // No entry file, or no import at all, means the graph is not observable here either.
  if (imports === 0 || !paths.some((p) => LOADED_BY_PLACE.test(p))) return new Set();
  const out = new Set<string>();
  for (const p of paths) {
    if (!/\.(?:tsx|jsx)$/i.test(p) || LOADED_BY_PLACE.test(p)) continue;
    if (!referenced.has(stemOf(p))) out.add(p);
  }
  return out;
}

/**
 * The sentence for an app whose only inputs narrow what it already shows.
 *
 * A constant for the same reason as `NO_DATA_ENTRY_REASON`: it is reached from the derivation's
 * explanation and it names the case the release gate reports as `none-derivable`.
 */
export const LOOKUP_ONLY_REASON =
  'this app only looks things up — its inputs (a search box, a sort or a filter) change what is shown, '
  + 'and nothing in it — no form, no storage, no button that adds or saves — keeps anything, so there is no '
  + 'save-and-reload journey to prove';

const APP_SOURCE_FILE = /\.(?:tsx|jsx|ts|js|mjs|vue|svelte|html)$/i;
/** Test suites, build config, static assets and our own service worker are not the app's UI. */
const NOT_APP_UI = /(?:^|\/)(?:e2e|tests?|__tests__|public|node_modules|dist|build)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)[\w.-]+\.config\.[a-z]+$|\.d\.ts$/i;
/** The scaffold's error screen carries a "try again" button that saves nothing. */
const ERROR_BOUNDARY_FILE = /(?:^|\/)ErrorBoundary\.(?:tsx|jsx|ts|js)$/;
/**
 * Signs that something can take what a user gives it and KEEP it. A plain `<button>` and an `onClick` are not
 * on this list: they are judged one by one in `pressCanKeepInput`, because the commonest button in an app
 * changes the screen and keeps nothing (autopsy 5759ad8b, below).
 */
const SAVE_ACTION: readonly RegExp[] = [
  /<(?:form|textarea)\b/i,
  /<(?:Form|Textarea|TextField|Button|IconButton)\b/,
  /role\s*=\s*["']button/i,
  /type\s*=\s*["']submit/i,
  /\bon(?:Submit|DoubleClick|KeyDown|KeyUp|KeyPress|Blur|Drop|PointerDown|MouseDown|TouchStart)\s*=/,
  /\bcontentEditable\b/i,
  /\b(?:localStorage|sessionStorage|indexedDB|IDBDatabase|FormData|sendBeacon)\b/,
  /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)/i,
  /\.(?:insert|upsert|update|delete|post|put|patch)\s*\(/,
  /\b(?:addDoc|setDoc|updateDoc|deleteDoc)\b/,
];

/**
 * 🔴 "NOTHING TO SAVE AND RELOAD" WAS SAID ABOUT AN APP THAT SAVES AND RELOADS (autopsy 536c8189,
 * 2026-10-01). A Duolingo-style app shipped green and `JOURNEY_NOT_DERIVED` carried `NO_DATA_ENTRY_REASON`
 * — *"this app has no data-entry surface at all … nothing to save and reload"*. It keeps XP, gems, a
 * streak and the lessons you have finished in `localStorage`, read back on every load, in
 * `src/hooks/useProgress.ts`. That IS the save-and-reload journey this check exists to prove.
 *
 * 🔑 THE CLASS: `appHasNoDataEntry` asks "IS THERE A FORM?" and its sentence answers "IS THERE ANYTHING
 * TO SAVE?" — two different questions. They coincide for a landing page and part ways for every app
 * whose controls are buttons: a game, a counter, a tracker, a quiz. And this repo already knew storage is
 * a save signal — `SAVE_ACTION`, one screen down in this same file, lists `localStorage` — so the
 * knowledge existed in one predicate and not in its sibling. The drifted-copy class, in two sentences.
 *
 * 🔒 THE THEME IS NOT THE APP'S DATA. Every app from our own starter writes a theme (and a font scale,
 * and a consent flag) to `localStorage`, so a bare storage match would say "this app saves" about a
 * landing page. A write whose key is one of ours, or plainly a display preference, is not evidence —
 * the direction of the doubt is deliberate: a missed save keeps today's wording, a false one would
 * promise a journey that does not exist.
 */
const PERSIST_WRITE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:localStorage|sessionStorage)\s*(?:\.\s*setItem\s*\(|\[)/, 'browser storage'],
  [/\b(?:localStorage|sessionStorage)\.\w+\s*=/, 'browser storage'],
  [/\b(?:indexedDB|IDBDatabase)\b/, 'a browser database'],
  [/\b(?:addDoc|setDoc|updateDoc|deleteDoc)\s*\(/, 'a database write'],
  [/\.(?:insert|upsert|update|delete)\s*\(/, 'a database write'],
  [/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)/i, 'a write to its server'],
];

/** Storage keys that are a display preference or ours, never the user's records. */
const NOT_APP_DATA_KEY = /\b(?:theme|colou?r[-_]?scheme|dark[-_]?mode|font[-_]?scale|locale|language|consent|cookie|nbai|nb-)\b/i;

/**
 * WHERE this app saves state, or null when nothing does — the fact `appHasNoDataEntry` cannot see.
 * Only app UI files (the same selection `appOnlyShowsWhatItHolds` uses). PURE.
 */
export function savedStateEvidence(files: Record<string, string>): { path: string; what: string } | null {
  for (const [path, src] of Object.entries(appOwnFiles(files))) {
    if (!src || !APP_SOURCE_FILE.test(path) || NOT_APP_UI.test(path) || ERROR_BOUNDARY_FILE.test(path)) continue;
    for (const [re, what] of PERSIST_WRITE) {
      const m = re.exec(src);
      if (!m) continue;
      // The line itself decides: a theme write is not the app's data.
      const start = src.lastIndexOf('\n', m.index) + 1;
      const end = src.indexOf('\n', m.index);
      const line = src.slice(start, end < 0 ? undefined : end);
      if (NOT_APP_DATA_KEY.test(line)) continue;
      return { path, what };
    }
  }
  return null;
}

/** The honest sentence for an app that saves state but has no form to fill in. PURE. */
export function savedWithoutFormReason(where: { path: string; what: string }): string {
  return `this app does save state (${where.what} in ${where.path}) and reads it back, but it has no form to fill in — `
    + 'its controls are buttons, so there is no form-and-reload journey to drive here. The click explorer '
    + 'presses those controls instead';
}

/**
 * True when every input the app has only narrows what it shows — a search box over a fixed list, a
 * sort, a filter — and nothing anywhere can take a record from the user and keep it.
 *
 * 🔴 WHY (autopsy ee0e6de5, 2026-09-30). "The world's countries and their capitals" is a table with a
 * search box and an A–Z/Z–A sort, and its own summary said *"a static information app, no database,
 * no API"*. `appHasNoDataEntry` sees the `<input>` and the `onChange`, so it answers false, and the
 * release gate reported YELLOW with *"whether it actually SAVES anything is untested"* about an app
 * that has nothing to save. The same report told the user the fields needed a `name` and a label for
 * the check to work, when there was no save for any check to prove.
 *
 * 🔒 CONSERVATIVE, THE SAME WAY `appHasNoDataEntry` IS. It needs at least one input or select that a
 * change handler listens to, and it
 * answers false on ANY sign of a way to save: a button, a form, a submit, a click or key handler, an
 * editable surface, browser storage, or a write call to a server or database. A to-do list that adds
 * on Enter, or an app that loses its data on reload, therefore still reads as a data app, and its
 * missing journey is still a gap. ⚠️ Since autopsy 8257ca59 a `true` here CAN earn GREEN — but only when the
 * click explorer pressed the app's controls in a real browser and none broke — so a wrong `true` costs more
 * than wording, and every relaxation of it below stays precision-first.
 *
 * 🔴 A BUTTON THAT CHANGES THE SCREEN KEEPS NOTHING (autopsy 5759ad8b, 2026-10-01). A mandi-price app had
 * crop and district filters (`<select onChange>`) over its own sample data and a bottom bar of three
 * `<button onClick={() => setScreen('mandi')}>` tabs. The journey check said, correctly, *"the fields act
 * as you type … nothing needs changing"* — and the release gate still said *"whether it keeps what a user
 * enters is untested"*, because this predicate counted the tab bar as a way to save. Two readers of one
 * question disagreed, and the one the user reads was wrong. A plain `<button>` or `onClick` now counts as
 * a save unless its handler only switches what is shown (see `pressCanKeepInput`); every other press keeps
 * the old, conservative answer. Pure.
 */
export function appOnlyShowsWhatItHolds(files: Record<string, string>): boolean {
  let sawControl = false;
  let sawNarrowing = false;
  for (const [path, src] of Object.entries(appOwnFiles(files))) {
    if (!src || !APP_SOURCE_FILE.test(path) || NOT_APP_UI.test(path) || ERROR_BOUNDARY_FILE.test(path)) continue;
    if (SAVE_ACTION.some((re) => re.test(src))) return false;
    if (pressCanKeepInput(src)) return false;
    if (/<(?:input|select)\b/i.test(src) || /<(?:Input|Select)\b/.test(src)) sawControl = true;
    if (/\bon(?:Change|Input)\s*=/.test(src)) sawNarrowing = true;
  }
  // A control nothing listens to is not a filter; it is an unwired field, and the remedy sentence for
  // an unaddressable form is the right one for it.
  return sawControl && sawNarrowing;
}

/** The setter or callback names a press may call while only changing what is SHOWN. */
const SHOW_STATE_NAME = /^(?:set)?(?:active|current|selected)?(?:screen|tab|view|page|route|mode|theme|section|panel|step|menu|open|show|visible|expanded|collapsed|filter|sort|category|lang|language|unit|city|district|crop|region|day|period|range)s?$/i;
/** A callback prop that navigates: `onNavigate('home')`, `navigate('/x')`, `goTo('a')`. */
const NAVIGATE_CALL = /^(?:navigate|goTo|go|onNavigate|onSelect|onTabChange|onScreenChange|onChangeScreen|onChangeTab|router\.push|history\.push)$/;

/** The handler expression inside `onClick={…}` starting at `open` (the `{`), brace-matched. */
function handlerAt(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length && i < open + 400; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i).trim(); }
  }
  return null;
}

/**
 * Does this handler only change what is shown — one call that sets a screen/tab/filter-style state to a
 * literal, a toggled boolean or a list item's own id, or navigates? Anything else (`addItem(text)`,
 * `setItems([...items, x])`, `save()`, a block of statements) is NOT judged harmless. PURE.
 */
export function handlerOnlyChangesView(expr: string): boolean {
  const body = expr.replace(/^\(\s*\)\s*=>\s*/, '').replace(/^\{\s*([^{};]*?);?\s*\}$/, '$1').trim();
  const m = /^([\w$]+(?:\.[\w$]+)?)\s*\(([^]*)\)$/.exec(body);
  if (!m) return false;
  const name = m[1];
  const arg = m[2].trim();
  const literal = /^(?:'[^']*'|"[^"]*"|`[^`$]*`|-?\d+(?:\.\d+)?|true|false|null)$/.test(arg);
  const toggle = /^!\s*[\w$]+$/.test(arg) || /^\(?\s*[\w$]+\s*\)?\s*=>\s*!\s*[\w$]+$/.test(arg);
  const ownId = /^[\w$]+\.(?:id|key|value|name|slug|path|href|to)$/.test(arg);
  if (NAVIGATE_CALL.test(name)) return literal || ownId;
  if (!/^set[A-Z]/.test(name)) return false;
  if (literal) return true;
  return SHOW_STATE_NAME.test(name) && (toggle || ownId);
}

/**
 * Could pressing something in this file keep what a user typed? True for any `onClick` whose handler does
 * more than change what is shown, and for any plain `<button>` that has no `onClick` of its own to judge
 * (or a submit-reading label). Conservative: an unreadable handler counts as a way to keep. PURE.
 */
export function pressCanKeepInput(src: string): boolean {
  if (submitTargetIn(src) !== null) return true;
  for (const t of scanMarkup(src)) {
    if (t.isElement && t.name === 'button' && !/\bonClick\s*=/.test(t.tag)) return true;
  }
  const re = /\bonClick\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const expr = handlerAt(src, m.index + m[0].length - 1);
    if (expr === null || !handlerOnlyChangesView(expr)) return true;
  }
  return false;
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

/**
 * A value appropriate to the field, so an email input is not filled with the word "test".
 *
 * 🔴 THE BROWSER IS STRICT ABOUT FIVE INPUT TYPES, AND A WRONG VALUE IS NOT A FAILED APP (autopsy
 * d829b523, 2026-09-27). Playwright sets `time`, `date`, `datetime-local`, `month`, `week` and `color`
 * directly and throws `Malformed value` for anything the browser would not accept — so a water
 * reminder's wake-up time received the marker string, the journey died at the fill step, and the
 * release gate reported "no user journey was proven" about a form nobody had managed to fill. Each of
 * them gets a value of its own shape. A `number` also respects the field's own `min`/`max`: typing 7
 * into `min="30"` makes the browser refuse to submit, which is our input failing, not the app.
 */
export function valueForInput(tag: string, marker: string): string {
  const type = (ATTR(tag, 'type') || '').toLowerCase();
  const hint = `${ATTR(tag, 'name') || ''} ${ATTR(tag, 'placeholder') || ''} ${ATTR(tag, 'id') || ''}`.toLowerCase();
  if (type === 'time') return '08:00';
  if (type === 'datetime-local') return '2030-01-01T08:00';
  if (type === 'month') return '2030-01';
  if (type === 'week') return '2030-W01';
  if (type === 'color') return '#336699';
  if (type === 'email' || /e-?mail/.test(hint)) return `${marker}@example.com`;
  if (type === 'password' || /password|passwd/.test(hint)) return 'Test-Passw0rd!';
  if (type === 'number' || /amount|price|qty|quantity|count|age/.test(hint)) return numberWithinBounds(tag, 7);
  if (type === 'tel' || /phone|mobile|contact/.test(hint)) return '9876543210';
  if (type === 'url' || /url|website|link/.test(hint)) return 'https://example.com';
  if (type === 'date') return '2030-01-01';
  if (type === 'checkbox' || type === 'radio') return '';
  const example = lookupKeyExample(tag);
  if (example) return example;
  return marker;
}

/** A field that names something that must already EXIST (a ticker, a product code, a PIN). */
const LOOKUP_KEY_HINT = /\b(?:symbol|ticker|scrip|isin|sku|ifsc|pin\s?code|pincode|zip|postal|coupon|promo|voucher|product\s?code|item\s?code|hsn)\b/i;

/**
 * The example a lookup-key field's own placeholder gives (`placeholder="e.g. RELIANCE"` → `RELIANCE`).
 *
 * 🔴 WHY (autopsy 241215d1, 2026-10-04). A paper-trading app's order form takes a stock SYMBOL. The
 * journey typed its marker there, the app (correctly) refused an order for a ticker that does not
 * exist, the marker never appeared, and the release gate called the app "Not shippable — a real user
 * journey failed" — about an order flow the build had verified with five curl calls. A made-up value
 * in a field that must name an existing thing tests our input, not the app. The field's own example is
 * the one value the app tells every user to type. Only a lookup-key field, and only when the
 * placeholder gives an example: a "Task name, e.g. Buy milk" field still gets the marker, and a key
 * field with no example keeps it too (the form then submits a value the app may reject — the same as
 * before). PURE.
 */
export function lookupKeyExample(tag: string): string | null {
  const name = `${ATTR(tag, 'name') || ''} ${ATTR(tag, 'id') || ''} ${ATTR(tag, 'aria-label') || ''}`;
  const placeholder = ATTR(tag, 'placeholder') || '';
  if (!LOOKUP_KEY_HINT.test(`${name} ${placeholder}`)) return null;
  const m = placeholder.match(/\b(?:e\.?\s?g\.?|eg|for example|such as|like)\s*[:,-]?\s*([A-Za-z0-9][A-Za-z0-9._&-]{0,30})/i);
  return m ? m[1].replace(/[.,]+$/, '') : null;
}

/**
 * `preferred`, moved inside the field's own literal `min`/`max` when it declares them. A bound written
 * as an expression (`min={MIN_AGE}`) cannot be read here and is left to the browser, exactly as before.
 */
function numberWithinBounds(tag: string, preferred: number): string {
  const num = (name: string): number | null => {
    const raw = ATTR(tag, name);
    if (!raw || raw.includes('{')) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  let v = preferred;
  const min = num('min');
  const max = num('max');
  if (min !== null && v < min) v = min;
  if (max !== null && v > max) v = max;
  return String(v);
}

/**
 * Inputs that must not be typed into — a file picker, a hidden field, a submit button. A `range` is on
 * the list because it always holds a value already, and any number we chose could fall outside its
 * bounds and be refused as malformed.
 */
function skippableInput(tag: string): boolean {
  const type = (ATTR(tag, 'type') || '').toLowerCase();
  return ['hidden', 'file', 'submit', 'reset', 'button', 'image', 'checkbox', 'radio', 'range'].includes(type);
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
  // Read with the shared JSX reader — the old `<button\b[^>]*>` stopped at the `>` of `onClick={() => …}`,
  // missed a `type="submit"` written after the handler, and handed the rest of the tag to Playwright as
  // the button's "text" (see `inputScans`).
  const buttons = buttonsIn(source);
  const plainText = (inner: string): string => inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  // 🔴 THE NAME A BROWSER GIVES THE BUTTON, NOT ITS INNER TEXT (autopsy 6cd698cc, 2026-10-01). The journey
  // finds the button with getByRole('button', { name }) — an ACCESSIBLE-name match — and an `aria-label`
  // replaces the inner text as that name. The chat app's send button was `<button type="submit"
  // aria-label="Send message">➤</button>`; the journey asked for a button named "➤", found none, and
  // reported "the submit control was not present on the running page" beside a send button on screen.
  // A dynamic label or `aria-labelledby` is not a name we can read here, so it falls back to the role.
  const accessibleName = (tag: string, inner: string): string | null => {
    if (/\baria-labelledby\s*=/i.test(tag)) return null;
    if (/\baria-label\s*=/i.test(tag)) {
      const aria = ATTR(tag, 'aria-label'); // a quoted, static value — `aria-label={x}` reads as null
      return aria && !/[{}]/.test(aria) ? aria.trim() : null;
    }
    const text = plainText(inner);
    return text && !/[{}]/.test(text) ? text : null;
  };
  for (const { tag } of buttons) {
    const testid = ATTR(tag, 'data-testid');
    if (testid && (/(submit|save|add|create)/i.test(testid) || /type\s*=\s*["']submit["']/i.test(tag))) {
      return { kind: 'testid', value: testid };
    }
  }
  for (const { tag, inner } of buttons) {
    if (/type\s*=\s*["']submit["']/i.test(tag)) {
      const name = accessibleName(tag, inner);
      if (name) return { kind: 'text', value: name };
      return { kind: 'role', value: 'submit' };
    }
  }
  for (const { tag, inner } of buttons) {
    const name = accessibleName(tag, inner);
    const text = plainText(inner);
    if (name && (CREATE_WORDS.test(name) || (text && !/[{}]/.test(text) && CREATE_WORDS.test(text)))) return { kind: 'text', value: name };
  }
  // `<input type="submit" value="Add">` — older markup, still real.
  const inputSubmit = inputTags(source).find((t) => /type\s*=\s*["']submit["']/i.test(t));
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
 * 🤖 AN AI ASK IS SUBMITTED, NOT RELOADED (queue Q-085, autopsy 1219c639, admin-approved 2026-10-01).
 * A chat that asks the app's AI appends the question and the answer to a list, so it read as a
 * create form, and the journey then checked that the "item" survived a reload. A chat's messages
 * usually live in memory, so that check would fail a working app; and in the preview the AI may not
 * answer at all (the gateway answers after publish). Such a form is checked as a submit that does not
 * break the app.
 *
 * Evidence, not a guess: the form's own file, or a local module it imports directly, calls into an AI
 * helper (`src/lib/ai`, `window.NavAI`, the gateway route, a chat-completions API or an AI SDK). Pure.
 */
const AI_CALL_RE = /from\s*["'][^"']*\/(?:lib|services|api|utils|hooks)\/ai["']|window\.NavAI\b|\bNavAI\.ask\b|\/api\/app-ai\/|\/chat\/completions\b|\/v1\/messages\b|from\s*["'](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai)["']/;

export function formAsksAi(formPath: string, files: Record<string, string>): boolean {
  const own = files?.[formPath];
  if (typeof own !== 'string') return false;
  if (AI_CALL_RE.test(own)) return true;
  const specs = own.match(/\bfrom\s*["'][^"']+["']/g) || [];
  for (const raw of specs.slice(0, MAX_IMPORTS_PER_PAGE)) {
    const spec = /["']([^"']+)["']/.exec(raw)?.[1];
    if (!spec) continue;
    const resolved = resolveLocalImport(formPath, spec, files);
    if (resolved && AI_CALL_RE.test(files[resolved] || '')) return true;
  }
  return false;
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

/**
 * The path the app's OWN router maps a page file to, or null when no router declaration names it.
 *
 * 🔴 WHY (autopsy e1c21ad8, 2026-09-27). A novel-writing app's only form lives in `NewNovel.tsx`, and
 * its router says `<Route path="/new" element={<NewNovel />} />`. The filename heuristic below looked
 * for a route containing "newnovel", found none, and sent the journey to `/` — where the form is not —
 * so the report read *"No user journey could be completed … none of the form fields were present"*
 * and the release gate stayed YELLOW for a form that was never looked for where it lives. The router
 * already states the answer; guessing from a filename is what you do when it does not.
 *
 * Reads the binding the router file imports the page under (default, named, or `lazy(() => import())`),
 * then the `<Route path element={<X …}>` / `Component={X}` or `{ path, element: <X … }` that uses it.
 * A JSX route is returned with its parents joined (routerPaths.ts, autopsy a106df77); a route-OBJECT
 * child is returned only when its own path is absolute, since a wrong URL is worse than the heuristic.
 * Deterministic: files in key order, first match wins. Pure.
 */
export function routeFromRouter(page: string, files: Record<string, string>): string | null {
  for (const [file, src] of Object.entries(files ?? {})) {
    if (typeof src !== 'string' || !/\.(t|j)sx?$/.test(file)) continue;
    if (!/<Route\b|\bpath\s*:/.test(src)) continue;
    const bindings = new Set<string>();
    const bind = (name: string | undefined, spec: string | undefined): void => {
      if (name && spec && resolveLocalImport(file, spec, files) === page) bindings.add(name);
    };
    for (const m of src.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g)) bind(m[1], m[2]);
    for (const m of src.matchAll(/\bimport\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      for (const part of m[1].split(',')) {
        const alias = /^\s*[\w$]+\s+as\s+([\w$]+)\s*$/.exec(part)?.[1] ?? /^\s*([\w$]+)\s*$/.exec(part)?.[1];
        bind(alias, m[2]);
      }
    }
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\s*\.\s*)?lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*["']([^"']+)["']\s*\)/g)) bind(m[1], m[2]);
    // JSX routes first, with their parents joined (routerPaths.ts): a nested `<Route path="new">` serves
    // `/new`, and dropping it sent the journey to `/`, where the form is not (autopsy a106df77).
    for (const r of declaredRoutes(src)) {
      for (const name of bindings) {
        const n = name.replace(/\$/g, '\\$');
        if (new RegExp(String.raw`(?:element\s*=\s*\{\s*<\s*${n}\b|Component\s*=\s*\{\s*${n}\b)`).test(r.tag)) return r.path;
      }
    }
    for (const name of bindings) {
      const n = name.replace(/\$/g, '\\$');
      const pathValue = String.raw`path\s*[=:]\s*(?:\{\s*)?["'\x60]([^"'\x60]+)["'\x60]`;
      const usesIt = String.raw`(?:element\s*[=:]\s*\{?\s*<\s*${n}\b|Component\s*[=:]\s*\{?\s*${n}\b)`;
      // Either attribute order, inside one <Route …> or one { … } route object (no nested braces/tags
      // between them beyond the element's own `<X`).
      const both = [
        new RegExp(String.raw`${pathValue}[^<{]{0,200}?${usesIt}`),
        new RegExp(String.raw`${usesIt}[^<{]{0,200}?${pathValue}`),
      ];
      for (const re of both) {
        const hit = re.exec(src)?.[1];
        if (hit && hit.startsWith('/')) return hit;
      }
    }
  }
  return null;
}

/** The route a page file serves, best-effort, or null. Only used for a label and a starting URL. */
export function routeForFile(path: string, knownRoutes: readonly string[], files?: Record<string, string>): string {
  // The router's own declaration, when there is one, is the answer — see routeFromRouter.
  const declared = files ? routeFromRouter(path, files) : null;
  if (declared) return declared;
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
/** Words that name no screen: a component called one of these says nothing about the control that shows it. */
const GENERIC_REACH = new Set(['app', 'main', 'index', 'root', 'layout', 'shell', 'form', 'input', 'field', 'modal', 'dialog', 'popup', 'card', 'item', 'list', 'row', 'base', 'common', 'shared', 'custom', 'my', 'the']);

/**
 * The word the control that shows this screen most likely carries — or null when the file name says
 * nothing safe. PURE.
 *
 * `src/steps/DesignStep.tsx` → `design`; `RevenueTab.tsx` → `revenue`. 🔒 A word that is itself an
 * action (`PostStep` → "post", `SendScreen` → "send") is refused: pressing a control named after it
 * could publish, pay or send, and a journey must reach a screen without doing anything on the way.
 */
export function reachWordFor(path: string): string | null {
  const base = String(path ?? '').split('/').pop()?.replace(/\.(?:t|j)sx?$/i, '') ?? '';
  const stem = base.replace(/(?:Step|Screen|Tab|Panel|View|Page|Form|Section|Card|Modal|Dialog|Wizard)$/, '');
  const first = (/^[A-Z]?[a-z]+/.exec(stem)?.[0] ?? '').toLowerCase();
  if (first.length < 3 || GENERIC_REACH.has(first)) return null;
  if (NEVER_PRESS.test(first) || WRITE_VERBS.test(first)) return null;
  return first;
}

/**
 * Is this page file a screen the app switches to by STATE rather than by URL? True when its route is
 * `/` only because nothing named it — no router declares the file, and it is not the home screen by
 * name. `App.tsx` and `Home.tsx` are on `/` for real; `src/screens/Medicines.tsx` in an app with no
 * router is not on any URL at all. PURE.
 */
export function screenReachedByControl(path: string, route: string, files: Record<string, string>): boolean {
  if (route !== '/') return false;
  const stem = (String(path).split('/').pop() ?? '').replace(/\.(t|j)sx?$/i, '').toLowerCase();
  const key = stem.replace(/(page|screen|view)$/, '') || stem;
  if (/^(home|index|page|app|main|root|layout)$/.test(key)) return false;
  return routeFromRouter(path, files) === null;
}

/** Component files that are neither pages nor tests — where a state-switched screen's form lives. */
const SCREEN_FILE = /\.(?:t|j)sx$/i;

export function deriveJourneys(input: DeriveJourneysInput): Journey[] {
  const files = appOwnFiles(input?.files ?? {});
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
    let credential = false;
    for (const candidate of formSourcesFor(path, files)) {
      if (usedForms.has(candidate.path)) continue;
      const tags = formFields(candidate.source);
      if (tags.length === 0) continue;

      const got: JourneyField[] = [];
      let addressable = true;
      for (const { tag, labelText } of tags.slice(0, 6)) {
        const target = targetForInput(tag) ?? (labelText ? { kind: 'label' as const, value: labelText } : null);
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
      credential = isCredentialForm(tags);
      break;
    }
    if (!submit || fields.length === 0) continue;
    usedForms.add(formPath);

    const route = routeForFile(path, routes, files);
    // 🔴 A SCREEN NO URL REACHES IS REACHED BY ITS CONTROL (autopsy e49afa97). `src/screens/Medicines.tsx`
    // is a page file, so it is derived here — but the app switches screens by state, no router names it,
    // and `routeForFile` FELL BACK to `/`, where its form is not. The journey then loaded the home screen
    // and reported "none of the form fields were present" three times, about three forms every user
    // reaches in two taps. Such a screen carries the same `reach` word a non-page screen does.
    const reach = screenReachedByControl(path, route, files) ? reachWordFor(path) : null;
    const listed = rendersList(source);
    // The marker has to actually be typed somewhere, or "did it appear" is unanswerable.
    const markerTyped = fields.some((f) => f.value.includes(marker));

    // A list on the page is not enough: the form must be one that ADDS to a list (see formFeedsList).
    // Only a handler we could read, and that plainly adds nothing, downgrades the journey.
    const feeds = formFeedsList(source, submit) !== 'no';
    const asksAi = formAsksAi(formPath, files);

    if (listed && markerTyped && feeds && !noWrites && !asksAi && !credential) {
      out.push({
        id: `create-persists:${path}`,
        kind: 'create-persists',
        route,
        title: reach
          ? `Open the "${reach}" screen, create an item and check it survives a reload`
          : `Create an item on ${route} and check it survives a reload`,
        fields, submit, writes: true,
        ...(reach ? { reach } : {}),
      });
    } else {
      out.push({
        id: `form-submit:${path}`,
        kind: 'form-submit',
        route,
        title: credential
          ? `Fill and submit the sign-in form on ${route} without the app breaking`
          : asksAi
          ? (reach
            ? `Open the "${reach}" screen, ask the app's AI and check the app does not break`
            : `Ask the app's AI on ${route} and check the app does not break`)
          : reach
            ? `Open the "${reach}" screen, fill and submit its form without the app breaking`
            : `Fill and submit the form on ${route} without the app breaking`,
        fields, submit,
        // A submit still POSTs. Treated as a write unless it is plainly a search/filter form.
        writes: !/search|filter|query/i.test(path),
        ...(reach ? { reach } : {}),
        ...(credential ? { signIn: true } : {}),
      });
    }
  }

  // 🔴 A FORM NO PAGE REACHES IS STILL THE APP'S FORM (autopsy 2b1f845e). A five-step studio kept its
  // forms in `src/steps/*.tsx`, shown by pressing "2 Design", "3 Review"… on `/`. No page composes them
  // within `formSourcesFor`'s depth, so no journey was derived and the release gate stayed YELLOW with
  // "no user journey could be derived" — while the click explorer had pressed those very steps. Such a
  // form gets a journey on `/` that first presses the one control named after its screen (`reach`).
  // Precision first: a screen whose name gives no safe word, a form whose submit is an outward action,
  // or a file already used by a page journey yields nothing.
  const pages = new Set(candidates);
  for (const [path, src] of Object.entries(files)) {
    if (out.length >= MAX_JOURNEYS) break;
    if (typeof src !== 'string' || !SCREEN_FILE.test(path) || pages.has(path) || usedForms.has(path)) continue;
    if (NOT_APP_UI.test(path) || ERROR_BOUNDARY_FILE.test(path)) continue;
    const reach = reachWordFor(path);
    if (!reach) continue;
    const tags = formFields(src);
    if (tags.length === 0) continue;
    const fields: JourneyField[] = [];
    let addressable = true;
    for (const { tag, labelText } of tags.slice(0, 6)) {
      const target = targetForInput(tag) ?? (labelText ? { kind: 'label' as const, value: labelText } : null);
      if (!target) { addressable = false; break; }
      const value = valueForInput(tag, marker);
      if (value) fields.push({ target, value });
    }
    if (!addressable || fields.length === 0) continue;
    const submit = submitTargetIn(src);
    if (!submit) continue;
    if (submit.kind === 'text' && NEVER_PRESS.test(submit.value)) continue;
    usedForms.add(path);
    const listed = rendersList(src);
    const markerTyped = fields.some((f) => f.value.includes(marker));
    const feeds = formFeedsList(src, submit) !== 'no';
    const asksAi = formAsksAi(path, files);
    const credential = isCredentialForm(tags);
    const create = listed && markerTyped && feeds && !noWrites && !asksAi && !credential;
    out.push({
      id: `${create ? 'create-persists' : 'form-submit'}:${path}`,
      kind: create ? 'create-persists' : 'form-submit',
      route: '/',
      title: create
        ? `Open the "${reach}" screen, create an item and check it survives a reload`
        : asksAi
          ? `Open the "${reach}" screen, ask the app's AI and check the app does not break`
          : `Open the "${reach}" screen, fill and submit its form without the app breaking`,
      fields, submit,
      writes: create || !/search|filter|query/i.test(path),
      reach,
      ...(credential ? { signIn: true } : {}),
    });
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
    // 🔒 AND THE SECOND QUESTION, IN BOTH BRANCHES (autopsy 536c8189). This module's own docblock on
    // `NO_DATA_ENTRY_REASON` says "TWO branches now reach it"; only the other one was fixed when the
    // Duolingo app was told it had nothing to save, and a sibling left behind is this repo's headline
    // class. `savedStateEvidence` is asked here too, so the two branches cannot say different things.
    if (hasRenderSurface(files ?? {}) && appHasNoDataEntry(files ?? {})) {
      const saved = savedStateEvidence(files ?? {});
      return saved ? savedWithoutFormReason(saved) : NO_DATA_ENTRY_REASON;
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
    // 🔒 …AND "NO FORM" IS NOT "NOTHING TO SAVE" (autopsy 536c8189 — see `savedStateEvidence`). Ask the
    // second question before saying the second sentence: an app whose controls are buttons and which keeps
    // its state in storage DOES save and reload, and telling the user it has nothing to save is false.
    if (hasRenderSurface(files ?? {}) && appHasNoDataEntry(files ?? {})) {
      const saved = savedStateEvidence(files ?? {});
      return saved ? savedWithoutFormReason(saved) : NO_DATA_ENTRY_REASON;
    }
    if (appOnlyShowsWhatItHolds(files ?? {})) return LOOKUP_ONLY_REASON;
    // 🔴 "NOTHING HERE TAKES USER INPUT" WAS SAID ABOUT AN APP WHOSE FORMS SIT ON SCREENS NO PAGE REACHES
    // (autopsy 2b1f845e: a five-step wizard in src/steps/, switched by state, no router). The data-entry
    // scan reads EVERY file; when it found input, the honest sentence names where and why the check did
    // not get there, instead of denying that the input exists.
    const where = dataEntryEvidence(files ?? {});
    if (where) {
      return `this app takes input (${where.what} in ${where.path}), but no page reaches that form and its file `
        + 'name gives no control to open it with — screens switched without a router are reached only by pressing a control named after them';
    }
    return 'this app has no form for a journey to fill in — nothing here takes user input';
  }
  // 🔗 THE MOST SPECIFIC TRUE REASON FIRST (autopsies ee0e6de5 and 2d076ce8 met at merge, 2026-09-30).
  // A pure lookup app — a search box or a filter, and NOTHING anywhere that saves — is answered here,
  // before the per-form sentence below, which is right only when some save exists elsewhere (an
  // autosave, a key handler); the gate reads the same predicate as `none-derivable`, so the sentence
  // and the verdict agree. Also checked before the remedy at the end, which is only true of an app
  // that has a save to prove.
  if (appOnlyShowsWhatItHolds(files ?? {})) return LOOKUP_ONLY_REASON;
  // 🔴 AN ADDRESSABLE FIELD WITH NOTHING TO SUBMIT IS NOT AN UNADDRESSABLE FIELD (autopsy 2d076ce8,
  // 2026-09-30). A Bhagavad Gita reader's only input is a live search box — `id="q"`, a real
  // `<label htmlFor="q">` — that filters as you type and has no submit step. `deriveJourneys` skipped it
  // for having no submit button, and this function then fell through to the sentence below and told
  // the user to give the field "a `name` and a label": a remedy for a defect the field does not have,
  // on NavBharatAI's own tested template. So: when some form's fields CAN all be addressed and it is
  // only the submit step that is absent, say that — it is a different fact with no fix to ask for.
  // ⚠️ THE REMEDY, NOT ONLY THE SYMPTOM (autopsy a48d0f9e, 2026-09-19). This sentence used to stop at
  // "no journey was derived", which reads like an environmental limit of the CHECK. It is not: it is a
  // fixable defect in the generated app, and in that report the SAME build's accessibility pass had
  // already counted the very same fields — "34 form field(s) with no label" across three named files.
  // One cause, reported as two unrelated lines, and the release gate then said "whether it actually
  // SAVES anything is untested" as though nothing could be done about it. Naming the fix costs nothing
  // and is what turns this line into something a build can act on.
  // 🔴 THE FIELDS WERE FINE — THE BUTTON WAS THE MISSING PIECE (autopsy 876afca9, 2026-09-30). A
  // calculator's two inputs had an id and a <label> each, and this sentence told the admin they had
  // "no name, id, placeholder, label or test id". What the derivation actually could not find was a
  // button that SUBMITS them: "Calculate" is a plain onClick button, not a submit and not an add/save
  // word. Same question the derivation asks, answered for the report.
  // 🔗 ONE PREDICATE, TWO TRUE SENTENCES (merged 2026-09-30). #3398 (the Gita search box) and #3402 (the
  // calculator) fixed this same false remedy on the same day, each with its own copy of the predicate.
  // They agree on WHEN — every field addressable, no submit step — and differ only in WHY: a field with
  // no button at all acts as you type; a form WITH a button has one that does not read as submitting.
  const noSubmitForms = pages.flatMap((p) => formSourcesFor(p, files)).filter((s) => {
    const fields = formFields(s.source);
    if (fields.length === 0) return false;
    const allAddressable = fields.slice(0, 6).every(({ tag, labelText }) => targetForInput(tag) !== null || !!labelText);
    return allAddressable && submitTargetIn(s.source) === null;
  });
  if (noSubmitForms.length > 0) {
    if (noSubmitForms.some((s) => /<button\b/i.test(s.source))) {
      return 'the fields in this app can be addressed, but none of its buttons reads as submitting them (no '
        + 'submit button and no add / save / create button), so no fill-and-submit journey was derived. That is '
        + 'a limit of this check, not a defect in the app.';
    }
    return 'the fields in this app act as you type (a search or filter) and have no submit or save step, '
      + 'so there is nothing a journey could submit and then look for after a reload — no journey was derived, '
      + 'and nothing needs changing for this check.';
  }
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
/**
 * A control that OPENS a form rather than submitting one: "+ New Habit", "Add task", "Create note",
 * "New". Anchored at the start of the label so "Add to cart" style side-effects are still subject to
 * `NEVER_PRESS`, which is checked as well. Pure data, handed to the runner as a pattern.
 */
export const JOURNEY_OPENER = /^[+＋\s]*(?:add|new|create|compose|write)\b/i;

export function journeyScript(previewUrl: string, journeys: readonly Journey[], marker: string, opts: { storageState?: string | null } = {}): string {
  const base = previewUrl.replace(/\/+$/, '');
  const steps = journeys.map((j) => {
    const fills = j.fields.map((f) =>
      `    { locator: () => ${locatorExpr(f.target)}, value: ${JSON.stringify(f.value)} },`).join('\n');
    return `  {
    id: ${JSON.stringify(j.id)},
    kind: ${JSON.stringify(j.kind)},
    route: ${JSON.stringify(j.route)},
    reach: ${JSON.stringify(j.reach ?? null)},
    // A sign-in form is driven signed OUT (a session would only redirect away from it); every other
    // journey runs behind the door when the app has one (signInExplore.ts).
    pageOpts: ${newPageOptionsExpr(isSignInRoute(j.route) || j.signIn ? null : opts.storageState)},
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
const OPENER = new RegExp(${JSON.stringify(JOURNEY_OPENER.source)}, 'i');
const NEVER = new RegExp(${JSON.stringify(NEVER_PRESS.source)}, 'i');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const j of journeys) {
  // 'unreachable' is the DEFAULT, not a failure state. A journey that never got to press anything has
  // told us nothing about the app, and reporting that as a defect would be an invented alarm.
  const out = { id: j.id, kind: j.kind, route: j.route, verdict: 'unreachable', step: 'load', note: '', errors: [] };
  const page = await browser.newPage(j.pageOpts);
  page.on('pageerror', (e) => { if (out.errors.length < 3) out.errors.push(String(e.message).slice(0, 200)); });
  page.on('console', (m) => { if (m.type() === 'error' && out.errors.length < 3) out.errors.push(String(m.text()).slice(0, 200)); });
  try {
    await page.goto(base + j.route, { waitUntil: 'domcontentloaded', timeout: ${JOURNEY_TIMEOUT_MS} });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    // 🔴 AUTOPSY 12c642ed (2026-09-30). The habit tracker's form lives in a modal behind "+ New Habit",
    // so its submit control is not on the page until a user presses that button — and the journey
    // reported "not present" about a form every user reaches in one tap. When the submit is not
    // visible, press ONE visible opener ("+ New …", "Add …", "Create …"), never a destructive or
    // outward control, and only then look for the form.
    out.step = 'open';
    const submitVisible = async () => { const b = j.submit(page).first(); return (await b.count()) > 0 && await b.isVisible().catch(() => false); };
    // A screen switched by state (journey.reach, autopsy 2b1f845e): press the ONE visible control whose
    // name carries the screen's word — never an outward or creating control — and remember it, so the
    // same control can be pressed again after the reload.
    const REACH_SKIP = new RegExp(${JSON.stringify(WRITE_VERBS.source)}, 'i');
    // Every name a control goes by: its visible text, then its aria-label and title. An icon button
    // shows "＋" and is NAMED by its label, so reading only the text missed it (autopsy e49afa97).
    const namesOf = async (c) => [
      await c.innerText().catch(() => ''),
      await c.getAttribute('aria-label').catch(() => ''),
      await c.getAttribute('title').catch(() => ''),
    ].map((x) => String(x || '').replace(/\\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
    const pressReach = async (exact) => {
      const cands = page.locator('button, [role=tab], [role=button], a[href="#"], a:not([href])');
      const n = Math.min(await cands.count(), 60);
      for (let i = 0; i < n; i++) {
        const c = cands.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        const names = await namesOf(c);
        const name = exact ? names.find((x) => x === exact) : names.find((x) => x.toLowerCase().includes(j.reach));
        if (!name) continue;
        if (NEVER.test(name) || REACH_SKIP.test(name)) continue;
        if ((await c.getAttribute('type').catch(() => '')) === 'submit') continue;
        await c.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(400);
        return name;
      }
      return null;
    };
    if (j.reach && !(await submitVisible())) {
      const via = await pressReach(null);
      if (!via) { out.note = 'no visible control named after the "' + j.reach + '" screen was found to open it'; throw new Error('no-reach'); }
      out.via = via;
    }
    if (!(await submitVisible())) {
      const cands = page.locator('button, [role=button], a[href="#"], a:not([href])');
      const n = Math.min(await cands.count(), 40);
      for (let i = 0; i < n; i++) {
        const c = cands.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        const names = await namesOf(c);
        // An icon button's visible text is "＋"; its NAME is its aria-label ("Add medicine"). Either may
        // say it opens a form (autopsy e49afa97), and a control whose whole text is a plus sign does.
        const name = names.find((x) => OPENER.test(x) || /^[+＋]$/.test(x));
        if (!name || names.some((x) => NEVER.test(x))) continue;
        await c.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(300);
        if (await submitVisible()) { out.opener = name; break; }
      }
    }
    out.step = 'fill';
    let filled = 0;
    for (const f of j.fields(page)) {
      const el = f.locator().first();
      if (await el.count() === 0) continue;
      // A dropdown is CHOSEN from, never typed into: fill() on a select throws "Element is not an
      // <input>, <textarea> or [contenteditable] element", which is how a working onboarding form was
      // once reported as a journey nobody could reach (autopsy d829b523). The first real option is
      // picked; a select with no real option is left as it is.
      const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
      if (tag === 'select') {
        const options = await el.locator('option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== '')).catch(() => []);
        if (options.length === 0) continue;
        await el.selectOption(options[0], { timeout: 4000 });
        filled++;
        continue;
      }
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
        // The screen the item lives on is not the one a reload lands on — open it again the same way.
        if (out.via) await pressReach(out.via);
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
