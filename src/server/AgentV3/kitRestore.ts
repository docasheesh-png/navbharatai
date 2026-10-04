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
import { collectDefinedClasses, collectUsedClasses, findUndefinedClasses, isProjectStylesheet } from './CssConsistency';

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

// ─── THE PREVENTION HALF: a rewrite of the stylesheet keeps the kit rules it did not restyle ───────
//
// `kitRestorePatch` repairs the app AFTER the kit was lost. This stops it being lost: the architect (or
// the fast lane) replacing the global stylesheet wholesale is the moment the kit disappears, and the
// write door is the one place every such write passes through — write_file, write_files_batch, and the
// fast lane, which writes via write_file. So at that door, when the file being replaced carried the kit
// and the new content drops kit rules without redefining their classes, those rules are carried over
// EXACTLY AS THE OLD FILE HAD THEM (a palette the app had already tuned stays tuned) and appended after
// the new content. The model's own rules come first and are never altered; a class it restyles is its.
// Kill switch: AGENTV3_KIT_KEEP=off.

/** Kill switch for the write-time half. Default ON. */
export function kitKeepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_KIT_KEEP ?? '').trim().toLowerCase() !== 'off';
}

/** Below this many kit rules, the old file did not carry the kit — it merely shares a class name. */
export const KIT_SIGNATURE_MIN = 5;

export const KIT_KEEP_MARKER = '/* NavBharatAI design kit — rules this rewrite dropped, kept as they were */';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

let kitPreludeCache: { top: Set<string>; media: Map<string, Set<string>> } | null = null;
function kitPreludes(): { top: Set<string>; media: Map<string, Set<string>> } {
  if (kitPreludeCache) return kitPreludeCache;
  const kit = parsedKit();
  kitPreludeCache = {
    top: new Set(kit.rules.map((r) => norm(r.prelude))),
    media: new Map(kit.media.map((m) => [norm(m.prelude), new Set(m.rules.map((r) => norm(r.prelude)))])),
  };
  return kitPreludeCache;
}

/**
 * Does this stylesheet carry the design kit — at least `KIT_SIGNATURE_MIN` of its rules?
 *
 * The same threshold `keepKitOnRewrite` uses to decide a stylesheet "had the kit", so the two can never
 * disagree about which file the kit lives in. PURE; never throws.
 */
export function stylesheetCarriesKit(css: string): boolean {
  if (typeof css !== 'string' || !css.trim()) return false;
  const { top } = kitPreludes();
  let n = 0;
  for (const b of parseCssBlocks(css)) {
    if (!b.prelude.startsWith('@') && top.has(norm(b.prelude)) && ++n >= KIT_SIGNATURE_MIN) return true;
  }
  return false;
}

export interface KitKeep {
  /** The content to write: the new content unchanged, plus the kit rules it dropped. */
  content: string;
  /** Kit classes the rewrite would have left without a rule, now kept. */
  kept: string[];
  /** Design tokens carried over because the kept rules read them and the new content never sets them. */
  tokens: string[];
}

/**
 * The content a rewrite of a stylesheet should really write, or null when nothing needs keeping. PURE.
 * `before` is the file being replaced, `after` the new content the model sent.
 */
export function keepKitOnRewrite(path: string, before: string, after: string, env: NodeJS.ProcessEnv = process.env): KitKeep | null {
  if (!kitKeepEnabled(env)) return null;
  if (!isProjectStylesheet(path) || /\.sass$/.test(path)) return null;
  if (typeof before !== 'string' || typeof after !== 'string' || !before.trim() || !after.trim()) return null;

  const { top, media } = kitPreludes();
  const beforeBlocks = parseCssBlocks(before);
  const keptTop = beforeBlocks.filter((b) => !b.prelude.startsWith('@') && top.has(norm(b.prelude)));
  const keptMedia: { prelude: string; rules: CssBlock[] }[] = [];
  for (const b of beforeBlocks) {
    const inner = /^@media\b/.test(b.prelude) ? media.get(norm(b.prelude)) : undefined;
    if (!inner) continue;
    const rules = parseCssBlocks(b.body).filter((r) => inner.has(norm(r.prelude)));
    if (rules.length > 0) keptMedia.push({ prelude: b.prelude, rules });
  }
  if (keptTop.length + keptMedia.reduce((n, m) => n + m.rules.length, 0) < KIT_SIGNATURE_MIN) return null;

  const { defined: afterDefined } = collectDefinedClasses({ [path]: after });
  const hadKit = new Set<string>();
  for (const r of [...keptTop, ...keptMedia.flatMap((m) => m.rules)]) for (const c of classesIn(r.prelude)) hadKit.add(c);
  const needed = new Set([...hadKit].filter((c) => !afterDefined.has(c)));
  if (needed.size === 0) return null;

  const pieces: string[] = [];
  for (const r of keptTop) if (takeRule(r.prelude, needed, afterDefined)) pieces.push(`${r.prelude} {${r.body}}`);
  for (const m of keptMedia) {
    const inner = m.rules.filter((r) => takeRule(r.prelude, needed, afterDefined));
    if (inner.length > 0) pieces.push(`${m.prelude} {\n${inner.map((r) => `  ${r.prelude} {${r.body}}`).join('\n')}\n}`);
  }
  if (pieces.length === 0) return null;

  // Keyframes and tokens come from the OLD file first (the app's own tuned values), the kit second.
  const kit = parsedKit();
  const beforeKeyframes = new Map<string, string>();
  const beforeLight = new Map<string, string>();
  const beforeDark = new Map<string, string>();
  for (const b of beforeBlocks) {
    if (/^@keyframes\s+/.test(b.prelude)) beforeKeyframes.set(b.prelude.replace(/^@keyframes\s+/, '').trim(), `${b.prelude} {${b.body}}`);
    else if (b.prelude === ':root') for (const [k, v] of tokenDecls(b.body)) beforeLight.set(k, v);
    else if (/^@media\b/.test(b.prelude) && /prefers-color-scheme:\s*dark/.test(b.prelude)) {
      for (const r of parseCssBlocks(b.body)) if (r.prelude === ':root') for (const [k, v] of tokenDecls(r.body)) beforeDark.set(k, v);
    }
  }
  for (const name of new Set([...kit.keyframes.keys(), ...beforeKeyframes.keys()])) {
    if (!pieces.some((p) => new RegExp(`\\b${name}\\b`).test(p))) continue;
    if (new RegExp(`@keyframes\\s+${name}\\b`).test(after)) continue;
    const block = beforeKeyframes.get(name) ?? kit.keyframes.get(name);
    if (block) pieces.push(block);
  }
  const lightOf = (t: string) => beforeLight.get(t) ?? kit.light.get(t);
  const darkOf = (t: string) => beforeDark.get(t) ?? kit.dark.get(t);
  const declaredInAfter = (t: string) => new RegExp(`${t.replace(/-/g, '\\-')}\\s*:`).test(after);
  const tokens = new Set<string>();
  let frontier = varsUsedIn(pieces.join('\n'));
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const t of frontier) {
      const value = lightOf(t);
      if (tokens.has(t) || declaredInAfter(t) || value === undefined) continue;
      tokens.add(t);
      for (const v of varsUsedIn(value)) next.add(v);
    }
    frontier = next;
  }
  const tokenList = [...tokens].sort();
  const tokenCss: string[] = [];
  if (tokenList.length > 0) {
    tokenCss.push(`:root {\n${tokenList.map((t) => `  ${t}: ${lightOf(t)};`).join('\n')}\n}`);
    const dark = tokenList.filter((t) => darkOf(t) !== undefined);
    if (dark.length > 0) tokenCss.push(`@media (prefers-color-scheme: dark) {\n  :root {\n${dark.map((t) => `    ${t}: ${darkOf(t)};`).join('\n')}\n  }\n}`);
  }

  const content = `${after.replace(/\s*$/, '')}\n\n${KIT_KEEP_MARKER}\n${[...tokenCss, ...pieces].join('\n')}\n`;
  const { defined: nowDefined } = collectDefinedClasses({ [path]: content });
  const kept = [...needed].filter((c) => nowDefined.has(c)).sort();
  if (kept.length === 0) return null;
  return { content, kept, tokens: tokenList };
}

/** What the model is told when its rewrite had kit rules put back. PURE. */
export function kitKeepToolNote(path: string, keep: KitKeep): string {
  const shown = keep.kept.slice(0, 10).map((c) => `.${c}`).join(', ');
  const more = keep.kept.length > 10 ? ` and ${keep.kept.length - 10} more` : '';
  return `\nℹ️ DESIGN KIT KEPT: this rewrite of ${path} dropped the design kit's rules for ${keep.kept.length} class(es) `
    + `(${shown}${more}) without restyling them, so they were appended after your content unchanged — screens `
    + 'that use them stay styled. Your own rules come first and were not altered. To restyle a kit class, write '
    + 'your own rule for it; to add styles, prefer edit_file and append rather than rewriting this file.';
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

// ── A class that LOOKS like the kit's and is not (write time) ──────────────────────────────────────

/**
 * 🔴 AUTOPSY 466c260a (2026-09-29). The builder wrote `DashboardShell` with `.nb-nav`, `.nb-nav-list`
 * and `.nb-page-title` — names in the kit's own `nb-` style, none of which the kit defines (it has
 * `.nb-sidebar`, `.nb-nav-item`, `.nb-topbar`), and no stylesheet the builder wrote defined them
 * either. The shell's navigation rendered unstyled, and nothing said so until the end-of-build check
 * (`CSS_CLASSES_UNDEFINED`), whose repair then ran inside a 255-second heal pass. Restoring kit rules
 * cannot help — there is no kit rule to restore for a name the kit never had.
 *
 * So the builder is told AT WRITE TIME, with the file still open: these `nb-` names are not kit
 * classes and nothing defines them; define them now, or use the kit's. Only `nb-` names are judged —
 * that prefix is the kit's, so a name carrying it is a claim about the kit that can be checked
 * exactly. An app's own naming (`.card-title`) is its own business and is left to the end-of-build
 * check. PURE — the caller supplies the project's stylesheets it could read.
 */
export function inventedKitClasses(content: string, path: string, stylesheets: Record<string, string>): string[] {
  if (!/\.(?:t|j)sx?$/.test(path)) return [];
  const kit = kitClasses();
  const used = [...collectUsedClasses({ [path]: content })].filter((c) => c.startsWith('nb-') && !kit.has(c));
  if (used.length === 0) return [];
  const { defined } = collectDefinedClasses(stylesheets);
  return used.filter((c) => !defined.has(c)).sort();
}

/**
 * Is this class the KIT's to put back — an `nb-` name the kit really defines? PURE.
 *
 * 🔴 THE ONE ANSWER TO "MAY A CLASS CHECK SKIP THIS NAME?" (autopsy 2f723acb, 2026-10-01). The end-of-turn
 * style check skipped EVERY `nb-` class as "left to the kit", so it handed the model 2 classes
 * (`.badge-soft`, `.text-muted`) while 17 invented ones (`.nb-demo-roles`, `.nb-option-key`, …) that the
 * kit has never had went unmentioned, and the end-of-build check then spent a 95-second repair pass on
 * them. Only a name the kit DEFINES is restored by `kitRestorePatch`; an invented `nb-` name has no kit
 * rule to restore and must be reported like any other undefined class.
 */
export function leftToTheKit(className: string): boolean {
  return typeof className === 'string' && className.startsWith('nb-') && kitClasses().has(className);
}

/** Fast pre-check (no I/O): does this file use an `nb-` class the kit does not have? PURE. */
export function usesNonKitNbClass(content: string, path: string): boolean {
  return inventedKitClasses(content, path, {}).length > 0;
}

/** The note handed back with the write. '' when there is nothing to say. PURE. */
export function inventedKitClassNote(path: string, invented: readonly string[]): string {
  if (invented.length === 0) return '';
  const shown = invented.slice(0, 8).map((c) => {
    const real = nearestKitClass(c);
    return real ? `.${c} (the kit has .${real})` : `.${c}`;
  }).join(', ');
  return `\n⚠️ ${path} uses ${shown} — these look like design-kit classes but the kit does not define them, and no stylesheet does either, so those elements render UNSTYLED. `
    + 'Switch to the kit class named beside each one, or add their rules to src/index.css now. The kit\'s own classes include .nb-shell, .nb-sidebar, .nb-nav-item, .nb-topbar, .nb-hero, .nb-empty, .card, .btn-primary, and for a game .nb-game, .nb-game-hud, .nb-game-stat, .nb-game-btn, .nb-game-screen.';
}

/**
 * The kit class an invented `nb-` name almost certainly meant (autopsy 0bb437b4, 2026-09-30): the
 * racing game's screen used `.nb-hud` beside a kit that defines `.nb-game-hud`. The write-time note
 * fired, listed the kit's APP classes, and the model — building a game — kept its own name; a heal
 * after the build then spent 55 s restyling it. Naming the real class makes the right edit a rename.
 * A kit class qualifies when it carries every word of the invented name; the shortest wins, and a tie
 * names nothing (a guess between two is not a fact). PURE.
 */
export function nearestKitClass(invented: string): string | null {
  const words = String(invented ?? '').toLowerCase().split('-').filter((w) => w && w !== 'nb');
  if (words.length === 0) return null;
  const hits = [...kitClasses()].filter((k) => {
    const kw = new Set(k.split('-'));
    return words.every((w) => kw.has(w));
  });
  if (hits.length === 0) return null;
  const min = Math.min(...hits.map((h) => h.length));
  const best = hits.filter((h) => h.length === min);
  return best.length === 1 ? best[0] : null;
}

let kitBlockKeys: Set<string> | null = null;
/** Every top-level kit block, keyed by its normalised prelude AND body. */
function kitBlockSet(): Set<string> {
  if (kitBlockKeys) return kitBlockKeys;
  kitBlockKeys = new Set(parseCssBlocks(DESIGN_KIT_CSS).map((b) => `${norm(b.prelude)}{${norm(b.body)}}`));
  return kitBlockKeys;
}

/**
 * The APP's part of a stylesheet that carries the design kit: every top-level block that is not, byte for
 * byte after whitespace, a block of the kit. A kit rule the app CHANGED stays (it is the app's now). Null
 * when the stylesheet does not carry the kit (then all of it is the app's). PURE.
 *
 * 🔴 WHY (autopsy 0473628e). The builder appended its music player's rules to `src/index.css`, which holds
 * our 897-line kit. The file was then too big to hand to the lean review in full, so the review lost its
 * one-call, no-tools mode, read files one tool call at a time and timed out after 45 s with no verdict —
 * our own template costing the review again (the 8257ca59 class), this time through a file the build
 * legitimately edited. The review is about what the BUILD wrote; the kit is ours and is checked elsewhere.
 */
export function appOwnStylesheet(css: string): string | null {
  if (typeof css !== 'string' || !stylesheetCarriesKit(css)) return null;
  const kit = kitBlockSet();
  const own = parseCssBlocks(css).filter((b) => !kit.has(`${norm(b.prelude)}{${norm(b.body)}}`));
  return own.map((b) => `${b.prelude} {${b.body}}`).join('\n');
}
