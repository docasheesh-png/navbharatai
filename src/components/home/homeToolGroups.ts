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
    title: 'AI Tools',
    color: 'text-violet-400',
    icon: Bot,
    items: [
      { id: 'botbuilder', label: 'Bot Builder', icon: MessageSquare },
      { id: 'imagegen', label: 'AI Image Gen', icon: Wand2 },
      { id: 'debugger', label: 'AI Debugger', icon: Bug },
      { id: 'codereview', label: 'Code Review', icon: Code },
    ],
  },
  {
    title: 'Developer Tools',
    color: 'text-emerald-400',
    icon: Code,
    items: [
      { id: 'testing', label: 'Test Runner', icon: TestTube },
      { id: 'api', label: 'API Tester', icon: Globe },
      { id: 'versioning', label: 'Versioning', icon: GitBranch },
      { id: 'performance', label: 'Performance', icon: Gauge },
      { id: 'minifier', label: 'Minifier', icon: Minimize2 },
    ],
  },
  {
    title: 'Design & Build',
    color: 'text-pink-400',
    icon: Palette,
    items: [
      { id: 'multipages', label: 'Multi-Page', icon: Layout },
      { id: 'components', label: 'Components', icon: Puzzle },
      { id: 'designsys', label: 'Design System', icon: LayoutTemplate },
      { id: 'darkmode', label: 'Dark Mode Gen', icon: Moon },
      { id: 'figma', label: 'Figma Import', icon: Figma },
    ],
  },
  {
    title: 'Publish & Deploy',
    color: 'text-cyan-400',
    icon: Rocket,
    items: [
      { id: 'apk', label: 'APK Builder', icon: Smartphone },
      { id: 'cicd', label: 'CI/CD Pipeline', icon: Rocket },
      // 'Multi-Cloud' MOVED to Settings → App Settings → Multi-Cloud Deploy (admin 2026-07-29).
      { id: 'domain', label: 'Custom Domain', icon: Globe },
      { id: 'seo', label: 'SEO Optimizer', icon: Search },
      { id: 'appstore', label: 'Nav App Store', icon: Package },
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
      // 'database' was REMOVED here (admin 2026-07-27). It opened a screen whose only real content was
      // a link to Settings → App Settings → Database — a second doorway to the same place, which made
      // users think there were two different databases to configure. The real screen stays in Settings.
    ],
  },
];
