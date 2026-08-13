// NEXT-BUILD SUGGESTIONS — after a build finishes, propose what the user could add or improve NEXT in
// THIS app (admin 2026-08-13: "build ke baad user ko next-build ke suggestion dikhe … 💡 bulb").
//
// Design goals the admin set: it is ONLY a suggestion (never auto-applied, never blindly followed), and it
// must be the BEST version — so it is:
//   • CONTEXTUAL — tailored to what the app actually IS (its domain) and what it does NOT already have.
//   • FREE + INSTANT — pure/deterministic, reusing the existing domain analyser; NO extra AI call per build.
//   • HONEST — every suggestion carries a ready-to-send instruction the user can review and edit before
//     sending; nothing happens until the user chooses it.
//   • FRESH — a feature the app already has is never suggested, so the list changes as the app grows.
//
// PURE: no I/O, no clock, no model. Never throws.

import { missingDomainFeatures } from '../lib/RequirementGapAnalyzer';

export interface NextSuggestion {
  /** Stable id (per app-state) so the UI can badge only genuinely-new suggestions. */
  id: string;
  /** Short, friendly title — what the user would tap. */
  title: string;
  /** One line: what it adds / why it helps. */
  detail: string;
  /** A ready-to-send build instruction the user can review, edit, then send. */
  prompt: string;
  /** 'domain' = specific to this kind of app; 'enhancement' = a universal polish every app benefits from. */
  kind: 'domain' | 'enhancement';
}

/**
 * Universal enhancements almost any app benefits from. Each carries a PRESENCE regex so an app that
 * already has the thing never gets it suggested. Ordered by general value.
 */
const UNIVERSAL: Array<{ id: string; title: string; detail: string; prompt: string; present: RegExp }> = [
  {
    id: 'dark-mode',
    title: 'Add a dark mode',
    detail: 'A light/dark theme toggle that remembers the choice.',
    prompt: 'Add a dark mode: a light/dark theme toggle in the UI that remembers the user\'s choice across visits.',
    present: /dark.?mode|prefers-color-scheme|theme.?(toggle|switch)|['"]dark['"]|data-theme/i,
  },
  {
    id: 'mobile',
    title: 'Make it mobile-friendly',
    detail: 'Make it look and work great on a phone, not just desktop.',
    prompt: 'Make the whole app fully responsive and comfortable to use on a mobile phone (touch-friendly, no horizontal scroll).',
    present: /@media|max-width|min-width|\bsm:|\bmd:|\blg:|flex-wrap|grid-cols|viewport/i,
  },
  {
    id: 'search',
    title: 'Add search & filter',
    detail: 'Let users quickly find items as they type.',
    prompt: 'Add a search box that filters the list live as the user types, with a clear "no results" state.',
    present: /type=["']search|placeholder=["'][^"']*search|onSearch|\.filter\(|searchQuery|debounce/i,
  },
  {
    id: 'share',
    title: 'Add a share button',
    detail: 'Share the app or a result in one tap.',
    prompt: 'Add a Share button that uses the device share sheet (navigator.share) with a copy-link fallback.',
    present: /navigator\.share|share.?button|copy.?link|clipboard\.writeText/i,
  },
  {
    id: 'export',
    title: 'Add export / download',
    detail: 'Let users download their data as a file.',
    prompt: 'Add a button to export the current data as a downloadable CSV file.',
    present: /download|export|\.csv|createObjectURL|toDataURL|application\/json/i,
  },
  {
    id: 'empty-state',
    title: 'Add friendly empty states',
    detail: 'A helpful message when there is nothing yet.',
    prompt: 'Add friendly empty-state messages and a first-time hint wherever a list or screen can be empty.',
    present: /empty.?state|no.?(items|results|data|records)|nothing.?(here|yet)/i,
  },
  {
    id: 'animations',
    title: 'Add smooth animations',
    detail: 'Subtle motion that makes it feel polished.',
    prompt: 'Add smooth, subtle animations and transitions (hover, appear, list changes) to make the app feel polished.',
    present: /transition|animate|@keyframes|framer-motion|\.animate\(/i,
  },
  {
    id: 'settings',
    title: 'Add a settings screen',
    detail: 'One place for the app\'s preferences.',
    prompt: 'Add a simple Settings screen where the user can change the app\'s main preferences.',
    present: /settings|preferences/i,
  },
];

/** Sentence-case a domain label ("cart & checkout" → "Add cart & checkout"). */
function domainTitle(label: string): string {
  const short = label.length > 42 ? label.slice(0, 40).replace(/[,;].*$/, '') + '…' : label;
  return `Add ${short}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Suggest what to build NEXT for this app. Domain-specific gaps come FIRST (most relevant to THIS app),
 * then universal enhancements the app does not already have. Pure.
 *
 * @param appText  the app's intent — its original prompt / title / build summary (drives domain detection)
 * @param source   the app's real source (all files joined) — so an already-built feature is never suggested
 * @param max      cap (default 5) — enough to be useful, few enough to never overwhelm
 */
export function nextBuildSuggestions(input: { appText: string; source: string; max?: number }): NextSuggestion[] {
  const max = Math.max(1, input.max ?? 5);
  const appText = String(input.appText || '');
  const source = String(input.source || '');
  const haystack = `${source}\n${appText}`.toLowerCase();
  const out: NextSuggestion[] = [];
  const seen = new Set<string>();

  // 1) Domain-specific missing features — the most relevant "next" for THIS kind of app.
  const dom = missingDomainFeatures(appText, source);
  const domainName = dom.domain !== 'general' ? dom.domain : '';
  for (const label of dom.labels) {
    const id = `domain-${slug(label)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: domainTitle(label),
      detail: domainName ? `Common in ${domainName} apps — yours doesn't have it yet.` : 'A useful next step for this app.',
      prompt: `Add ${label} to the app — implement it fully and keep everything that already works.`,
      kind: 'domain',
    });
    if (out.length >= max) return out;
  }

  // 2) Universal enhancements the app does not already have.
  for (const u of UNIVERSAL) {
    if (u.present.test(haystack)) continue; // already there → never suggest
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({ id: u.id, title: u.title, detail: u.detail, prompt: u.prompt, kind: 'enhancement' });
    if (out.length >= max) break;
  }

  return out.slice(0, max);
}
