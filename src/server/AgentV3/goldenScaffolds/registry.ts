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
import { proUiTsx, proStoreTs } from './proShell';
import { saasDashboardAppTsx, crmAppTsx, storeAppTsx } from './proApps';

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
}

/**
 * The shared foundation a PRO scaffold is built on. Kept out of the simple apps so a to-do list never
 * carries a CRM's furniture — the simple tier's whole value is that it is small.
 */
const PRO_SHARED_FILES: Record<string, string> = {
  'src/lib/ui.tsx': proUiTsx,
  'src/lib/store.ts': proStoreTs,
};

export const GOLDEN_SCAFFOLDS: readonly GoldenScaffold[] = [
  // ── SIMPLE tier: the scaffold IS the app ──
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
  // ── PRO tier: a compile-proven architecture the builder extends ──
  { id: 'saas-dashboard', label: 'SaaS dashboard', title: 'SaaS Dashboard', appTsx: saasDashboardAppTsx, tier: 'pro' },
  { id: 'crm', label: 'CRM / pipeline', title: 'Pipeline CRM', appTsx: crmAppTsx, tier: 'pro' },
  { id: 'store', label: 'Online store', title: 'Online Store', appTsx: storeAppTsx, tier: 'pro' },
];

/**
 * The complete runnable file map for one golden scaffold: the platform base + its App.tsx, plus the
 * shared pro foundation when this is a pro scaffold. Pure.
 */
export function goldenScaffoldFiles(s: GoldenScaffold): Record<string, string> {
  const base = goldenBaseFiles(s.title, s.appTsx);
  return s.tier === 'pro' ? { ...base, ...PRO_SHARED_FILES } : base;
}

/** Whitespace/trailing-punctuation-insensitive prompt normalization for the exact-chip match. */
function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!?]+$/g, '').trim();
}

/**
 * The golden scaffold for a build prompt, or null. Matches ONLY when the prompt is (modulo whitespace
 * and trailing punctuation) EXACTLY a simple starter-template chip prompt — a user who edited the
 * prompt has asked for something else, so they get a normal from-scratch build (no surprise template).
 * Pure.
 */
export function goldenScaffoldForPrompt(prompt: string): GoldenScaffold | null {
  const p = norm(prompt);
  if (!p) return null;
  for (const t of STARTER_TEMPLATES) {
    // Any tier may have a scaffold now; a chip WITHOUT one simply falls through to a normal build,
    // which is why this looks the scaffold up rather than assuming one exists.
    if (norm(t.prompt) === p) {
      return GOLDEN_SCAFFOLDS.find((g) => g.id === t.id) ?? null;
    }
  }
  return null;
}
