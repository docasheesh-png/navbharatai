/**
 * WHICH TABS BELONG TO ANOTHER TAB — so ✕-closing the parent takes its children with it.
 *
 * 🔒 THE BUG (admin, 2026-08-25): in NavBharatAI Free, pick a professional from Mode (Teacher, Doctor,
 * …), then ✕ the NavBharatAI tab in the header. The professional chat stayed open — orphaned, with no
 * visible parent, in a product where it is explicitly *part of* NavBharatAI Free.
 *
 * WHY. `App.tsx` recorded a parent link only when the LAUNCHING tab was Settings, Professionals or
 * Other-AI. A professional opened from `nbi_chat` matched none of those, so no link was written and
 * `computeTabClose` had nothing to follow.
 *
 * WHY NOT SIMPLY ADD `nbi_chat` TO THAT LIST — the fix that looks obvious and is wrong. The old rule
 * asks only "who opened this?". Add Free as a parent and EVERYTHING opened from Free becomes its
 * child, including Settings: open Settings from inside Free, close Free, and the user's Settings tab
 * vanishes with it. That is a new bug traded for the old one.
 *
 * So the question is asked about the CHILD instead. A professional AI chat is a surface you enter
 * *through* something and that belongs to it. Settings, Home and the v5.0 builder are destinations in
 * their own right — they are never anybody's child, whoever happened to open them.
 *
 * Pure + unit-tested.
 */
import { PROFESSIONAL_CHATS, PROFESSIONALS_IMPLEMENTED_ELSEWHERE } from '../components/professionals/professionalConfigs';

/**
 * The tabs that are always somebody's child.
 *
 * Derived from `PROFESSIONAL_CHATS`, never re-typed: that map is where a professional is DEFINED, so a
 * new one added there is parented correctly without anybody remembering this file exists. A hand-kept
 * copy would silently miss it, which is exactly the class of bug this fixes.
 */
export function childSurfaceIds(): string[] {
  return [...Object.keys(PROFESSIONAL_CHATS), ...PROFESSIONALS_IMPLEMENTED_ELSEWHERE];
}

/**
 * Is `view` a surface that belongs to whatever opened it?
 *
 * ⚠️ `nbi_pro_chat` (the v5.0 builder) is deliberately NOT one, even though it is listed beside the
 * professionals on the Professionals screen. It is a full workspace with its own preview tab, its own
 * files and a build that may be running — closing another tab must never take it down. It is reached
 * from many places and is a destination, not an option.
 */
export function isChildSurface(view: string): boolean {
  if (!view || view === 'nbi_pro_chat') return false;
  return childSurfaceIds().includes(view);
}

/** The tabs whose every launched option is a child (the original rule, unchanged). */
export const PARENT_SURFACES = ['settings', 'professionals', 'other_ai'] as const;

/**
 * Should opening `view` from `activeView` record a parent link? Pure.
 *
 * Either half is enough: an option launched from a parent surface (Settings → Wallet), or a child
 * surface launched from anywhere (Free → Teacher AI). A tab is never its own parent.
 */
export function shouldRecordOpener(view: string, activeView: string): boolean {
  if (!view || !activeView || view === activeView) return false;
  return (PARENT_SURFACES as readonly string[]).includes(activeView) || isChildSurface(view);
}

/**
 * WHICH TAB TO RECORD AS THE PARENT — the door the user came through, never the room next to it.
 *
 * 🔴 THE OTHER HALF OF THE 2026-09-20 BUG, and without it the subtree close in `tabClose.ts` trades
 * one bug for another.
 *
 * The opener was simply `activeView`. But the Mode sheet is reachable from INSIDE a professional, so
 * picking Teacher while Mentor is on screen recorded `teacher_ai → mentor_ai`: one professional as
 * another professional's PARENT. Two things follow, and both are wrong:
 *
 *   • closing NavBharatAI Free left Teacher behind, because Teacher hung off Mentor rather than Free
 *     — the admin's report; and
 *   • once the close walks the whole subtree, closing MENTOR alone would take Teacher down with it,
 *     which is a new bug, not a fix. The user never entered Teacher "through" Mentor.
 *
 * A professional is not a container. Mentor and Teacher are SIBLINGS you switch between through the
 * same door, so the new tab inherits its opener's door: walk up until a real parent is found, and
 * record that. Free → Mentor → Teacher now parents BOTH to Free, so no chain exists to walk.
 *
 * ⚠️ `undefined` when the walk cannot reach a non-child surface, rather than falling back to the
 * sibling: a child surface may never be recorded as a parent at all. That invariant is what makes
 * chains — and the cycles a chain can grow into — impossible by construction rather than by care.
 *
 * Pure.
 */
export function parentForOpen(
  view: string,
  activeView: string,
  openers: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  if (!shouldRecordOpener(view, activeView)) return undefined;
  let parent: string | undefined = activeView;
  const seen = new Set<string>();
  // A tab closed and reopened from what used to be its own child can leave a cycle behind; the guard
  // is what stops this walk becoming an infinite loop on a corrupted map.
  while (parent && isChildSurface(parent) && !seen.has(parent)) {
    seen.add(parent);
    parent = openers[parent];
  }
  if (!parent || parent === view || isChildSurface(parent)) return undefined;
  return parent;
}
