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
// that was appended after a parseable tsconfig, and add `"jsx": "react-jsx"` when a DOM/app tsconfig
// is missing a jsx flag (TS17004). Both are conservative — they no-op on unparseable JSONC, on a
// Node-only tsconfig, and on an already-set jsx value.

import { stripTrailingConflictMarkup } from './conflictMarkerGuard';
import { parseTsconfigJsonc } from './FrameworkFoundation';

/** True for a tsconfig filename: tsconfig.json / tsconfig.*.json (any directory), but NOT tsconfig.node.json. */
export function isTsconfigPath(path: string): boolean {
  const p = (path || '').trim();
  if (/(^|\/)tsconfig\.node\.json$/.test(p)) return false; // the vite-config project — no app sources, no baseUrl
  return /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p);
}

/**
 * Drop leftover apply-patch / merge-conflict markup that was appended after a parseable tsconfig
 * (BR1982). Only the trailing marker block is removed, and only when the prefix is strict JSON —
 * a commented/JSON5 tsconfig is left untouched (same caution as ensureTsconfigBaseUrl). Pure.
 */
export function healTsconfigConflictTail(path: string, content: string): string {
  if (!isTsconfigPath(path)) return content;
  const src = content ?? '';
  const cut = stripTrailingConflictMarkup(src);
  if (!cut.stripped) return src;
  // JSONC (comments / trailing commas) is accepted here so this report's exact Vite-style
  // tsconfig — which has block comments — can be salvaged. The prefix is returned as-is.
  if (!parseTsconfigJsonc(cut.content)) return src;
  return cut.content;
}

/** True when compilerOptions.lib names the DOM (an app/browser tsconfig, not a Node-only one). */
function tsconfigHasDomLib(co: Record<string, unknown>): boolean {
  const lib = co.lib;
  if (!Array.isArray(lib)) return false;
  return lib.some((item) => typeof item === 'string' && /^dom(\b|\.|$)/i.test(item.trim()));
}

/**
 * Guarantee `"jsx": "react-jsx"` on a parseable DOM/app tsconfig that is missing a jsx flag
 * (BR1982 — a model-written tsconfig compiled TSX with TS17004).
 *
 * Only ADDS the flag when it is absent. An existing jsx value (preserve, react, react-jsx, …)
 * is never overwritten. A Node tsconfig (no DOM lib) is left alone. A Vue-flavoured
 * `jsxImportSource` is left alone. An unparseable file is left alone. Adding the flag
 * rewrites the file as strict JSON (comments in a JSONC tsconfig are not preserved) —
 * only in that add case. Pure.
 */
export function ensureTsconfigJsx(path: string, content: string): string {
  if (!isTsconfigPath(path)) return content;
  const src = content ?? '';
  const cfg = parseTsconfigJsonc(src);
  if (!cfg) return src;
  const co = (cfg.compilerOptions && typeof cfg.compilerOptions === 'object' && !Array.isArray(cfg.compilerOptions))
    ? (cfg.compilerOptions as Record<string, unknown>)
    : null;
  if (!co) return src;
  if ('jsx' in co) return src;
  const origin = typeof co.jsxImportSource === 'string' ? co.jsxImportSource : '';
  if (/vue/i.test(origin)) return src;
  if (!tsconfigHasDomLib(co)) return src;
  co.jsx = 'react-jsx';
  cfg.compilerOptions = co;
  try {
    const out = `${JSON.stringify(cfg, null, 2)}\n`;
    JSON.parse(out);
    return out;
  } catch { return src; }
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
