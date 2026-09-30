// AgentV3 — WHICH SCAFFOLDS SHIP THE DESIGN KIT, answered by the scaffolds themselves.
//
// 🎨 WHY (admin 2026-09-30: "app/game ek dam simple se html bante hai"). The fast lane, where most small
// apps are built, was told to make the app "look professionally designed" and never told that the
// project ALREADY carries a designed kit. So every per-file call invented its own class names
// (`.app`, `.todo-list`, `.input-row`), the stylesheet that was meant to style them is the lane's last
// and most deferrable file, and the screens shipped on the bare element layer — the plain-HTML look.
// Naming the kit's classes fixes that, but ONLY where the kit is really in the project: telling a Remix
// or Lit build to write `.card` would give it class names with nothing behind them, which is worse
// than plain markup because it also looks intentional.
//
// 🔒 NO HAND-WRITTEN LIST. The architect prompt carries a prose list of kit scaffolds, and a list in
// prose drifts the day a provider changes. This asks the registry: a framework ships the kit when the
// files its provider emits contain the kit's own stylesheet. Computed once, lazily.

import { TemplateRegistry } from './sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { DESIGN_KIT_CSS } from './sandbox/AppMakerLab/generator/templates/designKit';

/** A slice of the kit no provider could contain by accident: its first recipe rule. */
const KIT_SIGNATURE = DESIGN_KIT_CSS.slice(DESIGN_KIT_CSS.indexOf('.nb-table-wrap'), DESIGN_KIT_CSS.indexOf('.nb-table-wrap') + 60);

let cache: ReadonlySet<string> | null = null;

/** Every TemplateRegistry id whose scaffold carries the design kit. PURE apart from the one-time cache. */
export function frameworksShippingDesignKit(): ReadonlySet<string> {
  if (cache) return cache;
  const registry = new TemplateRegistry();
  const out = new Set<string>();
  for (const id of registry.listFrameworks()) {
    try {
      const files = registry.getProvider(id).getFiles([]);
      if (Object.values(files).some((c) => typeof c === 'string' && c.includes(KIT_SIGNATURE))) out.add(id);
    } catch { /* a provider that cannot emit its files ships nothing — never the kit */ }
  }
  cache = out;
  return out;
}

/**
 * Does a build on `framework` start from a scaffold that carries the kit? An empty or unknown id means
 * the default scaffold (Vite + React), exactly as the sandbox resolves it.
 */
export function frameworkShipsDesignKit(framework?: string | null): boolean {
  const raw = String(framework ?? '').trim().toLowerCase();
  const set = frameworksShippingDesignKit();
  if (!raw || raw === 'react' || raw === 'auto') return set.has('vite-react');
  if (raw === 'next') return set.has('nextjs');
  return set.has(raw);
}
