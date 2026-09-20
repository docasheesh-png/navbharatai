// THE ADMIN PANEL'S FOOTER IS ITS OWN TAB STRIP (admin 2026-09-20).
//
// 🔴 WHAT WAS WRONG, in the admin's words: *"jab admin panel open hota hai, to footer me yeh
// home|ai|preview|studio|more etc jo dikh rahe hai — isko badalna hai!! is footer me MONITOR, USERS,
// ai engine, revenue … jo abhi header me hai, unko rakho."* On a phone the admin panel therefore
// spent its only fixed row on five buttons that lead OUT of the panel, while the nine tabs that are
// the panel sat in a scrolling strip up in the header — the one row a thumb can always reach was
// given to the navigation nobody in the admin console wants.
//
// 🔑 THIS IS THE FOURTH BRANCH OF AN ESTABLISHED PATTERN, NOT A NEW ONE. `App.tsx` keeps ONE
// `<nav>` and already swaps its contents per surface — Pro chat (History/Pro Chat/Preview/Files/
// Studio/More), the Mode surfaces (History/AI/Mode/Settings), and the default five. The admin panel
// was simply falling into that third branch because `isModeSurface` does not name it. And the
// upward channel already exists too: `v3FooterApi` is how the Pro panel's own internals drive the
// shared bar. This module is that same channel for the admin console.
//
// 🔒 THE RULE THIS MODULE IS SHAPED BY: `AdminDashboard` owns the tab table and `activeTab`, so the
// footer must never NAME a tab. It is handed ITEMS and an id, and it renders whatever it is given —
// which is CLAUDE.md's own "do not restate another module's fact, point at the module that owns it".
// A second hardcoded list of admin tabs in App.tsx would drift the first time a tab was added, and
// nothing would fail: both strips would render, one would simply be missing a page.
//
// PURE — no React, no DOM. The I/O half (publishing the api, rendering the strip) lives at the two
// call sites.

import type { AdminTabBadges } from '../../lib/adminTabBadges';
import { formatBadge, badgeNeedsAttention } from '../../lib/adminTabBadges';

/** One tab, as the footer needs it: enough to draw, never enough to decide. */
export interface AdminFooterItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * The counter beside the name, ALREADY FORMATTED — `null` means draw nothing.
   *
   * ⚠️ Never a zero for something unmeasured. `formatBadge` returns null in that case and this
   * carries the null through, because a `0` on a row like User Reports reads as "I looked, there is
   * no work here" — a claim we have not earned. Same rule the header strip already obeys.
   */
  badge: string | null;
  /** The badge is work that needs attention (drawn hot) — from `badgeNeedsAttention`, never guessed. */
  hot: boolean;
}

/** What the admin console publishes upward so the ONE bottom bar can be its tab strip. */
export interface AdminFooterApi {
  /** Every tab, in the panel's own order. The footer renders these and names none of them itself. */
  items: readonly AdminFooterItem[];
  /** Which tab is open right now (drives the active chip AND the scroll-into-view). */
  activeId: string;
  /** Open a tab. This is the panel's own `setActiveTab` — not a second copy of that state. */
  select: (id: string) => void;
}

/** The minimum a tab table must expose for the footer to draw it. */
export interface AdminFooterTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Turn the panel's tab table plus its live badges into footer items. PURE.
 *
 * Deliberately takes the table as an ARGUMENT rather than importing it: `AdminDashboard` owns that
 * list, and a copy here would be the drift this module exists to prevent.
 */
export function adminFooterItems(
  tabs: readonly AdminFooterTab[],
  badges: AdminTabBadges | null | undefined,
): AdminFooterItem[] {
  return tabs.map((tab) => {
    const badge = badges ? (badges as unknown as Record<string, unknown>)[tab.id] : null;
    return {
      id: tab.id,
      label: tab.label,
      icon: tab.icon,
      badge: formatBadge(badge as never),
      hot: badgeNeedsAttention(badge as never),
    };
  });
}

/**
 * Should the admin console hand its tab strip to the bottom bar?
 *
 * Exactly when the shared bottom bar is on screen — i.e. MOBILE and not focus mode, the same
 * condition `App.tsx` renders the `<nav>` under. Mirrors `v3MobileFooterActive` for the identical
 * reason stated there: the header controls and their footer replacements must never BOTH be hidden,
 * so one boolean decides both. PURE.
 *
 * ⚠️ DESKTOP IS UNTOUCHED BY CONSTRUCTION (admin, same day: *"ham desktop me aise hi rahne do!"*).
 * The bar itself is mobile-only, so a desktop admin keeps the header strip and gains no footer —
 * and that is not a second rule to remember, it is this one function returning false.
 */
export function adminMobileFooterActive(effectiveDeviceMode: string, focusMode: boolean): boolean {
  return effectiveDeviceMode === 'mobile' && !focusMode;
}
