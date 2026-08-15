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
import {
  Bot, MessageSquare, Wand2, Bug, Code, TestTube, Globe, GitBranch, Gauge, Minimize2,
  Palette, Layout, Puzzle, LayoutTemplate, Moon, Figma, Rocket, Smartphone, CloudUpload, Search,
  Package, IndianRupee, Users2, TrendingUp,
} from 'lucide-react';

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
      // 'Multi-Cloud' MOVED to Settings → App Settings → Multi-Cloud Deploy (admin 2026-07-29).
      // 'APK Builder' MOVED to AI Tools (admin 2026-08-14).
      { id: 'domain', label: 'Custom Domain', icon: Globe },
      { id: 'seo', label: 'SEO Optimizer', icon: Search },
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
      { id: 'appstore', label: 'Nav App Store', icon: Package },
      // 'database' was REMOVED here (admin 2026-07-27). It opened a screen whose only real content was
      // a link to Settings → App Settings → Database — a second doorway to the same place, which made
      // users think there were two different databases to configure. The real screen stays in Settings.
    ],
  },
];
