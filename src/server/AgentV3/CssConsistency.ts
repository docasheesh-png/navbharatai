// AgentV3 — CSS class-name consistency check.
//
// A whole class of "the app built but renders unstyled / broken" bugs comes from a mismatch the TS
// compiler CANNOT see: a component uses `className="watch-container"` but the stylesheet only defines
// `.watch-wrapper`. tsc passes (class names are just strings), so the verify-gate's tsc check misses
// it — yet the app is visually broken. This deterministic check cross-references the class names used
// in components against the class selectors defined in the project's CSS, and reports the mismatch so
// the auto-repair pass can make them agree.
//
// Conservative by design (precision over recall) to avoid false positives on legitimate apps:
//   • SKIPPED entirely when Tailwind is in use (utility classes are not in .css files).
//   • only considers STATIC className string literals and `.class` selectors.
//   • only flags CUSTOM classes: kebab-case ("watch-container") and, since 2026-09-30, a single
//     lowercase word ("header", "price", "mrp") that is not a STATE word ("active", "open", …).
//   • reads `className="…"` in components AND `class="…"` in HTML pages and in the markup strings a
//     plain-JS app builds (`innerHTML = '<div class="product">'`), since 2026-09-30.
//   • requires the project to actually HAVE a .css file with selectors, and a threshold of misses,
//     before reporting — so a matched stylesheet (or a CSS-in-JS app) is never flagged.
//
// Pure + dependency-free → fully unit-testable.

const SRC_RE = /\.(t|j)sx?$/;
/** A file whose markup names classes: a component, a script that builds HTML, or an HTML page. */
const MARKUP_RE = /\.((t|j)sx?|html?)$/;
/** Every stylesheet dialect whose `.class` selectors define a class (autopsy "Universal Remote": scss/less were invisible). */
const CSS_RE = /\.(css|scss|sass|less)$/;
/** A token that can be a CSS class name (used by the class collector). */
const CLASS_NAME = /^-?[A-Za-z_][\w-]*$/;
/** Minimum undefined custom classes before we treat it as a real mismatch (avoids odd one-offs). */
const MISMATCH_THRESHOLD = 3;

/**
 * Collect static class tokens used across the markup files: `className="a b c"` in components, and
 * `class="a b c"` in HTML pages and in the HTML strings a plain-JS app writes into the page.
 *
 * 🔴 AUTOPSY "Nemi Mart" (2026-09-30): a grocery app written as plain HTML + JS shipped with its header
 * stacked, its MRP not struck through and its buttons square — and this check never spoke, because it
 * read only `className=`. Every class a static app uses was invisible, so the repair that exists for
 * exactly this never ran. A token that is an interpolation (`${x}`) is not a class and is skipped.
 */
export function collectUsedClasses(files: Record<string, string>): Set<string> {
  const used = new Set<string>();
  // className="..."  |  className='...'  |  className={"..."}  |  className={'...'}  |  className={`...`}
  const reactRe = /className\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g;
  // class="..." | class='...' — `\bclass\s*=` never matches `className=` (an N follows "class").
  const htmlRe = /\bclass\s*=\s*(?:\\?["'])([^"'`<>]+?)(?:\\?["'])/g;
  for (const [path, content] of Object.entries(files)) {
    if (!MARKUP_RE.test(path) || typeof content !== 'string') continue;
    for (const re of [reactRe, htmlRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        for (const tok of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          const c = tok.trim();
          if (c && CLASS_NAME.test(c)) used.add(c);
        }
      }
    }
  }
  return used;
}

/** Collect class selectors defined across the project's CSS files (.foo, .foo-bar). */
export function collectDefinedClasses(files: Record<string, string>): { defined: Set<string>; cssFiles: number } {
  const defined = new Set<string>();
  let cssFiles = 0;
  const re = /\.(-?[A-Za-z_][\w-]*)/g;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    // A page's own <style> blocks define classes too — a one-file app keeps its whole stylesheet there.
    let text: string;
    if (CSS_RE.test(path)) text = content;
    else if (/\.html?$/.test(path)) {
      const blocks = [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((b) => b[1]);
      if (blocks.length === 0) continue;
      text = blocks.join('\n');
    } else continue;
    cssFiles++;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) defined.add(m[1]);
  }
  return { defined, cssFiles };
}

/**
 * Styles that live OUTSIDE the project (a `<link rel="stylesheet" href="https://…">` to a CDN theme, or
 * an `@import url(https://…)`) define classes this check cannot see. Say nothing then — a check we
 * cannot perform must never report "missing".
 */
function usesExternalStylesheet(files: Record<string, string>): boolean {
  for (const [path, content] of Object.entries(files)) {
    if (/\.html?$/.test(path) && /<link\b[^>]*rel=["']?stylesheet[^>]*href=["']?(https?:)?\/\//i.test(content)) return true;
    if (/\.html?$/.test(path) && /<link\b[^>]*href=["']?(https?:)?\/\/[^>]*rel=["']?stylesheet/i.test(content)) return true;
    if (CSS_RE.test(path) && /@import\s+(url\()?["']?(https?:)?\/\//i.test(content)) return true;
  }
  return false;
}

function usesTailwind(files: Record<string, string>): boolean {
  for (const [path, content] of Object.entries(files)) {
    // A static page on the Tailwind CDN: every utility in its `class=` is defined by a script we cannot read.
    if (/\.html?$/.test(path) && /cdn\.tailwindcss\.com|@tailwindcss\/browser/.test(content)) return true;
    // Tailwind v4 has no `@tailwind` directive — `@import "tailwindcss"` is the whole setup.
    if (CSS_RE.test(path) && /@import\s+["']tailwindcss/.test(content)) return true;
    if (/tailwind\.config\.[cm]?[jt]s$/.test(path)) return true;
    if (CSS_RE.test(path) && /@tailwind\b/.test(content)) return true;
    if (/package\.json$/.test(path) && /"tailwindcss"/.test(content)) return true;
  }
  return false;
}

/**
 * Words that name a STATE a script toggles, not a thing a stylesheet must draw. A single-word class in
 * this list is never reported: `class="active"` with no `.active` rule is a normal, working app.
 */
const STATE_WORDS = new Set([
  'active', 'inactive', 'open', 'opened', 'closed', 'selected', 'hidden', 'hide', 'show', 'shown', 'visible',
  'invisible', 'disabled', 'enabled', 'checked', 'current', 'done', 'completed', 'complete', 'expanded',
  'collapsed', 'focused', 'focus', 'hover', 'pressed', 'loading', 'loaded', 'playing', 'paused', 'running',
  'dark', 'light', 'error', 'success', 'warning', 'valid', 'invalid', 'empty', 'full', 'new', 'old', 'on',
  'off', 'odd', 'even', 'first', 'last', 'highlight', 'highlighted', 'dragging', 'dragover', 'over', 'win',
  'lose', 'correct', 'wrong', 'flipped', 'matched', 'animate', 'fade', 'sticky', 'fixed', 'mobile', 'desktop',
]);

/**
 * A class is "custom" (generator-defined) when it is the shape a stylesheet must define: kebab-case
 * ("watch-container"), or a single lowercase word of three or more letters that is not a state word
 * ("header", "price", "mrp"). Before 2026-09-30 only kebab-case counted, which is why a page whose
 * classes were all single words could lose every rule and this check would stay silent.
 */
function isCustomClass(c: string): boolean {
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(c)) return true;
  return /^[a-z]{3,}[0-9]*$/.test(c) && !STATE_WORDS.has(c);
}

/**
 * Return the custom (kebab-case) class names used by components but NOT defined in any CSS file —
 * the exact "component vs stylesheet" mismatch that renders an app unstyled. Empty when consistent,
 * when Tailwind is used, or when the project has no CSS selectors to check against.
 */
export function findUndefinedClasses(files: Record<string, string>): string[] {
  if (usesTailwind(files) || usesExternalStylesheet(files)) return [];
  const { defined, cssFiles } = collectDefinedClasses(files);
  // No stylesheet at all ⇒ nothing to check against, so say nothing (a CSS-in-JS app).
  //
  // 🔴 A stylesheet that defines NO class is not "nothing to check against" (autopsy 2720e553,
  // 2026-09-27). It used to be treated the same way, which made deleting every rule the one edit
  // that always passes this check: a repair round reduced a calculator's 4.6 KB stylesheet to `{ }`,
  // this check went silent, and the build said "verified" about an app with no styles at all. The
  // screens still name their classes, so every one of them is undefined, and saying so is exact.
  if (cssFiles === 0) return [];
  const used = collectUsedClasses(files);
  const missing: string[] = [];
  for (const c of used) {
    if (isCustomClass(c) && !defined.has(c)) missing.push(c);
  }
  return missing.sort();
}

/**
 * The custom classes ONE file uses that no project stylesheet defines — the same question
 * `findUndefinedClasses` asks of the whole project, asked of a file while it is still open. PURE.
 *
 * 🔴 AUTOPSY a5b661c8 (2026-09-30): `.btn-danger`, `.field-label` and `.nb-studio-step-label` were written
 * during the build and only found by the end-of-build check, whose repair ran inside a 63-second heal.
 * The write-time note (`inventedKitClassNote`) covered `nb-` classes the kit lacks, and nothing else.
 * Same guards as the project check, so it can never speak where that one would stay silent: Tailwind,
 * an external stylesheet, or no stylesheet at all ⇒ [].
 */
export function undefinedClassesInFile(path: string, content: string, project: Record<string, string>): string[] {
  if (!MARKUP_RE.test(path)) return [];
  if (usesTailwind(project) || usesExternalStylesheet(project)) return [];
  const { defined, cssFiles } = collectDefinedClasses(project);
  if (cssFiles === 0) return [];
  return [...collectUsedClasses({ [path]: content })].filter((c) => isCustomClass(c) && !defined.has(c)).sort();
}

/** The note handed back with a write that uses classes nothing defines. '' when there are none. PURE. */
export function undefinedClassesWriteNote(path: string, missing: readonly string[], sheet = 'src/index.css'): string {
  if (missing.length === 0) return '';
  const shown = missing.slice(0, 8).map((c) => `.${c}`).join(', ');
  const more = missing.length > 8 ? ` and ${missing.length - 8} more` : '';
  return `\n⚠️ ${path} uses ${shown}${more} — no stylesheet in this project defines ${missing.length === 1 ? 'it' : 'them'}, so those elements render UNSTYLED. `
    + `Add the rules to ${sheet} now (or use a class the stylesheet already has) — not at the end of the build.`;
}

/** How many class names a sub-agent brief may carry — the kit is 59; an app sheet rarely doubles it. */
const BRIEF_MAX_CLASSES = 160;

/**
 * The classes the project's stylesheets already define, as one line for a UI sub-agent's brief. PURE.
 *
 * 🔴 AUTOPSY a5b661c8 (2026-09-30): a frontend sub-agent read `src/index.css` — the 18.7 KB design kit —
 * six times in eighteen seconds, in slices, to find out which classes existed, then grepped for them.
 * Sixteen reads of that one file across the build. What it was looking for is a list of names, and the
 * platform can hand it over for the cost of the reads it already makes. Read from the sheets on disk,
 * so it is true of THIS project; '' when there is no sheet, so it is never a guess.
 */
export function stylesheetClassBrief(sheets: Record<string, string>): string {
  const paths = Object.keys(sheets).filter((p) => CSS_RE.test(p));
  if (paths.length === 0) return '';
  const { defined } = collectDefinedClasses(sheets);
  const names = [...defined].filter((c) => !/^\d/.test(c)).sort();
  if (names.length === 0) return '';
  const shown = names.slice(0, BRIEF_MAX_CLASSES).map((c) => `.${c}`).join(' ');
  const more = names.length > BRIEF_MAX_CLASSES ? ` (+${names.length - BRIEF_MAX_CLASSES} more)` : '';
  return `[STYLESHEET CLASSES — already defined in ${paths.join(', ')}; use these directly. Do not read the stylesheet to find them, and never use a class that is not here without adding its rule.]\n${shown}${more}`;
}

/**
 * If components use a meaningful number of custom classes the CSS never defines, return a human +
 * model-readable error describing the mismatch (for the auto-repair pass). Returns null when the
 * styles are consistent — so a good app is never flagged.
 */
export function cssConsistencyError(files: Record<string, string>): string | null {
  const missing = findUndefinedClasses(files);
  if (missing.length < MISMATCH_THRESHOLD) return null;
  return [
    `CSS class mismatch: ${missing.length} class name(s) are used in the markup (className / class) but are NOT defined in any CSS file, so the app renders unstyled / visually broken:`,
    missing.map((c) => `  .${c}`).join('\n'),
    'Fix by making the components and the stylesheet AGREE — either add these classes to the CSS with real styles, or rename the class usages to the classes the CSS actually defines. Keep them consistent across all files.',
    'Removing style rules never fixes this: a stylesheet with fewer rules leaves MORE of these classes unstyled.',
  ].join('\n');
}

/** At most this many class names in one write-time note. */
export const MAX_CLASSES_IN_WRITE_NOTE = 12;

/**
 * The write-time half of `CSS_CLASSES_UNDEFINED` — said while the model is still writing, instead of by a
 * repair pass after the app is finished. PURE; `''` when there is nothing to say.
 *
 * 🔴 WHY (autopsy e6d46cde, 2026-09-30). The model wrote four screens, then appended their styles to
 * `src/index.css` — and missed nine of the classes the screens use (`.btn-sm`, `.status-success`, …).
 * Nothing told it: it declared the app complete, and the end-of-build check then spent a 100-second
 * repair pass, in a fresh context that had to re-read every screen, adding nine rules the first
 * model could have added in one edit. The mismatch was knowable the moment the stylesheet was written.
 *
 * Which classes are named depends on what was written:
 *   • a STYLESHEET write → every screen's undefined classes, because the model just said "these are the
 *     styles" and any class still missing is exactly what it forgot;
 *   • a SCREEN write → only that screen's own undefined classes, so a note never lists work the model
 *     has not touched.
 * `nb-` classes are left to the kit (`kitRestore` puts back the kit's own rules, and
 * `inventedKitClassNote` names an invented one) so the same class is never reported twice.
 */
export function undefinedClassWriteNote(
  written: Record<string, string>,
  project: Record<string, string>,
): string {
  const merged = { ...project, ...written };
  const missing = findUndefinedClasses(merged).filter((c) => !c.startsWith('nb-'));
  if (missing.length === 0) return '';
  const wroteSheet = Object.keys(written).some((p) => isProjectStylesheet(p));
  const scope = wroteSheet
    ? missing
    : (() => {
      const screens: Record<string, string> = {};
      for (const [p, c] of Object.entries(written)) if (SRC_RE.test(p)) screens[p] = c;
      const used = collectUsedClasses(screens);
      return missing.filter((c) => used.has(c));
    })();
  if (scope.length === 0) return '';
  const shown = scope.slice(0, MAX_CLASSES_IN_WRITE_NOTE).map((c) => `.${c}`).join(', ');
  const more = scope.length > MAX_CLASSES_IN_WRITE_NOTE ? ` and ${scope.length - MAX_CLASSES_IN_WRITE_NOTE} more` : '';
  return [
    '',
    wroteSheet
      ? `Style check after this write: ${scope.length} class name(s) the screens use still have no rule in any stylesheet, so those parts render unstyled: ${shown}${more}.`
      : `Style check after this write: ${scope.length} class name(s) in this file have no rule in any stylesheet yet: ${shown}${more}.`,
    'Define each one in the global stylesheet with the palette variables, or use a class that already exists, before you finish.',
  ].join('\n');
}

/** A token that can be a CSS class name. */
const CLASS_TOKEN = /^-?[A-Za-z_][\w-]*$/;

/**
 * Every class name the given source files put on an element, INCLUDING the ones chosen by an
 * expression (`className={isOp ? 'key key-operator' : 'key'}`, a template literal's static parts).
 * `collectUsedClasses` reads only a plain literal, which is right for a precision-first CHECK and wrong
 * for a stylesheet that must style what the screens really render. PURE; sorted.
 */
export function classNamesUsedBy(files: Record<string, string>): string[] {
  const out = new Set<string>();
  const addTokens = (text: string) => {
    for (const tok of text.split(/\s+/)) if (CLASS_TOKEN.test(tok)) out.add(tok);
  };
  // Every string literal in an expression; a template literal's `${ … }` parts are expressions too,
  // so their own literals (`${active ? 'key-active' : ''}`) are read by recursing into them.
  const scanExpression = (expr: string, depth: number): void => {
    if (depth > 3) return;
    const literals = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    let lit: RegExpExecArray | null;
    while ((lit = literals.exec(expr))) {
      const body = lit[2];
      if (lit[1] === '`') {
        for (const part of body.matchAll(/\$\{([^}]*)\}/g)) scanExpression(part[1], depth + 1);
        addTokens(body.replace(/\$\{[^}]*\}/g, ' '));
      } else {
        addTokens(body);
      }
    }
  };
  for (const [path, content] of Object.entries(files)) {
    if (!SRC_RE.test(path)) continue;
    const re = /className\s*=\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      let i = m.index + m[0].length;
      let expr: string;
      if (content[i] === '{') {
        // The balanced `{ … }` expression after `className=`.
        let depth = 0;
        const start = i;
        for (; i < content.length; i++) {
          if (content[i] === '{') depth++;
          else if (content[i] === '}' && --depth === 0) break;
        }
        expr = content.slice(start + 1, i);
      } else {
        const q = content[i];
        if (q !== '"' && q !== "'") continue;
        const end = content.indexOf(q, i + 1);
        if (end < 0) continue;
        expr = content.slice(i, end + 1);
      }
      scanExpression(expr, 0);
    }
  }
  return [...out].sort();
}

/**
 * The architect lane's repair switch (autopsy "Universal Remote", 2026-09-27). Default ON — an app
 * whose screens have no styles is broken, not "less designed". `AGENTV3_CSS_HEAL=off` records the
 * finding and skips the repair.
 */
export function cssHealEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CSS_HEAL ?? '').trim().toLowerCase() !== 'off';
}

/** The admin line for `CSS_CLASSES_UNDEFINED`. PURE. */
export function undefinedClassesNote(missing: readonly string[]): string {
  const shown = missing.slice(0, 12).map((c) => `.${c}`).join(', ');
  const more = missing.length > 12 ? ` and ${missing.length - 12} more` : '';
  return `${missing.length} class name(s) used by the screens have no style rule in any stylesheet, so those screens render unstyled: ${shown}${more}.`;
}

/** Stylesheets that are part of the app — never dependencies, build output or git internals. PURE. */
export function isProjectStylesheet(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\/+/, '');
  return CSS_RE.test(p) && !/^(node_modules|dist|build|\.git|coverage)\//.test(p) && !/\/node_modules\//.test(p);
}
