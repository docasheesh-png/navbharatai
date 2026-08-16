/**
 * The layout SKETCH shown on each starter template (ROADMAP #1 Phase 3.4).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. A first-time user staring at a row of identical
 * grey pills cannot tell a to-do app from a CRM, so the picker is harder to use than it looks. The
 * obvious fix is a screenshot of each template's output — and we do not have one. Building 26 apps to
 * photograph them would produce images that are stale the day the engine improves, and drawing a
 * pretty fake screenshot would be a picture of an app that does not exist, shown to someone deciding
 * what to build. That is exactly the kind of "looks done" the constitution forbids.
 *
 * So this is a SHAPE, not a picture: a few plain rectangles saying "this one is a list", "this one is
 * a dashboard with a sidebar", "this one is a grid of products". That is genuinely useful — it is the
 * one thing a person scanning templates actually wants to know — and it claims nothing it cannot
 * back up. The UI labels it a layout sketch and never the word "preview".
 *
 * Pure data + a pure lookup, so the mapping is testable and every template is provably covered.
 */

import { STARTER_TEMPLATES, type StarterTemplate } from './starterTemplates';

/** The layout families a starter can have. Chosen because they are visually distinct at 60px wide. */
export type SketchShape =
  | 'list'       // rows with a leading control — to-do, notes, expenses
  | 'dashboard'  // sidebar + stat tiles — SaaS, CRM, LMS
  | 'grid'       // cards in a grid — store, events, portfolio
  | 'feed'       // wide posts stacked — social, community
  | 'board'      // vertical columns — kanban
  | 'form'       // a centred panel with fields — login, invoicing, bookings
  | 'keypad'     // a block of buttons — calculator, converters
  | 'focus'      // one large centred element — timer, stopwatch, QR
  | 'landing';   // hero band above cards — restaurant, marketing

/**
 * Shape per template, decided from what the template's prompt actually builds.
 *
 * Written out per id rather than inferred from the category: `category` groups templates by PURPOSE
 * ("Business"), while this is about SCREEN STRUCTURE, and the two genuinely disagree — invoicing and
 * a CRM are both Business and look nothing alike.
 */
const SHAPES: Record<string, SketchShape> = {
  todo: 'list',
  calculator: 'keypad',
  stopwatch: 'focus',
  pomodoro: 'focus',
  'tip-split': 'keypad',
  'unit-converter': 'keypad',
  'qr-generator': 'focus',
  'quick-notes': 'list',
  'password-gen': 'focus',
  'login-page': 'form',
  'saas-dashboard': 'dashboard',
  crm: 'dashboard',
  invoicing: 'form',
  store: 'grid',
  restaurant: 'landing',
  bookings: 'form',
  'social-feed': 'feed',
  community: 'feed',
  events: 'grid',
  kanban: 'board',
  notes: 'list',
  lms: 'dashboard',
  portfolio: 'grid',
  fitness: 'dashboard',
  expense: 'list',
};

/**
 * The shape for a template.
 *
 * Falls back to 'list' for an id with no entry — a new template added without touching this file
 * still renders something sensible rather than a hole in the grid. The test below fails on that
 * omission, so the fallback is a safety net, not the plan.
 */
export function sketchFor(template: Pick<StarterTemplate, 'id'>): SketchShape {
  return SHAPES[template?.id] ?? 'list';
}

/** Ids the mapping does not cover — used by the test that keeps this file honest as templates grow. */
export function unmappedStarterIds(list: readonly StarterTemplate[] = STARTER_TEMPLATES): string[] {
  return list.filter((t) => !(t.id in SHAPES)).map((t) => t.id);
}

/** Every shape referenced by at least one template — no dead drawing code. */
export function usedShapes(list: readonly StarterTemplate[] = STARTER_TEMPLATES): SketchShape[] {
  return [...new Set(list.map(sketchFor))];
}
