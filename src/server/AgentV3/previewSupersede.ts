// WHEN A NEW APP GOES LIVE ON A NEW PORT, THE OLD APP MUST ACTUALLY LEAVE.
//
// 🔒 ROOT CAUSE (admin 2026-08-25, with the build report as evidence). They built a UPI Payment API
// (Express, port 3000) in a workspace that had previously held a PIANO app (Vite, port 5173). The API
// was built correctly — the report proves it: framework `node-express`, endpoints curl-tested,
// `PREVIEW_PUBLISHED` at `https://3000-….e2b.app`. And the preview panel showed… the piano, at
// `https://5173-….e2b.app`, under a "React + Vite" badge. The admin reasonably concluded the engine
// had ignored the prompt entirely. It had not. THE PREVIOUS APP WAS STILL RUNNING.
//
// Three leftovers of the old app conspired, and every one is per-WORKSPACE state that outlived the
// app it described — the same class as the live-URL leak fixed hours earlier (#2658), one layer down:
//
//   1. The RESUMED sandbox still had the piano's Vite server alive on 5173. Nothing stops an old dev
//      server when a new app is built: the launcher pre-kills only its OWN target port.
//   2. The stored revival RECIPE still said port 5173 — it is only rewritten by a browser-verified
//      render, which an API that answers JSON never earns. So the preview door's sweep led with 5173,
//      found a genuinely answering server there (the piano), and 302'd to it with full confidence.
//      The verification worked perfectly; it verified the wrong app's liveness.
//   3. The stale client could still send `p=5173` as a hint — and a live listener on 5173 wins any
//      sweep, whatever the order.
//
// Killing the old server is therefore not optional hygiene — as long as it answers, EVERY honest
// probe will keep choosing it. The fix runs at the ONE moment we hold proof about the new app:
// `update_preview` has just verified the new port UP. At that instant, any KNOWN prior port for this
// workspace that differs from the new one belongs to the previous app: free it, and retire the recipe
// that pointed at it.
//
// 🔒 DELIBERATELY NARROW. Only ports this workspace's own records name (recipe port, declaredPort)
// are ever freed — never a swept or guessed list, so a port the app legitimately uses for a second
// process of ITS OWN (an API next to its frontend) is untouched unless our records called it the
// previous app's. Infrastructure ports (databases) are never freed, same rule as DevServerRecovery.

import type { PreviewRecipe } from './previewRevival';

/** Same set DevServerRecovery protects — a database is never "the old app". */
const PROTECTED_PORTS = new Set([5432, 3306, 6379, 27017, 1433, 9200]);

export interface SupersedeDecision {
  /** Ports to free — each one named by this workspace's own records and ≠ the new port. */
  staleports: number[];
  /** True when the stored recipe describes a different port and must be retired. */
  retireRecipe: boolean;
  /** One line for the diagnostics report, or '' when there was nothing to do. */
  note: string;
}

/**
 * What must be superseded now that `newPort` is verified UP for this workspace. PURE.
 *
 * `declaredPort` rides along for the same reason the recipe does: it is the other durable record that
 * can name the previous app's port, and the door reads both.
 */
export function decideSupersede(input: {
  newPort: number;
  recipe: PreviewRecipe | null;
  declaredPort?: number | null;
  /**
   * The port the APP'S OWN SOURCE says it serves on (`declaredPort.ts`), if it says anything.
   *
   * 🔴 THE ASSUMPTION THIS FIXES (admin build report 2026-09-10). The header above says this runs "at
   * the ONE moment we hold proof about the new app: `update_preview` has just verified the new port
   * UP." **A port being UP is not proof of IDENTITY.** A dev server left running by a PREVIOUS session
   * in a resumed sandbox answers exactly as convincingly as the app just built.
   *
   * What that cost, from the report: an imported Express app whose `server/index.ts` serves on 5000.
   * At minute 2 the agent called `update_preview :3000` — the framework DEFAULT, not the app's port —
   * a leftover answered there, `portReady` went true, and this function was handed `newPort: 3000`
   * with a recipe naming 5000. So it killed 5000: **the real app's own server**, to bless a leftover.
   * The narration even said so out loud, backwards — "a previous app was still serving on port 5000 —
   * superseded now that the current app is verified on port 3000". Twenty minutes of failing
   * screenshots and flailing followed, the agent eventually read `server/index.ts`, corrected itself at
   * minute 22, and the build hit its 30-minute cap eight minutes later.
   *
   * So the app's own declaration is now a VETO, not another port to free. Killing the port an app
   * declares it serves on can only ever be wrong: either it is the app (killing it is the bug above),
   * or the app is not up yet (killing it achieves nothing). It is deliberately only a veto — an app may
   * legitimately hold a second port of its own, and refusing to kill is always the safe direction.
   */
  sourceDeclaredPort?: number | null;
}): SupersedeDecision {
  const stale = new Set<number>();
  const declared = typeof input.sourceDeclaredPort === 'number' && Number.isInteger(input.sourceDeclaredPort)
    ? input.sourceDeclaredPort
    : null;
  const usable = (p: unknown): p is number =>
    typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536
    && p !== input.newPort && !PROTECTED_PORTS.has(p)
    // 🔒 THE VETO. Never free the port the app itself declares — see `sourceDeclaredPort`.
    && p !== declared;
  const recipePort = input.recipe?.port;
  if (usable(recipePort)) stale.add(recipePort);
  if (usable(input.declaredPort)) stale.add(input.declaredPort as number);
  /**
   * 🔒 AND THE RECIPE THAT AGREES WITH THE APP IS NOT "STALE" EITHER.
   *
   * Retiring it would replace a port the app CLAIMS with one it never mentioned — re-pointing the
   * preview door at the leftover for every later view, which is the half of the bug that outlived the
   * build. When the app's own source and the stored recipe agree, a third port that merely answers
   * does not get to overrule both.
   */
  const recipeMatchesApp = declared !== null && recipePort === declared && input.newPort !== declared;
  const retireRecipe = typeof recipePort === 'number' && recipePort !== input.newPort && !recipeMatchesApp;
  const staleports = [...stale];
  const note = staleports.length === 0 && !retireRecipe
    ? ''
    : `A previous app in this workspace was still ${staleports.length ? `serving on port ${staleports.join(', ')}` : 'described by the stored preview recipe'} — `
      + `superseded now that the current app is verified on port ${input.newPort}`
      + `${staleports.length ? ' (old server stopped' : ' ('}${retireRecipe ? `${staleports.length ? ', ' : ''}stale recipe retired` : ''}), `
      + 'so the preview can only ever show the app that was just built.';
  return { staleports, retireRecipe, note };
}
