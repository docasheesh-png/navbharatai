// WHICH HEADER TAB IS LIT WHILE A CHAT IS ON SCREEN — and which open views get no chip at all.
//
// Admin 2026-09-22: *"navbharatai me mode switch karne se header me new window/tab na create ho"*, and
// *"recent chat ke sabhi chat waise hi switch hone chahiye jaise multi window se hote hai"*. So the
// per-conversation chips the header carried since 2026-09-21 are gone, and switching between open chats
// moved into the Mode list's Recent group. What is left for the header to decide is small and pure:
//
//   • A view entered THROUGH a chat tab (Teacher AI from FREE's Mode button, the image studio from the
//     same button, an expert from the Professionals hub) lives INSIDE that tab. It gets no chip of its
//     own, and while it is on screen the tab it was entered through stays lit — the user is still "in
//     NavBharatAI FREE", just in a different mode of it.
//   • A view entered any other way (the image studio from Other Tools, from the ☰ menu) keeps the chip it
//     has today. The DOOR decides, and `tabOpeners` already records the door.
//
// The walk goes UP the openers: a professional opened from inside another professional is parented to
// the tab both were entered through (`parentForOpen`), so one step usually suffices; the loop and the
// `seen` guard are for a corrupted map, never for a designed chain.

import { isModeSurface } from '../components/chat/modePicker';

export type TabOpeners = Readonly<Record<string, string | undefined>>;

/**
 * Does `tab` live inside a chat tab — opened through the Mode button of a chat surface — and so must
 * not be drawn as a header chip of its own?
 */
export function insideChatTab(tab: string, openers: TabOpeners): boolean {
  const opener = openers[tab];
  return !!opener && isModeSurface(opener);
}

/** The open tabs the header must NOT draw: every one that lives inside a chat tab. */
export function hiddenHeaderTabs(openTabs: readonly string[], openers: TabOpeners): string[] {
  return openTabs.filter((t) => insideChatTab(t, openers));
}

/**
 * The header tab to light for the view on screen.
 *
 * Itself when it has its own visible chip; otherwise the tab it was entered through, walking up the
 * openers until a visible chip is found; otherwise itself — which lights nothing, exactly what the
 * header did before for a view with no chip (Doctor AI opened from Home, for one).
 *
 * `hasChip` is the header's own knowledge of which ids are registered menu items — the rule here does
 * not restate that list.
 */
export function headerTabFor(activeView: string, openers: TabOpeners, hasChip: (id: string) => boolean): string {
  const visible = (id: string) => hasChip(id) && !insideChatTab(id, openers);
  if (visible(activeView)) return activeView;
  const seen = new Set<string>();
  let parent = openers[activeView];
  while (parent && !seen.has(parent)) {
    if (visible(parent)) return parent;
    seen.add(parent);
    parent = openers[parent];
  }
  return activeView;
}
