/**
 * Feature Coverage (NavBharatAI MVP feature-generation engine).
 *
 * The core MVP requirement: a prompt's REQUESTED FEATURES must actually exist in
 * the generated app — a React shell ("mounted successfully") is NOT success.
 *
 * `extractRequestedFeatures(prompt)` parses the prompt into a checklist of known
 * features (conservative catalog — only counts a feature when clearly asked for).
 * `computeFeatureCoverage(prompt, vfs)` then scans the generated source for
 * evidence each feature is implemented and returns a coverage report. The
 * ValidationPipeline turns low coverage into a preview-blocking gate, and the
 * generator injects the checklist so the model implements every item.
 *
 * Pure + dependency-free → unit-testable. Heuristic by design (no LLM needed for
 * the gate): generous implementation signatures + a tight "requested" catalog
 * bias against false blocks.
 */
import { VirtualFileSystem } from './ProjectModel';

export interface FeatureSpec {
  id: string;
  label: string;
  /** Matches the user prompt when this feature is requested. */
  requested: RegExp;
  /** Any match in the generated source counts the feature as implemented. */
  signatures: RegExp[];
}

export interface CoverageItem { id: string; label: string; status: 'pass' | 'fail'; }
export interface CoverageReport {
  items: CoverageItem[];
  requested: number;
  implemented: number;
  /** 0–100. 100 when nothing specific was requested (nothing to miss). */
  coverage: number;
}

/** Conservative catalog of common app features with detection signatures. */
const CATALOG: FeatureSpec[] = [
  { id: 'auth', label: 'Authentication', requested: /\b(auth|authentication|login|log in|sign[- ]?in|signup|sign[- ]?up|register|account)\b/i,
    signatures: [/\b(login|signin|sign-?in|signup|sign-?up|logout|password|auth|session|currentUser|isLoggedIn)\b/i] },
  { id: 'dashboard', label: 'Dashboard', requested: /\bdashboard\b/i,
    signatures: [/dashboard/i] },
  { id: 'kanban', label: 'Kanban / Board', requested: /\b(kanban|board|drag[- ]?and[- ]?drop|columns?)\b/i,
    signatures: [/\b(kanban|column|board|drag|drop|droppable|onDrag|onDrop|dataTransfer|moveTask)\b/i] },
  { id: 'analytics', label: 'Analytics / Charts', requested: /\b(analytics|chart|charts|graph|metrics|statistics|stats)\b/i,
    signatures: [/\b(chart|<svg|canvas|graph|analytics|metric|recharts|chartjs)\b/i] },
  { id: 'search', label: 'Search', requested: /\bsearch\b/i,
    signatures: [/\b(search|query|onSearch|searchTerm)\b/i, /\.filter\(/] },
  { id: 'filter', label: 'Filter', requested: /\bfilter(s|ing)?\b/i,
    signatures: [/\bfilter\b/i, /\.filter\(/] },
  { id: 'darkmode', label: 'Dark / Light theme', requested: /\b(dark mode|dark[- ]?theme|light\/dark|theme toggle|dark and light)\b/i,
    signatures: [/\b(theme|darkMode|dark-mode|toggleTheme|prefers-color-scheme|data-theme)\b/i] },
  { id: 'persistence', label: 'Persistence (localStorage)', requested: /\b(localstorage|persist|persistence|save.*(refresh|reload)|survive.*refresh|offline)\b/i,
    signatures: [/\b(localStorage|sessionStorage|indexedDB)\b/i] },
  { id: 'routing', label: 'Routing / Multi-page', requested: /\b(route|router|routing|multi[- ]?page|pages|navigation|navbar|nav bar|menu)\b/i,
    signatures: [/\b(route|router|navigate|nav|page|view|currentPage|activeView|react-router)\b/i] },
  { id: 'crud', label: 'Create/Edit/Delete', requested: /\b(add|create|edit|update|delete|remove|crud|task|todo|item|note|expense|product)\b/i,
    signatures: [/\b(add|create|edit|update|delete|remove|onSubmit|handleAdd|handleDelete|handleSave)\b/i] },
  { id: 'form', label: 'Form + validation', requested: /\b(form|validate|validation|required field|input)\b/i,
    signatures: [/\b(form|<input|onSubmit|onChange|required|validate)\b/i] },
  // Common domain modules in ops/business apps — measured so a partial build is caught.
  { id: 'inventory', label: 'Inventory / Stock', requested: /\b(inventory|stock|supplies|consumables)\b/i,
    signatures: [/\b(inventory|stock|quantity|supplier|reorder)\b/i] },
  { id: 'incidents', label: 'Incident tracking', requested: /\bincidents?\b/i,
    signatures: [/\b(incident|severity|reporter|resolution)\b/i] },
  { id: 'notifications', label: 'Notification center', requested: /\bnotifications?\b/i,
    signatures: [/\b(notification|notif|markAsRead|unread|toast)\b/i] },
  { id: 'settings', label: 'Settings / Preferences', requested: /\bsettings\b|\bpreferences\b/i,
    signatures: [/\b(settings|preferences|profile)\b/i] },
];

/** Features the prompt explicitly asks for (a checklist to implement + verify). */
export function extractRequestedFeatures(prompt: string): FeatureSpec[] {
  const p = prompt || '';
  return CATALOG.filter((f) => f.requested.test(p));
}

/** Concatenate the generated source (excluding the scaffold placeholder). */
function sourceText(vfs: VirtualFileSystem): string {
  const SRC = /\.(jsx?|tsx?|mjs|html|css)$/i;
  const parts: string[] = [];
  for (const path of vfs.paths()) {
    if (!SRC.test(path)) continue;
    const t = vfs.readText(path);
    if (t == null) continue;
    // Ignore the untouched scaffold placeholder so a shell scores 0, not a false pass.
    if (t.includes('Hello from App') && t.length < 120) continue;
    parts.push(t);
  }
  return parts.join('\n');
}

/** Compute how many requested features are actually implemented in the VFS. */
export function computeFeatureCoverage(prompt: string, vfs: VirtualFileSystem): CoverageReport {
  const requested = extractRequestedFeatures(prompt);
  const code = sourceText(vfs);
  const items: CoverageItem[] = requested.map((f) => ({
    id: f.id,
    label: f.label,
    status: f.signatures.some((re) => re.test(code)) ? 'pass' : 'fail',
  }));
  const implemented = items.filter((i) => i.status === 'pass').length;
  const coverage = requested.length === 0 ? 100 : Math.round((implemented / requested.length) * 100);
  return { items, requested: requested.length, implemented, coverage };
}

/** A checklist string to inject into the generation prompt so the model builds everything. */
export function featureChecklist(prompt: string): string {
  const features = extractRequestedFeatures(prompt);
  if (!features.length) return '';
  return `MANDATORY FEATURE CHECKLIST — implement EVERY item with real, working code (no placeholders):\n`
    + features.map((f) => `- ${f.label}`).join('\n');
}
