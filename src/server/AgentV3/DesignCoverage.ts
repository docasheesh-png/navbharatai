// Per-PAGE design coverage — the gate that was missing.
//
// THE REPORT (admin, 2026-08-11): "1st page to theek banta hai, beautiful — par andar ke page bas HTML
// feel dete hai. koi design style nahi, ek dam simple."
//
// WHY IT HAPPENS, and why nothing caught it. The scaffold already ships a real design kit (palette
// tokens, .card / .btn-primary / .nb-* screen recipes) and the architect prompt tells the model to use
// it. But that instruction is GUIDANCE with no verification behind it, and every gate we have asks a
// different question:
//
//   • tsc               — class names are strings. A page with no classes typechecks perfectly.
//   • ESLint            — no rule for "this looks unfinished".
//   • CssConsistency    — flags classes used but NOT DEFINED. A page using NOTHING is spotlessly clean.
//   • ProjectIntegrity  — flags a stylesheet imported by nobody. The stylesheet IS imported — by the
//                         good first page. Every later page free-rides on that and is never examined.
//   • ReviewerAgent     — functional findings.
//
// So the entire verification stack is blind to precisely this defect, and the model's own behaviour
// does the rest: the first screen gets full effort, and by the fifth — under context pressure and step
// budget — it degrades to bare <div>s. Nothing ever objects, so nothing ever improves.
//
// This module asks the question nobody was asking: IS THIS PAGE ACTUALLY DESIGNED? It runs per FILE,
// so page 5 is judged exactly as strictly as page 1.
//
// PRECISION OVER RECALL — a false positive here nags a perfectly good app and trains everyone to
// ignore the check, which is worse than having none. So it:
//   • only looks at PAGE/SCREEN files (by path or name convention), never at leaf components;
//   • skips any file styling itself another legitimate way (styled-components, emotion, CSS modules,
//     Tailwind utilities, inline style objects, a UI library);
//   • needs a real amount of markup before judging anything;
//   • reports only defects with an unambiguous, mechanical definition.
//
// ADVISORY BY CONSTRUCTION. It never fails a build. A working app with a plain page must still ship —
// it feeds the bounded repair pass and, failing that, an honest warning.
//
// Pure + dependency-free → fully unit-testable.

export type DesignDefect = 'BARE_MARKUP' | 'NO_HEADING' | 'RAW_TABLE' | 'LIST_WITHOUT_EMPTY_STATE';

export interface PageFinding {
  file: string;
  defects: DesignDefect[];
  /** Fraction of HTML elements carrying a className, 0..1. */
  classedRatio: number;
  elements: number;
}

export interface DesignCoverageReport {
  /** Pages that were actually judged (after every skip rule). */
  pagesExamined: number;
  findings: PageFinding[];
  ok: boolean;
}

const PAGE_PATH_RE = /(^|\/)(pages|screens|routes|views)\//i;
const PAGE_NAME_RE = /(page|screen|view)\.(t|j)sx$/i;
const SRC_RE = /\.(t|j)sx$/;

/**
 * Styling approaches that are perfectly good and produce NO kit class names. A file using any of them
 * is styled — judging it on className coverage would be a false positive.
 */
const ALTERNATIVE_STYLING_RE = [
  /from\s+['"]styled-components['"]/,
  /from\s+['"]@emotion\//,
  /from\s+['"]@mui\//,
  /from\s+['"]@chakra-ui\//,
  /from\s+['"]antd['"]/,
  /from\s+['"]@mantine\//,
  /from\s+['"]react-bootstrap['"]/,
  /\.module\.(css|scss|sass|less)['"]/,
  /from\s+['"]@shadcn\//,
];

/** The scaffold's own kit — the classes the architect prompt tells the model to reach for. */
const KIT_CLASS_RE = /\b(nb-[a-z-]+|card|btn-primary|btn-ghost|badge|alert|container|stack|row|field)\b/;

/**
 * A Tailwind-looking utility. Deliberately narrow — matching too loosely would let any hyphenated
 * class count as "designed" and the BARE check would never fire.
 */
const TAILWIND_UTILITY_RE =
  /\b(flex|grid|hidden|block|relative|absolute|sticky|fixed)\b|\b(p|m|px|py|mx|my|mt|mb|ml|mr|w|h|gap|text|bg|border|rounded|shadow|font|leading|tracking|space|max|min|z|opacity|ring|col|ItemsCenter)-[a-z0-9./[\]-]+/;

/** Is this file a PAGE — a whole screen the user navigates to — rather than a leaf component? */
export function isPageFile(path: string): boolean {
  if (!SRC_RE.test(path)) return false;
  if (/\.(test|spec)\./i.test(path)) return false;
  return PAGE_PATH_RE.test(path) || PAGE_NAME_RE.test(path);
}

/** Every lowercase JSX element opened in the file (HTML tags; `<Foo>` components are excluded). */
export function countHtmlElements(content: string): { total: number; classed: number } {
  let total = 0;
  let classed = 0;
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const tag = m[1];
    // Elements that carry no visual weight — counting them would drag the ratio down unfairly.
    if (tag === 'br' || tag === 'hr' || tag === 'input' || tag === 'meta' || tag === 'link') continue;
    total++;
    if (/\bclassName\s*=/.test(m[2])) classed++;
  }
  return { total, classed };
}

/** Any legitimate styling signal at all — kit class, utility, CSS module, or an inline style object. */
export function hasStylingSignal(content: string): boolean {
  if (ALTERNATIVE_STYLING_RE.some((re) => re.test(content))) return true;
  if (/\bstyle\s*=\s*\{\{/.test(content)) return true;
  if (/className\s*=\s*\{\s*(styles|classes|cx|clsx|css)\b/.test(content)) return true;
  const classValues = [...content.matchAll(/className\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/g)].map((m) => m[1]).join(' ');
  if (!classValues.trim()) return false;
  return KIT_CLASS_RE.test(classValues) || TAILWIND_UTILITY_RE.test(classValues);
}

/**
 * Judge ONE page. Returns null when the file is out of scope or too small to judge honestly.
 *
 * The thresholds are deliberately forgiving: this must fire on "a wall of bare divs", not on a page
 * that happens to style four of its six elements.
 */
export function analyzePage(path: string, content: string): PageFinding | null {
  if (!isPageFile(path)) return null;
  // Styled another way entirely — nothing here can judge it, and guessing would be a false positive.
  if (ALTERNATIVE_STYLING_RE.some((re) => re.test(content))) return null;

  const { total, classed } = countHtmlElements(content);
  // Too little markup to draw any conclusion. A 3-element page may legitimately be a redirect.
  if (total < 6) return null;

  const classedRatio = total > 0 ? classed / total : 0;
  const defects: DesignDefect[] = [];

  // 1. THE REPORTED DEFECT: a page of naked elements. Both conditions must hold — a page can be mostly
  //    unclassed while still clearly designed (a few kit wrappers around plain text), and a page can
  //    have classes on everything that are all meaningless. Only the intersection is unambiguous.
  if (classedRatio < 0.35 && !hasStylingSignal(content)) defects.push('BARE_MARKUP');

  // 2. No title of any kind. An inner page that opens with no heading reads as unfinished even when
  //    the rest is styled — it is the single clearest "this is a draft" signal.
  if (!/<h[1-3]\b/.test(content) && !/\bnb-hero\b|\bnb-auth\b/.test(content)) defects.push('NO_HEADING');

  // 3. A raw table. The kit ships .nb-table-wrap/.nb-table specifically because an unwrapped table
  //    scrolls the whole PAGE sideways on a phone instead of scrolling inside its own box.
  if (/<table\b/.test(content) && !/nb-table/.test(content)) defects.push('RAW_TABLE');

  // 4. A list with no empty state. A blank panel reads as BROKEN to a first-time user, who sees the
  //    app on its emptiest day — the day they sign up.
  const rendersList = /\.map\s*\(/.test(content);
  const hasEmptyState = /nb-empty|length\s*===\s*0|length\s*<\s*1|!\w+(\.\w+)*\.length|\blength\s*\?/.test(content);
  if (rendersList && !hasEmptyState) defects.push('LIST_WITHOUT_EMPTY_STATE');

  if (defects.length === 0) return null;
  return { file: path, defects, classedRatio: Math.round(classedRatio * 100) / 100, elements: total };
}

/** Judge every page in the project. Pure; never throws. */
export function analyzeDesignCoverage(files: Record<string, string>): DesignCoverageReport {
  const findings: PageFinding[] = [];
  let pagesExamined = 0;

  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content !== 'string') continue;
    if (!isPageFile(path)) continue;
    if (ALTERNATIVE_STYLING_RE.some((re) => re.test(content))) continue;
    if (countHtmlElements(content).total < 6) continue;
    pagesExamined++;
    const finding = analyzePage(path, content);
    if (finding) findings.push(finding);
  }

  // Deterministic order — the worst page first, then alphabetical, so a report never reshuffles
  // between runs and a repair prompt is stable.
  findings.sort((a, b) => (b.defects.length - a.defects.length) || a.file.localeCompare(b.file));
  return { pagesExamined, findings, ok: findings.length === 0 };
}

const DEFECT_TEXT: Record<DesignDefect, string> = {
  BARE_MARKUP:
    'it is bare markup — the elements carry almost no classes, so it renders as unstyled HTML while the '
    + 'rest of the app looks designed. Give it the page container, real spacing, and the kit classes '
    + '(.container / .stack / .card / .btn-primary / .nb-*) the first screen already uses',
  NO_HEADING:
    'it has no heading at all (no h1/h2/h3), which reads as an unfinished draft. Add a real page title, '
    + 'and a one-line subtitle where it helps',
  RAW_TABLE:
    'it renders a raw <table>. Wrap it in .nb-table-wrap with <table className="nb-table"> so it scrolls '
    + 'inside its own box instead of scrolling the whole page sideways on a phone',
  LIST_WITHOUT_EMPTY_STATE:
    'it renders a list with no empty state. Add an .nb-empty block saying what will appear here, with the '
    + 'action that fills it — a blank panel reads as BROKEN to a first-time user, who sees the app on its '
    + 'emptiest day',
};

/**
 * The repair instruction. Names each page and exactly what is wrong with IT, because a generic "make
 * the design better" prompt produces a generic restyle — and usually touches the one page that was
 * already fine.
 */
export function designRepairInstruction(report: DesignCoverageReport): string {
  if (report.ok) return '';
  const lines: string[] = [
    'These pages do not match the quality of the rest of the app. The first screen of this app looks',
    'designed and these do not, which is the single most damaging inconsistency a user notices.',
    '',
    'Fix ONLY the pages listed. Reuse the design system that is ALREADY in the project — the palette',
    'variables and the component/screen kit in the global stylesheet (.card, .btn-primary, .badge,',
    '.container, .stack, .row, .field, .nb-table, .nb-empty, .nb-stats, .nb-shell, .nb-hero). Do NOT',
    'invent a second design language, do not add a CSS framework, and do not restyle pages not listed.',
    '',
  ];
  for (const f of report.findings) {
    lines.push(`- ${f.file}:`);
    for (const d of f.defects) lines.push(`    • ${DEFECT_TEXT[d]}.`);
  }
  lines.push(
    '',
    'Every page must look like it belongs to the same product as the first screen: consistent page',
    'padding and max-width, a real heading, cards or panels around grouped content, styled buttons and',
    'inputs, and genuine empty/loading states. Make the smallest edits that achieve that — do not',
    'rewrite working logic.',
  );
  return lines.join('\n');
}

/** One-line human summary for the build report / narration. */
export function designCoverageSummary(report: DesignCoverageReport): string {
  if (report.pagesExamined === 0) return 'No page-level components to review for design consistency.';
  if (report.ok) return `All ${report.pagesExamined} page(s) use the app's design system.`;
  const worst = report.findings[0];
  return `${report.findings.length} of ${report.pagesExamined} page(s) fall short of the app's own design `
    + `standard (worst: ${worst.file} — ${worst.defects.join(', ')}).`;
}
