// THE ADMIN PANEL'S NINE TABS AND THEIR PAGES (admin 2026-10-04, decision D2 of the admin panel audit; PR 2).
//
// The panel had grown ten flat tabs, and where a card lived had stopped saying anything about what it
// was: the gallery's review queue sat under "Security", the APK failure inbox was its own top-level tab
// beside "Build Reports", promo codes and the "message every user" box lived in "Settings", and a whole
// "Diagnostics" tab held thirteen unrelated reports. The audit proposed nine tabs, each a question the
// admin actually asks ("how are the users?", "are builds working?", "what did it cost?"), and the admin
// accepted it as proposed.
//
// 🔑 TWO LEVELS, TWO KINDS OF ID — and the split is what kept this change small.
//   • A PAGE is what is on screen. Page ids are the OLD tab ids wherever a page survived unchanged
//     ('monitor', 'users', 'reports', 'apkreports', 'revenue', …), so every fetch effect and every
//     test that asks `activeTab === 'reports'` still means exactly what it meant.
//   • A TAB is the group in the top bar (and the phone's bottom bar). It is DERIVED from the open page
//     (`tabOfPage`) — there is no second piece of state that could disagree with the first.
//
// 🔒 NULL IS NOT ZERO, carried up a level. A tab that groups two pages shows a combined badge only when
// every part of it was measured (`sumBadges`); treating one unmeasured inbox as an empty one would put a
// calm number on a tab that may be hiding work — the exact lie `adminTabBadges.ts` exists to forbid.
//
// PURE — no React, no fetch. Icons stay in the dashboard.

import type { AdminTabBadges, TabBadge } from './adminTabBadges';
import { BADGE_HINTS } from './adminTabBadges';

export type AdminTabId =
  | 'home' | 'users' | 'apps' | 'builds' | 'engines' | 'money' | 'safety' | 'messages' | 'settings';

/** What is on screen. Old tab ids are kept where the page itself did not change. */
export type AdminPageId =
  | 'monitor'
  | 'users' | 'userreports'
  | 'apps' | 'publishing' | 'review'
  | 'reports' | 'apkreports' | 'health'
  | 'engines'
  | 'revenue'
  | 'security'
  | 'messages'
  | 'settings';

export interface AdminPageDef { id: AdminPageId; label: string }
export interface AdminTabDef { id: AdminTabId; label: string; pages: readonly AdminPageDef[] }

export const ADMIN_TABS: readonly AdminTabDef[] = [
  { id: 'home', label: 'Home', pages: [{ id: 'monitor', label: 'Overview' }] },
  // Complaints stay a SEPARATE page from the user list (admin 2026-08-21): a person telling us about
  // the product or about another person must never be buried among account rows.
  { id: 'users', label: 'Users', pages: [{ id: 'users', label: 'All users' }, { id: 'userreports', label: 'Complaints' }] },
  { id: 'apps', label: 'Apps', pages: [
    { id: 'apps', label: 'All apps' },
    { id: 'publishing', label: 'Publishing' },
    { id: 'review', label: 'Review' },
  ] },
  // Build reports and phone builds stay separate pages too (admin 2026-09-14): one is the in-house
  // engine's report, the other the store-build pipeline on the user's own GitHub. Same tab, never
  // the same list.
  { id: 'builds', label: 'Builds', pages: [
    { id: 'reports', label: 'Reports' },
    { id: 'apkreports', label: 'Phone builds' },
    { id: 'health', label: 'Engine health' },
  ] },
  { id: 'engines', label: 'AI Engines', pages: [{ id: 'engines', label: 'AI Engines' }] },
  { id: 'money', label: 'Money', pages: [{ id: 'revenue', label: 'Money' }] },
  { id: 'safety', label: 'Safety', pages: [{ id: 'security', label: 'Safety' }] },
  { id: 'messages', label: 'Messages', pages: [{ id: 'messages', label: 'Messages' }] },
  { id: 'settings', label: 'Settings', pages: [{ id: 'settings', label: 'Settings' }] },
];

export const ADMIN_PAGE_IDS: readonly AdminPageId[] = ADMIN_TABS.flatMap((t) => t.pages.map((p) => p.id));

/** The tab a page belongs to. Every page is in exactly one tab (test-locked). */
export function tabOfPage(page: AdminPageId): AdminTabId {
  for (const t of ADMIN_TABS) if (t.pages.some((p) => p.id === page)) return t.id;
  return 'home';
}

export function tabDef(tab: AdminTabId): AdminTabDef {
  return ADMIN_TABS.find((t) => t.id === tab) ?? ADMIN_TABS[0];
}

export function firstPageOf(tab: AdminTabId): AdminPageId {
  return tabDef(tab).pages[0].id;
}

/** The name of the open page as a person reads it: "Builds · Phone builds", or just "Money". */
export function pageTitle(page: AdminPageId): string {
  const tab = tabDef(tabOfPage(page));
  const p = tab.pages.find((x) => x.id === page);
  if (!p || tab.pages.length === 1) return tab.label;
  return `${tab.label} · ${p.label}`;
}

/**
 * Where the old tabs went. A saved link, an old habit or another screen naming 'diagnostics' or
 * 'security' still lands on the page that now holds that content — never on nothing.
 */
export const LEGACY_PAGE: Readonly<Record<string, AdminPageId>> = {
  overview: 'monitor',
  monitor: 'monitor',
  diagnostics: 'health',
};

export function resolvePage(id: string): AdminPageId {
  if ((ADMIN_PAGE_IDS as readonly string[]).includes(id)) return id as AdminPageId;
  return LEGACY_PAGE[id] ?? 'monitor';
}

/**
 * Which of the engine reports (`EngineReportsPanel`) each page shows. The thirteen used to share one
 * "Diagnostics" tab; each now sits beside the cards it belongs with. Every report is placed exactly
 * once — a report on no page is the defect that tab was created to fix (test-locked).
 */
export const ENGINE_REPORTS_ON = {
  health: ['scorecard', 'metrics', 'events'],
  revenue: ['losses', 'usage', 'assistant'],
  engines: ['providers'],
  security: ['gate', 'keyVersion'],
  publishing: ['deployments', 'takedowns'],
  messages: ['announcements'],
} as const satisfies Partial<Record<AdminPageId, readonly string[]>>;

/** Each page's own badge — the pages that HAVE a measured number. */
export function pageBadge(page: AdminPageId, b: AdminTabBadges | null | undefined): TabBadge | null {
  if (!b) return null;
  switch (page) {
    case 'monitor': return b.monitor;
    case 'users': return b.users;
    case 'userreports': return b.userreports;
    case 'reports': return b.reports;
    case 'apkreports': return b.apkreports;
    case 'engines': return b.engines;
    case 'revenue': return b.revenue;
    default: return null;
  }
}

export function pageHint(page: AdminPageId): string | null {
  switch (page) {
    case 'monitor': return BADGE_HINTS.monitor;
    case 'users': return BADGE_HINTS.users;
    case 'userreports': return BADGE_HINTS.userreports;
    case 'reports': return BADGE_HINTS.reports;
    case 'apkreports': return BADGE_HINTS.apkreports;
    case 'engines': return BADGE_HINTS.engines;
    case 'revenue': return BADGE_HINTS.revenue;
    default: return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Two attention inboxes as one badge — only when BOTH were measured. */
export function sumBadges(a: TabBadge | null | undefined, b: TabBadge | null | undefined): TabBadge | null {
  if (!a || !b || !isNum(a.value) || !isNum(b.value)) return null;
  const of = isNum(a.of) && isNum(b.of) ? a.of + b.of : null;
  return { value: a.value + b.value, of, tone: 'attention' };
}

/**
 * The badge each TAB shows in the top bar and the phone's bottom bar.
 *
 * Users: complaints waiting win over the activity count, because on that tab only the complaints are
 * work. Builds: the two report inboxes added together. Tabs with no measured number show nothing.
 */
export function tabBarBadges(b: AdminTabBadges | null | undefined): Record<AdminTabId, TabBadge | null> {
  const none = { home: null, users: null, apps: null, builds: null, engines: null, money: null, safety: null, messages: null, settings: null };
  if (!b) return none;
  const complaintsWaiting = isNum(b.userreports?.value) && (b.userreports.value as number) > 0 && b.userreports.tone === 'attention';
  return {
    ...none,
    home: b.monitor,
    users: complaintsWaiting ? b.userreports : b.users,
    builds: sumBadges(b.reports, b.apkreports),
    engines: b.engines,
    money: b.revenue,
  };
}

export function tabHint(tab: AdminTabId, b: AdminTabBadges | null | undefined): string | null {
  switch (tab) {
    case 'home': return BADGE_HINTS.monitor;
    case 'users': {
      const waiting = !!b && isNum(b.userreports?.value) && (b.userreports.value as number) > 0;
      return waiting ? `Complaints: ${BADGE_HINTS.userreports}` : BADGE_HINTS.users;
    }
    case 'builds': return 'Build reports plus phone-build reports: never opened / not yet marked fixed.';
    case 'engines': return BADGE_HINTS.engines;
    case 'money': return BADGE_HINTS.revenue;
    default: return null;
  }
}
