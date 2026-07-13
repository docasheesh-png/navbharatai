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

/** True for a tsconfig filename: tsconfig.json / tsconfig.*.json (any directory), but NOT tsconfig.node.json. */
export function isTsconfigPath(path: string): boolean {
  const p = (path || '').trim();
  if (/(^|\/)tsconfig\.node\.json$/.test(p)) return false; // the vite-config project — no app sources, no baseUrl
  return /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(p);
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
