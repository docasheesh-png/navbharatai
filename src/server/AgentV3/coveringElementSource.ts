// WHERE IN THE SOURCE IS THE ELEMENT THAT COVERS A CONTROL? (Q-2915, failedbr #2475 aba63ead, 2026-11-19)
//
// 🔴 WHAT HAPPENED. The click explorer found "Move to Mumbai" and "Move to Ahmedabad" COVERED — "button.absolute is on
// top of it". That name is a tag and the FIRST class token: dozens of elements in a Tailwind app are `button.absolute`.
// The repair pass then spent its 150 s budget hunting: it read App.tsx, MiniMap.tsx, WorldMap.tsx, index.css and
// VirtualJoystick.tsx, grepped for the labels, and delegated — and the pass was undone (EXPLORE_REPAIR_UNDONE). The
// browser KNEW exactly which element it was; only a five-word name reached the repair.
//
// 🧬 THE FIX. The explorer now records the covering element's own fingerprint — all of its class tokens, its visible
// text and its aria-label (clickExplorer.ts `coveredBy`). This module finds that fingerprint in the project's files
// deterministically (no model call) and names file:line, so the repair opens the right place first. When the
// fingerprint matches nowhere, or matches too many places to tell, it says nothing: a wrong location is worse than none.
// PURE.

export interface CovererFingerprint {
  /** The short name already shown to people, e.g. `button.absolute`. */
  name?: string;
  /** Every class token of the covering element, in order. */
  classes?: string[];
  /** Its visible text, trimmed. */
  text?: string;
  ariaLabel?: string;
  /** Its tag, lower-case. */
  tag?: string;
}

export interface CovererLocation { path: string; line: number; why: string }

const SOURCE_FILE = /\.(?:tsx|jsx|vue|svelte|astro|html?)$/i;
const SKIP_PATH = /(^|\/)(?:node_modules|dist|build|\.next|coverage)\//;
/** Utility classes so common that matching them says nothing about WHICH element it is. */
const GENERIC_CLASS = /^(?:absolute|relative|fixed|sticky|static|flex|grid|block|inline|hidden|inset-0|top-0|left-0|right-0|bottom-0|w-full|h-full|z-\d+|p-\d+|px-\d+|py-\d+|m-\d+|mx-auto|rounded(?:-\w+)?|border|shadow(?:-\w+)?|text-\w+|bg-\w+(?:-\d+)?|items-center|justify-center|gap-\d+|transition|cursor-pointer)$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Up to `max` source locations for the covering element, best first, or [] when it cannot be told. A location needs
 * either its exact visible text / aria-label as a literal, or at least two of its DISTINCTIVE class tokens on one line.
 * More than `max` equally good matches ⇒ [] (ambiguous; naming one would be a guess). PURE.
 */
export function locateCoveringElement(fp: CovererFingerprint | null | undefined, files: Record<string, string>, max = 3): CovererLocation[] {
  if (!fp) return [];
  const text = String(fp.text ?? '').replace(/\s+/g, ' ').trim();
  const aria = String(fp.ariaLabel ?? '').trim();
  const distinctive = (fp.classes ?? []).map((c) => String(c).trim()).filter((c) => c && !GENERIC_CLASS.test(c)).slice(0, 8);
  const tag = String(fp.tag ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const found: Array<CovererLocation & { score: number }> = [];
  for (const [path, content] of Object.entries(files ?? {})) {
    if (!SOURCE_FILE.test(path) || SKIP_PATH.test(path) || typeof content !== 'string') continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let score = 0;
      const why: string[] = [];
      if (text.length >= 2 && text.length <= 60 && new RegExp(`(?:>|['"\`])\\s*${escapeRe(text)}\\s*(?:<|['"\`])`).test(line)) { score += 3; why.push(`its text "${text}"`); }
      if (aria && new RegExp(`aria-label\\s*=\\s*\\{?\\s*['"\`]${escapeRe(aria)}['"\`]`).test(line)) { score += 3; why.push(`its aria-label "${aria}"`); }
      const hits = distinctive.filter((c) => new RegExp(`(?:^|[\\s'"\`])${escapeRe(c)}(?=[\\s'"\`]|$)`).test(line));
      if (hits.length >= 2) { score += hits.length; why.push(`its classes ${hits.join(' ')}`); }
      if (score === 0) continue;
      if (tag && new RegExp(`<${escapeRe(tag)}\\b`, 'i').test(line)) score += 1;
      found.push({ path, line: i + 1, why: why.join(' and '), score });
    }
  }
  if (found.length === 0) return [];
  found.sort((a, b) => b.score - a.score);
  const best = found[0].score;
  const top = found.filter((f) => f.score === best);
  if (top.length > max) return [];
  return found.slice(0, max).filter((f) => f.score >= Math.max(2, best - 1)).map(({ path, line, why }) => ({ path, line, why }));
}

/** The sentence a repair reads, or '' when nothing was located. PURE. */
export function covererLocationSentence(locs: readonly CovererLocation[]): string {
  if (!locs.length) return '';
  const first = locs[0];
  const more = locs.length > 1 ? ` (also possible: ${locs.slice(1).map((l) => `${l.path}:${l.line}`).join(', ')})` : '';
  return ` The element on top is most likely at ${first.path}:${first.line} — matched by ${first.why}${more}. Start there.`;
}
