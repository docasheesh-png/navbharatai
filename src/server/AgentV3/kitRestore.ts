// AgentV3 — PUT BACK THE DESIGN-KIT RULES A SCREEN USES, deterministically, with no model call.
//
// 🔴 WHY (autopsy e725e002, 2026-09-29). A build's design repair was told — by
// `designRepairInstruction` — to "reuse the design system that is ALREADY in the project … .nb-empty,
// .nb-hero …". It did exactly that: it gave four pages real empty states using `.nb-empty`,
// `.nb-empty-icon`, `.nb-empty-title`, `.nb-empty-text`. But earlier in the same build the architect had
// rewritten `src/index.css` with its own styles, and the kit those classes live in was gone. So the
// repair that fixed "no empty state" shipped four unstyled empty states, and the report said
// DESIGN_HEALED. The instruction was true of the scaffold and false of the app.
//
// The kit is a FIXED, KNOWN stylesheet (`DESIGN_KIT_CSS`). When a screen names a kit class the app's
// stylesheet does not define, the correct rule is not a guess — it is the kit's own rule, byte for
// byte. That is the same class of certainty as the orphan-stylesheet import guard, so it is fixed the
// same way: by construction, with no model call and no cost, before and after any repair pass.
//
// 🔒 WHAT IT WILL NEVER DO:
//   • restyle a class the app already defines — a kit rule is taken only when EVERY class in its
//     selector is undefined in the app's stylesheets, so the app's own design always wins;
//   • invent a rule — only rules that exist in the kit, for classes a screen really uses;
//   • overwrite a token the app already sets — a `--var` is added only when no stylesheet declares it;
//   • touch a Tailwind app or one styled from a CDN (`findUndefinedClasses` already says nothing there).
// Kill switch: AGENTV3_KIT_RESTORE=off. PURE — the caller writes the file.

import { DESIGN_KIT_CSS } from './sandbox/AppMakerLab/generator/templates/designKit';
import { collectDefinedClasses, findUndefinedClasses, isProjectStylesheet } from './CssConsistency';

/** Kill switch. Default ON. */
export function kitRestoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_KIT_RESTORE ?? '').trim().toLowerCase() !== 'off';
}

/** One top-level statement of a stylesheet: a rule, or an at-rule block with its inner statements. */
interface CssBlock {
  /** Everything before `{` (a selector list, or `@media …` / `@keyframes …`). */
  prelude: string;
  /** Everything between the braces. */
  body: string;
}

/** Split CSS into its top-level `prelude { body }` blocks. Comments are dropped. PURE. */
export function parseCssBlocks(css: string): CssBlock[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: CssBlock[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    if (j >= src.length) break; // unbalanced tail — ignore it rather than guess
    const prelude = src.slice(i, open).trim();
    if (prelude) out.push({ prelude, body: src.slice(open + 1, j) });
    i = j + 1;
  }
  return out;
}

const CLASS_IN_SELECTOR = /\.(-?[A-Za-z_][\w-]*)/g;

function classesIn(selector: string): string[] {
  return [...selector.matchAll(CLASS_IN_SELECTOR)].map((m) => m[1]);
}

/** A kit rule is safe to add when it names ≥1 class a screen needs and NO class the app styles itself. */
function takeRule(prelude: string, needed: ReadonlySet<string>, defined: ReadonlySet<string>): boolean {
  const cls = classesIn(prelude);
  return cls.length > 0 && cls.some((c) => needed.has(c)) && cls.every((c) => !defined.has(c));
}

function tokenDecls(body: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) m.set(d[1], d[2].trim());
  return m;
}

function varsUsedIn(text: string): Set<string> {
  return new Set([...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
}

/** The kit, parsed once: its rules, its keyframes, its light and dark tokens. */
interface ParsedKit {
  rules: CssBlock[];
  media: { prelude: string; rules: CssBlock[] }[];
  keyframes: Map<string, string>;
  light: Map<string, string>;
  dark: Map<string, string>;
}

let kitCache: ParsedKit | null = null;
function parsedKit(): ParsedKit {
  if (kitCache) return kitCache;
  const kit: ParsedKit = { rules: [], media: [], keyframes: new Map(), light: new Map(), dark: new Map() };
  for (const b of parseCssBlocks(DESIGN_KIT_CSS)) {
    if (b.prelude === ':root') {
      for (const [k, v] of tokenDecls(b.body)) kit.light.set(k, v);
    } else if (/^@keyframes\s+/.test(b.prelude)) {
      kit.keyframes.set(b.prelude.replace(/^@keyframes\s+/, '').trim(), `${b.prelude} {${b.body}}`);
    } else if (/^@media\b/.test(b.prelude)) {
      const inner = parseCssBlocks(b.body);
      if (/prefers-color-scheme:\s*dark/.test(b.prelude)) {
        for (const r of inner) if (r.prelude === ':root') for (const [k, v] of tokenDecls(r.body)) kit.dark.set(k, v);
      } else {
        kit.media.push({ prelude: b.prelude, rules: inner });
      }
    } else if (!b.prelude.startsWith('@')) {
      kit.rules.push(b);
    }
  }
  kitCache = kit;
  return kit;
}

/** Every class the kit defines. PURE. */
export function kitClasses(): Set<string> {
  const kit = parsedKit();
  const out = new Set<string>();
  for (const r of [...kit.rules, ...kit.media.flatMap((m) => m.rules)]) for (const c of classesIn(r.prelude)) out.add(c);
  return out;
}

/**
 * The stylesheet the restored rules go into: one the app actually imports, `src/index.css` first.
 * A `.sass` file (indented syntax) is never a target — plain CSS is not valid there. PURE.
 */
export function kitRestoreTarget(files: Record<string, string>): string | null {
  const sheets = Object.keys(files).filter((p) => isProjectStylesheet(p) && !/\.sass$/.test(p));
  if (sheets.length === 0) return null;
  const sources = Object.entries(files).filter(([p]) => /\.(t|j)sx?$|\.(vue|svelte|html?)$/.test(p) && !/node_modules\//.test(p));
  const imported = (p: string) => {
    const base = p.split('/').pop() ?? p;
    return sources.some(([, c]) => typeof c === 'string' && c.includes(base))
      || sheets.some((s) => s !== p && /@import/.test(files[s] ?? '') && (files[s] ?? '').includes(base));
  };
  const ordered = [...sheets].sort((a, b) => (a === 'src/index.css' ? -1 : b === 'src/index.css' ? 1 : a.localeCompare(b)));
  return ordered.find(imported) ?? (sheets.includes('src/index.css') ? 'src/index.css' : null);
}

export interface KitRestorePatch {
  /** The stylesheet to write. */
  path: string;
  /** Its full new content (the old content, unchanged, plus the appended kit rules). */
  content: string;
  /** Classes the screens use that now have a rule. */
  restored: string[];
  /** Design tokens added because the restored rules read them and the app never set them. */
  tokens: string[];
}

export const KIT_RESTORE_MARKER = '/* NavBharatAI design kit — rules this app\'s screens use, restored from the kit */';

/**
 * The patch that puts back every kit rule a screen needs and the stylesheet lacks — or null when there
 * is nothing to restore. PURE; the caller writes `path`.
 */
export function kitRestorePatch(files: Record<string, string>, env: NodeJS.ProcessEnv = process.env): KitRestorePatch | null {
  if (!kitRestoreEnabled(env)) return null;
  const missing = findUndefinedClasses(files);
  if (missing.length === 0) return null;
  const inKit = kitClasses();
  const needed = new Set(missing.filter((c) => inKit.has(c)));
  if (needed.size === 0) return null;
  const target = kitRestoreTarget(files);
  if (!target) return null;

  const { defined } = collectDefinedClasses(files);
  const kit = parsedKit();
  const pieces: string[] = [];
  for (const r of kit.rules) if (takeRule(r.prelude, needed, defined)) pieces.push(`${r.prelude} {${r.body}}`);
  for (const m of kit.media) {
    const inner = m.rules.filter((r) => takeRule(r.prelude, needed, defined));
    if (inner.length > 0) pieces.push(`${m.prelude} {\n${inner.map((r) => `  ${r.prelude} {${r.body}}`).join('\n')}\n}`);
  }
  if (pieces.length === 0) return null;

  const appCss = Object.entries(files).filter(([p]) => isProjectStylesheet(p)).map(([, c]) => c ?? '').join('\n');
  // Keyframes the restored rules animate with, when the app has none of that name.
  for (const [name, block] of kit.keyframes) {
    if (pieces.some((p) => new RegExp(`\\b${name}\\b`).test(p)) && !new RegExp(`@keyframes\\s+${name}\\b`).test(appCss)) pieces.push(block);
  }

  // Tokens: only the ones read by what is being added, only when no stylesheet declares them, and
  // transitively (a kit token may itself read another).
  const declaredByApp = (t: string) => new RegExp(`${t.replace(/[-]/g, '\\-')}\\s*:`).test(appCss);
  const tokens = new Set<string>();
  let frontier = varsUsedIn(pieces.join('\n'));
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const t of frontier) {
      if (tokens.has(t) || declaredByApp(t) || !kit.light.has(t)) continue;
      tokens.add(t);
      for (const v of varsUsedIn(kit.light.get(t) ?? '')) next.add(v);
    }
    frontier = next;
  }
  const tokenList = [...tokens].sort();
  const tokenCss: string[] = [];
  if (tokenList.length > 0) {
    tokenCss.push(`:root {\n${tokenList.map((t) => `  ${t}: ${kit.light.get(t)};`).join('\n')}\n}`);
    const dark = tokenList.filter((t) => kit.dark.has(t));
    if (dark.length > 0) tokenCss.push(`@media (prefers-color-scheme: dark) {\n  :root {\n${dark.map((t) => `    ${t}: ${kit.dark.get(t)};`).join('\n')}\n  }\n}`);
  }

  const before = files[target] ?? '';
  const content = `${before.replace(/\s*$/, '')}\n\n${KIT_RESTORE_MARKER}\n${[...tokenCss, ...pieces].join('\n')}\n`;
  const stillMissing = new Set(findUndefinedClasses({ ...files, [target]: content }));
  const restored = [...needed].filter((c) => !stillMissing.has(c)).sort();
  if (restored.length === 0) return null;
  return { path: target, content, restored, tokens: tokenList };
}

/** The admin line for `DESIGN_KIT_RESTORED`. PURE. */
export function kitRestoreNote(patch: KitRestorePatch, when: 'before-repair' | 'after-repair'): string {
  const shown = patch.restored.slice(0, 12).map((c) => `.${c}`).join(', ');
  const more = patch.restored.length > 12 ? ` and ${patch.restored.length - 12} more` : '';
  const tok = patch.tokens.length ? ` plus ${patch.tokens.length} design token(s) they read` : '';
  const why = when === 'after-repair'
    ? 'The repair used design-kit classes this app\'s stylesheet no longer contained'
    : 'The screens use design-kit classes this app\'s stylesheet does not contain';
  return `${why}; their kit rules were added to ${patch.path} (${shown}${more}${tok}) — the kit's own rules, no model call, no class the app styles itself was touched.`;
}
