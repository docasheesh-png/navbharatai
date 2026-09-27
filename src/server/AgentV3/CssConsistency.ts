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
  if (cssFiles === 0 || defined.size === 0) return []; // nothing to check against → don't guess
  const used = collectUsedClasses(files);
  const missing: string[] = [];
  for (const c of used) {
    if (isCustomClass(c) && !defined.has(c)) missing.push(c);
  }
  return missing.sort();
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
  ].join('\n');
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
