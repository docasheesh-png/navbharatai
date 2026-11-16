// AgentV3 — deterministic guarantee that a rewritten tsconfig keeps the baseUrl-"src" resolution.
//
// WHY (protects #1305 from regression): the vite-react scaffold ships `baseUrl: "src"` + a `@/*` path so
// the baseUrl-"src" import convention LLMs emit (`from 'stores/useBoardStore'`, `from '@/components/Button'`)
// resolves — without it the build hit TS2307 "Cannot find module" for files that existed (the Kanban class).
// But a build often lets the model REWRITE tsconfig.json (to add a lib, a plugin, strictness), and a full
// rewrite can silently DROP baseUrl/paths — re-opening the exact class the scaffold fix closed. This is the
// deterministic backstop, mirroring ViteConfigGuard: a PURE transform that restores the scaffold default
// ONLY when a tsconfig has NEITHER baseUrl NOR paths (i.e. the model wiped the resolution config). If the
// author set EITHER, we respect it and no-op — never fight a deliberate configuration.
//
// BR1982 also lands two sibling backstops on the same write door: drop leftover apply-patch markup
// that was appended after a parseable tsconfig, and — only when the app is clearly React — insert
// `"jsx": "react-jsx"` into a DOM/app tsconfig that is missing a jsx flag (TS17004). The jsx heal
// never rewrites the file with JSON.stringify (comments stay), and when the React evidence is
// missing or the file looks like Next / Vue / Solid / Preact / an `extends` child, it leaves the
// file alone so TS17004 stays visible.

import { stripTrailingConflictMarkup } from './conflictMarkerGuard';
import { parseTsconfigJsonc } from './FrameworkFoundation';

/** Optional evidence that the project is a React app. Pure callers pass this in; no I/O. */
export interface TsconfigJsxContext {
  framework?: string | null;
  packageJson?: string | null;
}

const REACT_FRAMEWORKS = new Set(['vite-react', 'remix', 'react']);
const NON_REACT_FRAMEWORKS = new Set([
  'nextjs', 'next', 'vue', 'nuxt', 'solid', 'preact', 'svelte', 'sveltekit', 'angular', 'astro', 'vanilla', 'static',
]);
const NON_REACT_PACKAGES = [
  'next', 'vue', 'nuxt', '@vitejs/plugin-vue', 'solid-js', 'solid-start', 'vite-plugin-solid',
  'preact', '@preact/preset-vite',
];

/** True for a tsconfig filename: tsconfig.json / tsconfig.*.json (any directory), but NOT tsconfig.node.json. */
export function isTsconfigPath(path: string): boolean {
  const p = (path || '').trim();
  if (/(^|\/)tsconfig\.node\.json$/.test(p)) return false; // the vite-config project — no app sources, no baseUrl
  return /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p);
}

/**
 * Drop leftover apply-patch / merge-conflict markup that was appended after a parseable tsconfig
 * (BR1982). Only the trailing marker block is removed, and only when the prefix is parseable JSONC
 * — an unparseable prefix is left untouched (a wrong cut is worse). The prefix is returned as-is,
 * comments included. Pure.
 */
export function healTsconfigConflictTail(path: string, content: string): string {
  if (!isTsconfigPath(path)) return content;
  const src = content ?? '';
  const cut = stripTrailingConflictMarkup(src);
  if (!cut.stripped) return src;
  if (!parseTsconfigJsonc(cut.content)) return src;
  return cut.content;
}

/** True when compilerOptions.lib names the DOM (an app/browser tsconfig, not a Node-only one). */
function tsconfigHasDomLib(co: Record<string, unknown>): boolean {
  const lib = co.lib;
  if (!Array.isArray(lib)) return false;
  return lib.some((item) => typeof item === 'string' && /^dom(\b|\.|$)/i.test(item.trim()));
}

function hasNextPlugin(co: Record<string, unknown>): boolean {
  const plugins = co.plugins;
  if (!Array.isArray(plugins)) return false;
  return plugins.some((item) =>
    !!item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as { name?: unknown }).name === 'string'
    && /^(next)$/i.test((item as { name: string }).name.trim()),
  );
}

function packageDepNames(raw: string): Set<string> | null {
  const parsed = parseTsconfigJsonc(raw);
  if (!parsed) {
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return packageDepNamesFrom(v as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  return packageDepNamesFrom(parsed);
}

function packageDepNamesFrom(pkg: Record<string, unknown>): Set<string> {
  const bag = {
    ...((pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) ? pkg.dependencies as Record<string, unknown> : {}),
    ...((pkg.devDependencies && typeof pkg.devDependencies === 'object' && !Array.isArray(pkg.devDependencies)) ? pkg.devDependencies as Record<string, unknown> : {}),
    ...((pkg.peerDependencies && typeof pkg.peerDependencies === 'object' && !Array.isArray(pkg.peerDependencies)) ? pkg.peerDependencies as Record<string, unknown> : {}),
  };
  return new Set(Object.keys(bag).map((k) => k.toLowerCase()));
}

/**
 * True only when the evidence says this is a React app — a vite-react / remix / react scaffold,
 * or a package.json that declares react and does not declare Next / Vue / Solid / Preact.
 * Package.json disqualifiers win over a framework label. When the evidence is missing or mixed,
 * this is false (leave the tsconfig alone). Pure.
 */
export function isClearlyReactApp(ctx?: TsconfigJsxContext | null): boolean {
  if (!ctx) return false;
  const names = typeof ctx.packageJson === 'string' && ctx.packageJson.trim()
    ? packageDepNames(ctx.packageJson)
    : null;
  if (names) {
    if (NON_REACT_PACKAGES.some((pkg) => names.has(pkg))) return false;
    if (names.has('react') || names.has('react-dom')) return true;
  }
  const fw = (ctx.framework || '').trim().toLowerCase();
  if (!fw) return false;
  if (NON_REACT_FRAMEWORKS.has(fw)) return false;
  return REACT_FRAMEWORKS.has(fw);
}

/**
 * Insert `"jsx": "react-jsx"` immediately inside `compilerOptions` without rewriting the rest of
 * the file, so JSONC comments stay. Returns null when the insertion cannot be verified. Pure.
 */
function insertJsxReactJsx(src: string): string | null {
  const match = src.match(/"compilerOptions"\s*:\s*\{/);
  if (!match || match.index == null) return null;
  const at = match.index + match[0].length;
  const out = `${src.slice(0, at)}\n    "jsx": "react-jsx",${src.slice(at)}`;
  const parsed = parseTsconfigJsonc(out);
  const co = parsed?.compilerOptions;
  if (!co || typeof co !== 'object' || Array.isArray(co)) return null;
  if ((co as Record<string, unknown>).jsx !== 'react-jsx') return null;
  return out;
}

/**
 * Add `"jsx": "react-jsx"` to a clearly-React DOM/app tsconfig that is missing a jsx flag
 * (BR1982 — a model-written Vite React tsconfig compiled TSX with TS17004).
 *
 * Only ADDS the flag, by insertion, never by JSON.stringify, so comments stay. Skips — so
 * TS17004 stays visible — when the app is not clearly React, when `extends` or any
 * `jsxImportSource` is set, when `compilerOptions.plugins` includes `{name:'next'}`, when
 * an existing jsx value is present, when the tsconfig is Node-only, or when the insertion
 * cannot be verified. Pure.
 */
export function ensureTsconfigJsx(path: string, content: string, ctx?: TsconfigJsxContext): string {
  if (!isTsconfigPath(path)) return content;
  const src = content ?? '';
  if (!isClearlyReactApp(ctx)) return src;
  const cfg = parseTsconfigJsonc(src);
  if (!cfg) return src;
  if (cfg.extends != null) return src;
  const co = (cfg.compilerOptions && typeof cfg.compilerOptions === 'object' && !Array.isArray(cfg.compilerOptions))
    ? (cfg.compilerOptions as Record<string, unknown>)
    : null;
  if (!co) return src;
  if ('jsx' in co) return src;
  if (typeof co.jsxImportSource === 'string' && co.jsxImportSource.trim()) return src;
  if (hasNextPlugin(co)) return src;
  if (!tsconfigHasDomLib(co)) return src;
  return insertJsxReactJsx(src) ?? src;
}

/**
 * Return `content` with a guaranteed `compilerOptions.baseUrl: "src"` + `paths: { "@/*": ["*"] }` for a
 * tsconfig that has NEITHER — or unchanged when it is not a tsconfig, already configures baseUrl or paths,
 * or is not strict-parseable JSON (a commented/JSON5 tsconfig is left untouched — a wrong edit is worse).
 * PURE & deterministic.
 */
export function ensureTsconfigBaseUrl(path: string, content: string): string {
  if (!isTsconfigPath(path)) return content;
  const src = content ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(src); } catch { return src; } // comments / trailing commas → don't risk an edit
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return src;
  const cfg = parsed as Record<string, unknown>;
  const co = (cfg.compilerOptions && typeof cfg.compilerOptions === 'object' && !Array.isArray(cfg.compilerOptions))
    ? (cfg.compilerOptions as Record<string, unknown>)
    : null;
  if (!co) return src; // no compilerOptions object we can safely extend
  // Respect any deliberate resolution config — only restore the scaffold default when BOTH are absent.
  if ('baseUrl' in co || 'paths' in co) return src;
  co.baseUrl = 'src';
  co.paths = { '@/*': ['*'] };
  cfg.compilerOptions = co;
  try {
    const out = `${JSON.stringify(cfg, null, 2)}\n`;
    JSON.parse(out); // validate the rewrite re-parses before returning
    return out;
  } catch { return src; }
}
