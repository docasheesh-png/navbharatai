// AgentV3 — Golden Scaffold registry (admin 2026-08-02: "starter apps pre-built, cloud me stored,
// direct banwane par instantly ban jaye").
//
// One hand-verified, compile-tested scaffold for EVERY simple starter template chip (the free tier's
// first-build-must-work set). When a NEW build's prompt is exactly a chip's prompt, the build route
// pre-seeds the workspace with these files and the builder VERIFIES & CUSTOMIZES instead of writing
// from scratch — the 50/50 law's PREVENT half: the first build is correct by construction.
//
// The scaffolds live in this server-side module and deploy WITH the server to Cloud Run — that is
// their "cloud storage": versioned in git, zero runtime fetch fragility, zero client-bundle growth.
// CI (goldenScaffolds.test.ts) proves every scaffold parses under esbuild AND compiles under the
// in-browser Babel preview, and stays in lockstep with STARTER_TEMPLATES (a new simple chip without
// a scaffold fails the build).

import { STARTER_TEMPLATES } from '../../../components/agentv3/starterTemplates';
import { goldenBaseFiles } from './base';
import { todoAppTsx, calculatorAppTsx, stopwatchAppTsx, pomodoroAppTsx, tipSplitAppTsx } from './appsA';
import { unitConverterAppTsx, qrMakerAppTsx, quickNotesAppTsx, passwordGenAppTsx, loginPageAppTsx } from './appsB';
import { memoryAppTsx, puzzleAppTsx, arcadeAppTsx } from './games';
import { gstBillAppTsx, examPrepAppTsx, societyAppTsx, coachingAppTsx, weddingRsvpAppTsx } from './indiaApps';
import { courierAppTsx, ngoAppTsx, schoolErpAppTsx } from './indiaOrgs';
import { geetaAppTsx, quranAppTsx } from './indiaFaith';
import { gitaChapterFiles } from './gitaText';
import { panchangAppTsx, kundaliAppTsx } from './indiaPanchang';
import { proUiTsx, proStoreTs } from './proShell';
import { BROWSER_FILE_STORE_TS } from '../browserFileStore';
import { saasDashboardAppTsx, crmAppTsx, storeAppTsx } from './proApps';
import { restaurantAppTsx, socialFeedAppTsx } from './proAppsB';
import { invoicingAppTsx, bookingsAppTsx, kanbanAppTsx } from './proAppsC';
import { notesAppTsx, expenseAppTsx, fitnessAppTsx, portfolioAppTsx } from './proAppsD';
import { communityAppTsx, eventsAppTsx, lmsAppTsx } from './proAppsE';
import { aiImageAppTsx, aiImageEngineFiles } from './aiImage';
import { KEY_GUIDANCE } from '../../lib/ImageAiGenerator';

export interface GoldenScaffold {
  /** Must equal the matching StarterTemplate id (the CI lockstep test enforces this). */
  id: string;
  /** Human label for narration ("Starting from the tested X template…"). */
  label: string;
  /** index.html <title>. */
  title: string;
  /** The app's complete src/App.tsx source. */
  appTsx: string;
  /**
   * Which starter tier this scaffold serves. A `simple` scaffold IS the finished app; a `pro` scaffold
   * is a compile-proven ARCHITECTURE the builder then extends (see proShell.ts for why they differ).
   */
  tier: 'simple' | 'pro';
  /**
   * Data files the app imports beside its App.tsx (the Gita's eighteen chapter files). Kept out of
   * App.tsx on purpose: a builder that opens the app reads the code, and one chapter at a time only if
   * it asks — never a whole book in one read.
   */
  files?: Record<string, string>;
  /**
   * What the builder must also be told when it finishes this template — the instructions of the recipe whose
   * files the scaffold seeds (autopsy 303e8a6f). The template lane seeds a recipe's FILES without running the
   * recipe, so without this its instructions never reached the builder: the AI-image template was the one
   * lane where the builder was never told that the pictures need an image API key.
   */
  finishNote?: string;
}

/**
 * The shared foundation a PRO scaffold is built on. Kept out of the simple apps so a to-do list never
 * carries a CRM's furniture — the simple tier's whole value is that it is small.
 */
const PRO_SHARED_FILES: Record<string, string> = {
  'src/lib/ui.tsx': proUiTsx,
  'src/lib/store.ts': proStoreTs,
  // Where an uploaded file goes when no database is connected (Q-542): IndexedDB, as the file itself —
  // never a data URL in the 5 MB localStorage that `store.ts` keeps lists in.
  'src/lib/files.ts': BROWSER_FILE_STORE_TS,
};

export const GOLDEN_SCAFFOLDS: readonly GoldenScaffold[] = [
  // ── SIMPLE tier: the scaffold IS the app ──
  { id: 'ai-image', label: 'AI image generator', title: 'AI Image Generator', appTsx: aiImageAppTsx, tier: 'simple', files: aiImageEngineFiles(), finishNote: KEY_GUIDANCE },
  { id: 'todo', label: 'To-do list', title: 'To-do List', appTsx: todoAppTsx, tier: 'simple' },
  { id: 'calculator', label: 'Calculator', title: 'Calculator', appTsx: calculatorAppTsx, tier: 'simple' },
  { id: 'stopwatch', label: 'Stopwatch & timer', title: 'Stopwatch & Timer', appTsx: stopwatchAppTsx, tier: 'simple' },
  { id: 'pomodoro', label: 'Pomodoro timer', title: 'Pomodoro Timer', appTsx: pomodoroAppTsx, tier: 'simple' },
  { id: 'tip-split', label: 'Tip & bill split', title: 'Tip & Bill Split', appTsx: tipSplitAppTsx, tier: 'simple' },
  { id: 'unit-converter', label: 'Unit converter', title: 'Unit Converter', appTsx: unitConverterAppTsx, tier: 'simple' },
  { id: 'qr-generator', label: 'QR code maker', title: 'QR Code Maker', appTsx: qrMakerAppTsx, tier: 'simple' },
  { id: 'quick-notes', label: 'Quick notes', title: 'Quick Notes', appTsx: quickNotesAppTsx, tier: 'simple' },
  { id: 'password-gen', label: 'Password generator', title: 'Password Generator', appTsx: passwordGenAppTsx, tier: 'simple' },
  { id: 'login-page', label: 'Login page', title: 'Login', appTsx: loginPageAppTsx, tier: 'simple' },
  { id: 'memory', label: 'Memory match', title: 'Memory Match', appTsx: memoryAppTsx, tier: 'simple' },
  { id: 'puzzle', label: 'Merge puzzle', title: 'Merge Puzzle', appTsx: puzzleAppTsx, tier: 'simple' },
  { id: 'gst-bill', label: 'GST bill maker', title: 'GST Bill', appTsx: gstBillAppTsx, tier: 'simple' },
  { id: 'exam-prep', label: 'Exam mock test', title: 'Mock Test', appTsx: examPrepAppTsx, tier: 'simple' },
  { id: 'panchang', label: 'Panchang & muhurat', title: 'Panchang', appTsx: panchangAppTsx, tier: 'simple' },
  { id: 'geeta', label: 'Bhagavad Gita reader', title: 'Bhagavad Gita', appTsx: geetaAppTsx, tier: 'simple', files: gitaChapterFiles() },
  { id: 'quran', label: 'Quran reader', title: 'Quran', appTsx: quranAppTsx, tier: 'simple' },
  { id: 'wedding-rsvp', label: 'Wedding RSVP manager', title: 'Shaadi RSVP', appTsx: weddingRsvpAppTsx, tier: 'simple' },
  // ── PRO tier: a compile-proven architecture the builder extends ──
  // The arcade game is the one PRO scaffold that is a finished app rather than an architecture: a game
  // loop is not furniture the builder decorates, it is the thing that must already be correct.
  { id: 'arcade', label: 'Arcade game', title: 'Dodge', appTsx: arcadeAppTsx, tier: 'pro' },
  { id: 'saas-dashboard', label: 'SaaS dashboard', title: 'SaaS Dashboard', appTsx: saasDashboardAppTsx, tier: 'pro' },
  { id: 'crm', label: 'CRM / pipeline', title: 'Pipeline CRM', appTsx: crmAppTsx, tier: 'pro' },
  { id: 'store', label: 'Online store', title: 'Online Store', appTsx: storeAppTsx, tier: 'pro' },
  { id: 'restaurant', label: 'Restaurant / menu', title: 'Restaurant', appTsx: restaurantAppTsx, tier: 'pro' },
  { id: 'social-feed', label: 'Social feed', title: 'Social Feed', appTsx: socialFeedAppTsx, tier: 'pro' },
  { id: 'invoicing', label: 'Invoicing app', title: 'Invoicing', appTsx: invoicingAppTsx, tier: 'pro' },
  { id: 'bookings', label: 'Booking / appointments', title: 'Appointments', appTsx: bookingsAppTsx, tier: 'pro' },
  { id: 'kanban', label: 'Project board', title: 'Project Board', appTsx: kanbanAppTsx, tier: 'pro' },
  { id: 'notes', label: 'Notes / docs', title: 'Notes', appTsx: notesAppTsx, tier: 'pro' },
  { id: 'expense', label: 'Expense tracker', title: 'Expense Tracker', appTsx: expenseAppTsx, tier: 'pro' },
  { id: 'fitness', label: 'Fitness tracker', title: 'Fitness Tracker', appTsx: fitnessAppTsx, tier: 'pro' },
  { id: 'portfolio', label: 'Portfolio site', title: 'Portfolio', appTsx: portfolioAppTsx, tier: 'pro' },
  { id: 'community', label: 'Community forum', title: 'Community Forum', appTsx: communityAppTsx, tier: 'pro' },
  { id: 'events', label: 'Event platform', title: 'Events', appTsx: eventsAppTsx, tier: 'pro' },
  { id: 'lms', label: 'Learning platform', title: 'Learning Platform', appTsx: lmsAppTsx, tier: 'pro' },
  { id: 'society', label: 'Society / RWA', title: 'Society', appTsx: societyAppTsx, tier: 'pro' },
  { id: 'coaching', label: 'Coaching class', title: 'Coaching', appTsx: coachingAppTsx, tier: 'pro' },
  { id: 'kundali', label: 'Janam Kundali', title: 'Janam Kundali', appTsx: kundaliAppTsx, tier: 'pro' },
  { id: 'courier', label: 'Courier & parcel tracking', title: 'Courier', appTsx: courierAppTsx, tier: 'pro' },
  { id: 'ngo', label: 'NGO donations & volunteers', title: 'Trust Office', appTsx: ngoAppTsx, tier: 'pro' },
  { id: 'school-erp', label: 'School management', title: 'School Office', appTsx: schoolErpAppTsx, tier: 'pro' },
];

/**
 * The complete runnable file map for one golden scaffold: the platform base + its App.tsx, plus the
 * shared pro foundation when this is a pro scaffold. Pure.
 */
export function goldenScaffoldFiles(s: GoldenScaffold): Record<string, string> {
  const base = { ...goldenBaseFiles(s.title, s.appTsx), ...(s.files ?? {}) };
  return s.tier === 'pro' ? { ...base, ...PRO_SHARED_FILES } : base;
}

/** Whitespace/trailing-punctuation-insensitive prompt normalization for the exact-chip match. */
function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!?]+$/g, '').trim();
}

/**
 * 🧩 THE TEMPLATE'S OWN NAME (admin-approved 2026-10-01, queue Q-087, autopsy 52471441). "Build a
 * calculator" got no template, because only the chip's full text seeded one; the user saw nothing for
 * 38 s and pressed Stop. A request that is ONLY a build verb plus one template's own name asks for
 * exactly what that template is, so it gets it. Any other word ("scientific calculator", "calculator
 * with graphs", "calculator for kids") is a spec the template does not carry, and builds from scratch
 * exactly as before — no request is ever narrowed to a template.
 *
 * SIMPLE tier only: a simple scaffold IS the finished app, while a pro scaffold is an architecture the
 * chip's long prompt tells the builder how to extend. A name that two templates could answer ("notes",
 * "timer") is on neither list. Every name is lowercase and its own whole request.
 */
export const BARE_TEMPLATE_NAMES: Readonly<Record<string, readonly string[]>> = {
  'ai-image': ['ai image generator', 'ai image maker'],
  todo: ['to-do list', 'to do list', 'todo list', 'todo', 'to-do', 'to do'],
  calculator: ['calculator'],
  stopwatch: ['stopwatch', 'stopwatch and timer', 'stopwatch and countdown timer'],
  pomodoro: ['pomodoro timer', 'pomodoro'],
  'tip-split': ['tip calculator', 'bill splitter', 'bill split', 'tip and bill split'],
  'unit-converter': ['unit converter'],
  'qr-generator': ['qr code generator', 'qr code maker', 'qr generator', 'qr maker'],
  'quick-notes': ['quick notes'],
  'password-gen': ['password generator'],
  'login-page': ['login page', 'login screen', 'login and signup page'],
  memory: ['memory game', 'memory match game', 'memory match', 'memory card game'],
  puzzle: ['merge puzzle', '2048 game', '2048'],
  'gst-bill': ['gst bill maker', 'gst bill generator', 'gst billing', 'gst bill'],
  'exam-prep': ['mock test', 'exam mock test'],
  panchang: ['panchang'],
  geeta: ['bhagavad gita reader', 'bhagavad gita', 'gita reader', 'gita', 'geeta'],
  quran: ['quran reader', 'quran'],
  'wedding-rsvp': ['wedding rsvp manager', 'wedding rsvp', 'shaadi rsvp'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An English order that opens the request ("build me a calculator"). */
const LEADING_VERB = '(?:please\\s+)?(?:build|make|create|generate)\\s+(?:me\\s+)?(?:(?:a|an|one|the|ek)\\s+)?';
/** A Hinglish order that closes it ("ek calculator banao", "calculator app bana do"). */
const TRAILING_VERB = '\\s+(?:banao|bana\\s+do|banado|bana\\s+de|bana\\s+dijiye|banaiye|banana\\s+hai|chahiye)';
const HINGLISH_OPENER = '(?:(?:mujhe|mere\\s+liye)\\s+)?(?:ek\\s+)?';
const APP_WORD = '(?:\\s+(?:app|application))?';

/** The scaffold a request names by its bare name, or null. Pure. */
export function bareTemplateRequestFor(prompt: string): GoldenScaffold | null {
  const p = norm(prompt).replace(/[,!]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!p) return null;
  for (const [id, names] of Object.entries(BARE_TEMPLATE_NAMES)) {
    const scaffold = GOLDEN_SCAFFOLDS.find((g) => g.id === id);
    if (!scaffold || scaffold.tier !== 'simple') continue;
    const name = `(?:${names.map(escapeRe).join('|')})`;
    const english = new RegExp(`^${LEADING_VERB}${name}${APP_WORD}(?:\\s+please)?$`);
    const hinglish = new RegExp(`^${HINGLISH_OPENER}${name}${APP_WORD}${TRAILING_VERB}(?:\\s+please)?$`);
    if (english.test(p) || hinglish.test(p)) return scaffold;
  }
  return null;
}

/**
 * The golden scaffold for a build prompt, or null. Matches when the prompt is (modulo whitespace
 * and trailing punctuation) EXACTLY a starter-template chip prompt, or a build verb plus one simple
 * template's own name and nothing else (`bareTemplateRequestFor`). A user who wrote anything more has
 * asked for something else, so they get a normal from-scratch build (no surprise template).
 * Pure.
 */
/**
 * Is the seeded template the FINISHED app, or only a starting architecture? (autopsy e3135b7b, Q-1080.)
 *
 * The distinction is `GoldenScaffold.tier` and it is the only thing that decides whether a planner has work to do:
 * a `simple` scaffold IS the finished app (the builder verifies and polishes it), while a `pro` scaffold is a
 * compile-proven ARCHITECTURE the builder extends (proShell.ts). Both planners — the mega-app roadmap and Software
 * Project Mode — stand down for the first and run normally for the second.
 *
 * ⚠️ IT IS A FUNCTION, NOT A LOCAL IN THE ROUTE, FOR A MEASURED REASON (Q-979). The `/build` handler sits ON
 * TypeScript's control-flow-analysis limit: adding one `const` for this in that body raised TS2563 on the whole
 * file. Three call sites read it, so it also must not be three inline copies of the same comparison. PURE.
 */
export function templateIsTheFinishedApp(scaffold: Pick<GoldenScaffold, 'tier'> | null | undefined): boolean {
  return scaffold?.tier === 'simple';
}

export function goldenScaffoldForPrompt(prompt: string): GoldenScaffold | null {
  const p = norm(prompt);
  if (!p) return null;
  for (const t of STARTER_TEMPLATES) {
    // Any tier may have a scaffold now; a chip WITHOUT one simply falls through to a normal build,
    // which is why this looks the scaffold up rather than assuming one exists.
    if (norm(t.prompt) === p || (RETIRED_CHIP_PROMPTS[t.id] ?? []).some((old) => norm(old) === p)) {
      return GOLDEN_SCAFFOLDS.find((g) => g.id === t.id) ?? null;
    }
  }
  return bareTemplateRequestFor(prompt);
}

/**
 * Chip texts that were CORRECTED, kept so a phone app still sending the old text keeps its template.
 *
 * The phone apps are BUNDLED (capacitor.config.ts serves `dist/`), so a chip's text in an installed app only
 * changes with a new store release, while the server changes on every merge. Without this, correcting a
 * chip's text would quietly turn every old-bundle tap into a from-scratch build. Each entry is the old text,
 * verbatim, and why it was retired.
 */
export const RETIRED_CHIP_PROMPTS: Readonly<Record<string, readonly string[]>> = {
  // Autopsy 303e8a6f (2026-10-12): it told the user and the builder the pictures need no key — false since
  // #3528 (2026-10-04), when every image engine started needing the owner's image API key.
  'ai-image': [
    'Build an AI image generator app: type a description, choose a shape (square, wide or portrait), press Generate and see a real AI-made picture with a clear progress state, then download it or generate another. Offer a few example ideas to tap, show friendly error messages with a Try again button, and use the free image engine that needs no API key. Mobile-first, light/dark mode.',
  ],
};

/**
 * The text the BUILDER reads for a build prompt: a retired chip text becomes that chip's current text, so a
 * correction reaches the builder even from an old phone bundle; anything else is returned as it is. The
 * user's own message and every analyser keep reading what the user sent. PURE.
 */
export function chipPromptForBuild(prompt: string): string {
  const p = norm(prompt);
  if (!p) return prompt;
  for (const t of STARTER_TEMPLATES) {
    if ((RETIRED_CHIP_PROMPTS[t.id] ?? []).some((old) => norm(old) === p)) return t.prompt;
  }
  return prompt;
}

/**
 * The builder's instruction for a pre-seeded template, around the build prompt. One place, so the note a
 * template's builder reads is testable (it used to be assembled inline in the build route).
 *
 * TIER-AWARE, and this distinction is load-bearing. A SIMPLE scaffold IS the finished app, so "polish and
 * finish" is the truth. A PRO scaffold is a compile-proven ARCHITECTURE covering part of a much larger request
 * ("…activity history, tasks, and a dashboard of pipeline value") — telling the builder it "fully implements
 * the request" would make it ship a skeleton and declare success, which is exactly the fake-completion the
 * real-features rule forbids. So pro gets an EXTEND instruction instead of a FINISH one.
 *
 * A scaffold's `finishNote` (the instructions of the recipe it seeds) is appended to both. PURE.
 */
export function goldenBuildPrompt(golden: GoldenScaffold, buildPrompt: string): string {
  const head = golden.tier === 'pro'
    ? `[EXTEND THIS WORKING FOUNDATION — DO NOT START OVER] This workspace was just pre-seeded with NavBharatAI's tested "${golden.label}" foundation. ` +
      `It already compiles and runs: src/lib/ui.tsx holds the shared components (Shell, Card, StatTile, Badge, Button, Field, Select, Modal, Empty), ` +
      `src/lib/store.ts holds persistent state (useCollection, inr, shortDate), and src/App.tsx has the working screens. ` +
      `READ all three FIRST. It is a STARTING POINT, not the finished app — BUILD OUT everything the request below asks for that is not there yet, ` +
      `reusing those existing components and the useCollection pattern rather than inventing a second set. Add new screens as their own files under src/. ` +
      `Do NOT rewrite what already works, do NOT re-plan a parallel file structure, and NEVER add an import that already exists.`
    : `[VERIFY & FINISH — DO NOT START OVER] This workspace was just pre-seeded with NavBharatAI's tested, working "${golden.label}" app template. ` +
      `It already compiles cleanly and fully implements the request below. READ src/App.tsx first. If the request matches the template (it should — the prompt is the template's own), ` +
      `make NO edits unless tsc fails or the request asks for something the template does not do — a finished template needs no polish, and every edit is a chance to break it. The live preview has ALREADY been started by the platform. Before any edit_file, read_file the exact region you will change (one read of src/App.tsx, not fragments) — never edit text you have not read. Otherwise run the type check and finish. Do NOT rewrite it from scratch, do NOT re-plan a parallel file structure, and NEVER add an import that already exists. ` +
      // Autopsy 8257ca59: a polish step replaced the template's working light/dark switch with a
      // hand-rolled one that set a class no stylesheet styles, and a repair pass had to put it back.
      `KEEP the template's own working controls — above all its light/dark switch (ThemeToggle in src/theme.tsx, which cycles Auto → Light → Dark through the data-theme attribute the styles use); improve one in place if you must, never replace it with a hand-rolled copy.`;
  const note = golden.finishNote ? `\n\n${golden.finishNote}` : '';
  return `${head}${note}\n\n---\n\n${buildPrompt}`;
}
