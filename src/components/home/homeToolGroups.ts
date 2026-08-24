// Home-page builder-tool groups (admin 2026-07-23: MOVED here from Settings — cut, not copied).
//
// These five groups used to live inside Settings → App Settings. The admin relocated them to the home
// page so the builder utilities sit alongside the three main AIs (Free / Pro / Professionals) instead of
// being buried in Settings. Every item opens a real workspace tab via `toggleTab(id)` — the exact same
// ids the Settings tiles used, so the destinations are unchanged (only the doorway moved).
//
// Account & Profile and App Settings (General/Secrets/Database/Terminal/Logs) stay in Settings — those
// are genuine settings, not builder tools.

import type { ComponentType } from 'react';
import { Bot, MessageSquare, Wand2, Bug, Code, TestTube, Globe, GitBranch, Gauge, Minimize2, Palette, Layout, Puzzle, LayoutTemplate, Moon, Figma, Rocket, Smartphone, Search, Package, IndianRupee, Users2, TrendingUp, Share2, Database, Languages, FlaskConical } from 'lucide-react';

/** A lucide icon component (version-independent — the package's type export name has changed across releases). */
type IconType = ComponentType<{ className?: string }>;

/** One launchable tool — `id` is the workspace tab it opens (unchanged from the old Settings tiles). */
export interface HomeTool {
  id: string;
  label: string;
  icon: IconType;
}

export interface HomeToolGroup {
  title: string;
  /** Tailwind text-color class for the group's accent (matches the old Settings groups). */
  color: string;
  icon: IconType;
  items: HomeTool[];
}

export const HOME_TOOL_GROUPS: HomeToolGroup[] = [
  {
    // REGROUPED (admin 2026-08-14). The old split was by what a tool IS; this one is by what the user
    // is DOING, which is why non-AI utilities (Versioning, Minifier, APK Builder) sit here: they are
    // the things reached while iterating on an app, next to the AI helpers used in the same breath.
    title: 'AI Tools',
    color: 'text-violet-400',
    icon: Bot,
    items: [
      { id: 'botbuilder', label: 'Bot Builder', icon: MessageSquare },
      { id: 'imagegen', label: 'AI Image Gen', icon: Wand2 },
      { id: 'debugger', label: 'AI Debugger', icon: Bug },
      { id: 'codereview', label: 'Code Review', icon: Code },
      { id: 'api', label: 'API Tester', icon: Globe },
      { id: 'versioning', label: 'Versioning', icon: GitBranch },
      { id: 'minifier', label: 'Minifier', icon: Minimize2 },
      { id: 'apk', label: 'APK Builder', icon: Smartphone },
    ],
  },
  {
    // ⚠️ ABSORBED the whole "Design & Build" group (admin 2026-08-14). That group is GONE, not empty:
    // every one of its five items was moved here by name, so leaving an empty heading behind would be
    // a dead section on the home page.
    title: 'Developer Tools',
    color: 'text-emerald-400',
    icon: Code,
    items: [
      // Database Studio was fully built (browse your own DB + read-only SQL runner + edit + CSV) but had
      // NO doorway — nothing set activeView='dbstudio', so users could not reach it. This tile is that
      // doorway (D1 gap, 2026-08-19). "See your data" is a developer/data tool, so it lives here.
      { id: 'dbstudio', label: 'Database Studio', icon: Database },
      // Built-but-unreachable tool verified to do REAL work (2026-08-19 orphan-view triage, same class as
      // dbstudio): API Marketplace inserts real, working API-integration snippets into the app. It had NO
      // doorway. The other orphans from the same audit were deliberately NOT surfaced: App Health Monitor
      // is honest but only reports NAVBHARATAI's platform uptime, not the user's app (a misleading tile);
      // AI Project Manager was FULLY FAKE (fake delay + a hardcoded task list tagged "AI Generated") and
      // is being deleted; AI Test Suite / Plugin System / Localization have real cores but fabricated
      // sub-parts (a Math.random test run, fake install counts, a fake auto-translate) and are wired only
      // after that fakery is removed — never as-is, because "real features only" outranks "more tiles".
      { id: 'apimarket', label: 'API Marketplace', icon: Package },
      // Localization: manage translation keys + export real per-language JSON (orphan-view triage,
      // 2026-08-19). Wired only after its one fake bit — a cosmetic 800ms "Translating…" delay over a
      // synchronous dictionary lookup — was removed and the button honestly says "Fill common strings".
      { id: 'localization', label: 'Localization', icon: Languages },
      // Test Generator: generates real Jest/Testing-Library test CODE from your app's code (orphan-view
      // triage, 2026-08-19). Named "Generator" not "Suite" on purpose: its fake "Run All Tests" (which
      // faked pass/fail with Math.random) was removed — a browser cannot run your Jest suite, so it
      // generates tests you copy/export and run in your project or the Test Runner beside it.
      { id: 'aitesting', label: 'Test Generator', icon: FlaskConical },
      // Plugins: a catalogue of popular integrations (GA4, Stripe, Razorpay, Clerk, shadcn…) whose "Add
      // to app" now inserts the integration's REAL setup code into your app (orphan-view triage,
      // 2026-08-19). Wired only after its fakes were removed: fabricated install/star counts, and an
      // "Install" button that used to just flip a localStorage flag without touching the app.
      { id: 'plugins', label: 'Plugins', icon: Puzzle },
      { id: 'testing', label: 'Test Runner', icon: TestTube },
      { id: 'performance', label: 'Performance', icon: Gauge },
      { id: 'multipages', label: 'Multi-Page', icon: Layout },
      { id: 'components', label: 'Components', icon: Puzzle },
      { id: 'designsys', label: 'Design System', icon: LayoutTemplate },
      { id: 'figma', label: 'Figma Import', icon: Figma },
      { id: 'darkmode', label: 'Dark Mode Gen', icon: Moon },
    ],
  },
  {
    title: 'Publish & Deploy',
    color: 'text-cyan-400',
    icon: Rocket,
    items: [
      { id: 'cicd', label: 'CI/CD Pipeline', icon: Rocket },
      // 'Multi-Cloud' moved to Settings in 2026-07-29 and was REMOVED entirely 2026-08-20 — the v5.0
      // Publish sheet already deploys to the user's own provider, so there is no second surface.
      // 'APK Builder' MOVED to AI Tools (admin 2026-08-14).
      { id: 'domain', label: 'Custom Domain', icon: Globe },
      { id: 'seo', label: 'SEO Optimizer', icon: Search },
      // 'Share for Review' PROMOTED here (E1 trust sprint): the read-only client link used to be buried
      // inside Settings → Deploy → Multi-Cloud, where nobody found it. This is now its ONE doorway —
      // the card was removed from the old Multi-Cloud screen in the same change, so there are not two rooms.
      { id: 'sharereview', label: 'Share for Review', icon: Share2 },
      // 'Nav App Store' MOVED to Monetization & Team (admin 2026-08-14): publishing there is about
      // reaching users and earning, not about shipping a build.
    ],
  },
  {
    title: 'Monetization & Team',
    color: 'text-amber-400',
    icon: IndianRupee,
    items: [
      { id: 'monetize', label: 'Monetize', icon: IndianRupee },
      { id: 'team', label: 'Team', icon: Users2 },
      { id: 'collab', label: 'Live Collab', icon: Users2 },
      { id: 'whitelabel', label: 'Whitelabel', icon: Palette },
      { id: 'analytics', label: 'Analytics', icon: TrendingUp },
      { id: 'insights', label: 'Insights & Webhooks', icon: TrendingUp },
      { id: 'gallery', label: 'Community Gallery', icon: Globe },
      // 'Nav App Store' → renamed **App Mart** and PROMOTED OUT of here to a home tile of its own
      // (admin 2026-08-16: "usko Other ke andar nahi, bahar homepage par hi ek 5th new tile"). The
      // entry is not kept here as a shortcut on purpose: this codebase has already learned that a
      // second doorway to one room makes users think there are two rooms (see the 'database' note
      // just below, and the Terminal removal in SettingsPanel). One door, on the home screen.
      // 'database' was REMOVED here (admin 2026-07-27). It opened a screen whose only real content was
      // a link to Settings → App Settings → Database — a second doorway to the same place, which made
      // users think there were two different databases to configure. The real screen stays in Settings.
    ],
  },
];
