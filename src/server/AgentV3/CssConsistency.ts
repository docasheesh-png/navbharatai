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
//   • only flags KEBAB-CASE custom classes (e.g. "watch-container") — the kind a generator invents
//     and must define; single-word/utility tokens are ignored.
//   • requires the project to actually HAVE a .css file with selectors, and a threshold of misses,
//     before reporting — so a matched stylesheet (or a CSS-in-JS app) is never flagged.
//
// Pure + dependency-free → fully unit-testable.

const SRC_RE = /\.(t|j)sx?$/;
/** Every stylesheet dialect whose `.class` selectors define a class (autopsy "Universal Remote": scss/less were invisible). */
const CSS_RE = /\.(css|scss|sass|less)$/;
/** Minimum undefined custom classes before we treat it as a real mismatch (avoids odd one-offs). */
const MISMATCH_THRESHOLD = 3;

/** Collect static className tokens used across the source files (className="a b c"). */
export function collectUsedClasses(files: Record<string, string>): Set<string> {
  const used = new Set<string>();
  // className="..."  |  className='...'  |  className={"..."}  |  className={'...'}  |  className={`...`}
  const re = /className\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g;
  for (const [path, content] of Object.entries(files)) {
    if (!SRC_RE.test(path)) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      for (const tok of m[1].split(/\s+/)) {
        const c = tok.trim();
        if (c) used.add(c);
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
    if (!CSS_RE.test(path)) continue;
    cssFiles++;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) defined.add(m[1]);
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
    if (/tailwind\.config\.[cm]?[jt]s$/.test(path)) return true;
    if (CSS_RE.test(path) && /@tailwind\b/.test(content)) return true;
    if (/package\.json$/.test(path) && /"tailwindcss"/.test(content)) return true;
  }
  return false;
}

/** A class is "custom" (generator-defined) when it is kebab-case — the shape a stylesheet must define. */
function isCustomClass(c: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(c);
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
  if (!SRC_RE.test(path)) return [];
  if (usesTailwind(project) || usesExternalStylesheet(project)) return [];
  const { defined, cssFiles } = collectDefinedClasses(project);
  if (cssFiles === 0) return [];
  return [...collectUsedClasses({ [path]: content })].filter((c) => isCustomClass(c) && !defined.has(c)).sort();
}

/** The note handed back with a write that uses classes nothing defines. '' when there are none. PURE. */
export function undefinedClassesWriteNote(path: string, missing: readonly string[]): string {
  if (missing.length === 0) return '';
  const shown = missing.slice(0, 8).map((c) => `.${c}`).join(', ');
  const more = missing.length > 8 ? ` and ${missing.length - 8} more` : '';
  return `\n⚠️ ${path} uses ${shown}${more} — no stylesheet in this project defines ${missing.length === 1 ? 'it' : 'them'}, so those elements render UNSTYLED. `
    + 'Add the rules to src/index.css now (or use a class the stylesheet already has) — not at the end of the build.';
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
    `CSS class mismatch: ${missing.length} class name(s) are used in components via className but are NOT defined in any CSS file, so the app renders unstyled / visually broken:`,
    missing.map((c) => `  .${c}`).join('\n'),
    'Fix by making the components and the stylesheet AGREE — either add these classes to the CSS with real styles, or rename the className usages to the classes the CSS actually defines. Keep them consistent across all files.',
    'Removing style rules never fixes this: a stylesheet with fewer rules leaves MORE of these classes unstyled.',
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
