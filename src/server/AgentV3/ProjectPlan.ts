// AgentV3 — Software Project Mode (SPM): the durable module plan for LARGE builds.
//
// Why this exists (admin mandate, 2026-07-04): v5.0 builds every app inside ONE agentic
// conversation. That works up to roughly 40–80 files, then five ceilings kill it: the single
// context window fills, the step cap (80) runs out, the wall clock (30–60 min) expires, the
// budget cap trips, and verification is tuned for small apps. A 1000–5000-file software project
// can NEVER fit in one conversation — no matter how good the model is.
//
// Software Project Mode fixes the ARCHITECTURE instead of raising the caps: the project is
// decomposed ONCE into modules with explicit dependencies and frozen export contracts, the plan
// is persisted durably, and then EACH build turn constructs one module in a FRESH context that
// contains only (a) that module's spec and (b) the contracts of already-done modules — never the
// full transcript. The existing bounded auto-continue then drives turn after turn until every
// module is done. Context stays small forever, so project size is bounded by the plan, not by
// the window.
//
// This file is the PURE data layer: types, planner-output parsing, dependency-ordered
// scheduling, progress/todo projection, and the per-module build context. No I/O, no SDKs —
// fully unit-testable. Durable persistence lives in ProjectPlanStore.ts.

import type { TodoItem, TodoStatus } from './types';
import { parseEnvFlag } from '../lib/envFlag';

export type ModuleStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface ProjectModule {
  /** Stable slug id, e.g. "m1-data-model". Unique within the plan. */
  id: string;
  name: string;
  /** What this module delivers — the build instruction for its turn. */
  description: string;
  /** Ids of modules that must be DONE before this one can build. */
  dependsOn: string[];
  /** File paths this module owns (relative to the project root). */
  files: string[];
  /**
   * The frozen export contract: TypeScript declarations of everything OTHER modules may import
   * from this one. This is the only cross-module interface — later modules import against these
   * exact names, which is what keeps 50 independent build turns coherent.
   */
  contracts: string;
  status: ModuleStatus;
  /** Honest failure detail when status === 'failed' (e.g. the gate error that stopped it). */
  statusDetail?: string;
  /**
   * GA-7 — how many times this module's build turn has FAILED. Incremented by markModuleStatus on a
   * 'failed' transition; drives the coordinator's live-replan threshold (repeated deterministic
   * failure → an LLM plan revision). Absent/0 means it has not failed yet.
   */
  attempts?: number;
}

export interface ProjectPlan {
  version: 1;
  /** The user's original ask, bounded — carried so every module turn knows the real goal. */
  goal: string;
  framework: string;
  createdAt: number;
  modules: ProjectModule[];
}

// ── Bounds (honest caps — logged/surfaced by callers, never silently exceeded) ────────────────
export const MAX_MODULES = 60;
export const MAX_FILES_PER_MODULE = 150;
export const MAX_CONTRACT_CHARS = 12_000;
export const MAX_DESCRIPTION_CHARS = 1_200;
const MAX_GOAL_CHARS = 4_000;

/** Same unsafe-path rules as the file manifest: no absolute, no traversal, no heavy dirs. */
const UNSAFE_PATH_RE = /^(node_modules|\.git|dist|build)\//;

function safeModuleFile(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const path = p.trim().replace(/^["'`]|["'`]$/g, '');
  if (!path || path.startsWith('/') || path.includes('..') || path.length > 300) return null;
  if (UNSAFE_PATH_RE.test(path)) return null;
  return path;
}

function slugify(s: string, fallback: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || fallback;
}

// ── Project-mode gating (pure, conservative) ──────────────────────────────────────────────────

/** Fewer than this many parsed modules means the ask was not really a mega-project — the build
 *  then runs the normal path (project mode must never make a small build slower/costlier). */
export const MIN_PROJECT_MODULES = 3;

/**
 * Master gate for Software Project Mode. AGENTV3_PROJECT_MODE:
 *   • 'on'          → enabled for ALL users,
 *   • 'off' / unset → disabled (default — the kill switch),
 *   • anything else → treated as an ALLOWLIST of user ids/emails (comma/space separated), so the
 *     admin can enable SPM for their OWN account first and test a real mega-build safely before
 *     turning it on for everyone. A gradual, reversible rollout for a heavyweight feature.
 * PURE.
 */
export function projectModeEnabled(
  env: NodeJS.ProcessEnv = process.env,
  identity?: { userId?: string | null; email?: string | null },
): boolean {
  const flag = (env.AGENTV3_PROJECT_MODE || '').trim();
  // A plain on/off answer wins; anything else is read as an allowlist of uids/emails below.
  const plain = parseEnvFlag(flag);
  if (plain !== null) return plain;
  if (!flag) return false;
  const allow = new Set(flag.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));
  const uid = (identity?.userId || '').toLowerCase();
  const email = (identity?.email || '').toLowerCase();
  return (!!uid && allow.has(uid)) || (!!email && allow.has(email));
}

/**
 * Conservative mega-project detection — HIGH precision on purpose. A false positive would route
 * an ordinary app through module decomposition (slower + an extra planner call); a false negative
 * just builds exactly as today. Fires only on a clear signal:
 *   A. an explicit large scale: "N files/pages/screens/modules" with N >= 100, or
 *   B. a big-software category noun (ERP/CRM/management system/SaaS platform/…) AND >= 8
 *      enumerated feature lines, or
 *   C. >= 14 enumerated feature lines (a spec that long is a project, whatever it's called).
 * PURE.
 */
export function detectMegaProject(prompt: string): boolean {
  const text = (prompt || '').toLowerCase();
  const scale = text.match(/(\d{2,6})\s*\+?\s*(?:files?|pages?|screens?|modules?)/);
  if (scale && Number(scale[1]) >= 100) return true;
  const bullets = (prompt || '').split('\n').filter((l) => /^\s*(?:[-*•]|\d{1,3}[.)])\s+\S/.test(l)).length;
  const bigNoun = /\b(?:erp|crm|lms|hms|hrms|pos)\b|management system|management software|enterprise|saas platform|multi[- ]tenant|marketplace|social network|super ?app|full[- ](?:fledged|scale)/i.test(text);
  if (bigNoun && bullets >= 8) return true;
  return bullets >= 14;
}

/**
 * Is this turn's message a "keep going" continuation (vs a NEW substantive instruction)? When a
 * project plan already exists, only a continuation advances it to the next module — a substantive
 * message (an edit request, a question) is handled by the normal build path so the user's actual
 * ask is never steamrolled into "build module N". Matches the client's literal auto-continue
 * prompt ('continue') plus common English + Hinglish phrasings. PURE.
 */
export function isContinuationMessage(prompt: string): boolean {
  const t = (prompt || '').trim().toLowerCase();
  if (!t || t.length > 80) return false;
  return /^(?:please\s+|ok(?:ay)?[,\s]+|haan?[,\s]+)*(?:continue|resume|proceed|carry on|keep going|go on|next(?: module| step)?|finish(?: it)?|complete(?: it)?|aage(?: barh| badh)(?:o|ao|iye)?|jari rakho|chalu rakho|continue karo|next banao|aage chalo)(?:\s+(?:building|the build|the project|karo|karo!|it))?[\s!.।]*$/i.test(t);
}

// ── Parsing the planner's output ──────────────────────────────────────────────────────────────

/**
 * Extract the first JSON array from arbitrary model output (the planner is asked for a bare JSON
 * array, but models wrap it in fences/prose often enough that tolerant extraction is mandatory).
 * Returns null when no parseable array exists. PURE.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const t = (text || '').trim();
  // Fast path: the whole reply is the array.
  const direct = tryParseArray(t);
  if (direct) return direct;
  // Fenced block.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParseArray(fence[1].trim());
    if (fenced) return fenced;
  }
  // First bracket-balanced array anywhere in the text.
  const start = t.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return tryParseArray(t.slice(start, i + 1));
    }
  }
  return null;
}

function tryParseArray(s: string): unknown[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Parse + sanitize the planner's module list. Tolerant of prose/fences around the JSON; strict
 * about the result: ids are deduped and slugged, unsafe file paths dropped, unknown/self
 * dependencies removed, all fields bounded. Modules with no usable name are dropped. Returns []
 * when nothing valid could be parsed (the caller then falls back to the normal build path —
 * project mode must never be able to make a build WORSE than today). PURE.
 */
export function parsePlannedModules(text: string): ProjectModule[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];
  const out: ProjectModule[] = [];
  const usedIds = new Set<string>();
  for (const item of raw.slice(0, MAX_MODULES)) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const name = typeof m.name === 'string' ? m.name.trim().slice(0, 120) : '';
    if (!name) continue;
    let id = slugify(typeof m.id === 'string' && m.id.trim() ? m.id : name, `m${out.length + 1}`);
    // Ids must be unique — a duplicate would corrupt the dependency graph.
    while (usedIds.has(id)) id = `${id.slice(0, 56)}-${out.length + 1}`;
    usedIds.add(id);
    const files = (Array.isArray(m.files) ? m.files : [])
      .map(safeModuleFile)
      .filter((p): p is string => !!p)
      .slice(0, MAX_FILES_PER_MODULE);
    out.push({
      id,
      name,
      description: (typeof m.description === 'string' ? m.description.trim() : '').slice(0, MAX_DESCRIPTION_CHARS),
      dependsOn: (Array.isArray(m.dependsOn) ? m.dependsOn : [])
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim())
        .filter(Boolean),
      files,
      contracts: (typeof m.contracts === 'string' ? m.contracts.trim() : '').slice(0, MAX_CONTRACT_CHARS),
      status: 'pending',
    });
  }
  // Second pass: dependsOn may reference planner-emitted ids OR names — normalize both to the
  // final slug ids; drop unknown ids and self-references (they would deadlock scheduling).
  const aliases = new Map<string, string>();
  let rawIdx = 0;
  for (const item of raw.slice(0, MAX_MODULES)) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const name = typeof m.name === 'string' ? m.name.trim().slice(0, 120) : '';
    if (!name) continue;
    const finalId = out[rawIdx]?.id;
    rawIdx++;
    if (!finalId) continue;
    aliases.set(finalId, finalId);
    if (typeof m.id === 'string' && m.id.trim()) aliases.set(m.id.trim(), finalId);
    aliases.set(name, finalId);
    aliases.set(slugify(name, finalId), finalId);
  }
  for (const mod of out) {
    mod.dependsOn = [...new Set(
      mod.dependsOn
        .map((d) => aliases.get(d) ?? aliases.get(slugify(d, '')) ?? null)
        .filter((d): d is string => !!d && d !== mod.id),
    )];
  }
  return out;
}

/** Assemble a fresh plan. `now` is injected so tests are deterministic. PURE. */
export function createProjectPlan(goal: string, framework: string, modules: ProjectModule[], now: number): ProjectPlan {
  return {
    version: 1,
    goal: (goal || '').slice(0, MAX_GOAL_CHARS),
    framework: framework || 'vite-react',
    createdAt: now,
    modules,
  };
}

// ── Scheduling ────────────────────────────────────────────────────────────────────────────────

/**
 * The next module a build turn should construct: an interrupted `in_progress` module first
 * (resume what a paused turn started), else the first `pending` module whose dependencies are
 * all `done`. Returns null when nothing is buildable — either the plan is complete, or it is
 * BLOCKED (failed dependency / dependency cycle); use planBlockedReason to tell those apart
 * honestly. PURE.
 */
export function nextBuildableModule(plan: ProjectPlan): ProjectModule | null {
  const done = new Set(plan.modules.filter((m) => m.status === 'done').map((m) => m.id));
  const inProgress = plan.modules.find((m) => m.status === 'in_progress');
  if (inProgress) return inProgress;
  return plan.modules.find((m) => m.status === 'pending' && m.dependsOn.every((d) => done.has(d))) ?? null;
}

/** True when every module is done. PURE. */
export function planComplete(plan: ProjectPlan): boolean {
  return plan.modules.length > 0 && plan.modules.every((m) => m.status === 'done');
}

/**
 * Why the plan cannot advance, when it can't: a failed module other modules depend on, a failed
 * module full stop, or a dependency cycle among the pending modules. Returns null when the plan
 * can advance (or is complete). PURE.
 */
export function planBlockedReason(plan: ProjectPlan): string | null {
  if (planComplete(plan)) return null;
  if (nextBuildableModule(plan)) return null;
  const failed = plan.modules.filter((m) => m.status === 'failed');
  if (failed.length > 0) {
    const first = failed[0];
    return `Module "${first.name}" failed${first.statusDetail ? ` (${first.statusDetail})` : ''} — modules depending on it cannot build until it is fixed.`;
  }
  const pending = plan.modules.filter((m) => m.status === 'pending');
  if (pending.length > 0) {
    return `The remaining ${pending.length} module(s) have a circular dependency and none can start — the plan needs to be repaired.`;
  }
  return 'The plan has no buildable module left but is not complete.';
}

/** Immutable status update. Unknown id → the plan is returned unchanged. PURE.
 *  GA-7: a transition INTO 'failed' increments the module's attempts counter (the live-replan
 *  threshold reads it across turns); other transitions leave attempts untouched. */
export function markModuleStatus(plan: ProjectPlan, id: string, status: ModuleStatus, detail?: string): ProjectPlan {
  if (!plan.modules.some((m) => m.id === id)) return plan;
  return {
    ...plan,
    modules: plan.modules.map((m) => {
      if (m.id !== id) return m;
      const next: ProjectModule = { ...m, status };
      if (detail) next.statusDetail = detail.slice(0, 500);
      else delete next.statusDetail;
      if (status === 'failed') next.attempts = (m.attempts ?? 0) + 1;
      return next;
    }),
  };
}

/** Progress counts + a one-line honest summary. PURE. */
export function planProgress(plan: ProjectPlan): { done: number; failed: number; total: number; complete: boolean } {
  const done = plan.modules.filter((m) => m.status === 'done').length;
  const failed = plan.modules.filter((m) => m.status === 'failed').length;
  return { done, failed, total: plan.modules.length, complete: planComplete(plan) };
}

export function planProgressLine(plan: ProjectPlan): string {
  const p = planProgress(plan);
  const current = plan.modules.find((m) => m.status === 'in_progress');
  const parts = [`Project plan: ${p.done}/${p.total} modules done`];
  if (current) parts.push(`building "${current.name}"`);
  if (p.failed > 0) parts.push(`${p.failed} failed`);
  return parts.join(' — ');
}

// ── Projections ───────────────────────────────────────────────────────────────────────────────

/**
 * Project the module plan onto the EXISTING todos UI (todo_updated events / PLAN_STATE) — zero
 * new client surface. failed → blocked (the honest visual: a red flag, not silent). PURE.
 */
export function projectPlanTodos(plan: ProjectPlan): TodoItem[] {
  const statusMap: Record<ModuleStatus, TodoStatus> = {
    pending: 'pending',
    in_progress: 'in_progress',
    done: 'done',
    failed: 'blocked',
  };
  return plan.modules.map((m) => ({ id: m.id, title: m.name, status: statusMap[m.status] }));
}

/**
 * The prompt block for ONE module's build turn — the whole point of project mode. It contains
 * the project goal, THIS module's spec (description + owned files + its own frozen contract),
 * and the contracts of DONE modules only (the interface graph). It deliberately contains NO
 * transcript, NO other module's description, and NO pending module details — that is what keeps
 * a 5000-file project's per-turn context small and constant. PURE.
 */
export function moduleBuildContext(plan: ProjectPlan, mod: ProjectModule): string {
  const p = planProgress(plan);
  const doneContracts = plan.modules
    .filter((m) => m.status === 'done' && m.contracts)
    .map((m) => `// ── module ${m.id} (${m.name}) — already built, import against these EXACT names ──\n${m.contracts}`);
  // GA-7 coordination: where this module sits in the delivery plan + its specialist role.
  const ms = moduleMilestone(plan, mod.id);
  const role = assignModuleRole(mod);
  const lines = [
    `SOFTWARE PROJECT MODE — you are building ONE module of a larger project (${p.done}/${p.total} modules already done).`,
    ...(ms ? [`COORDINATION: milestone ${ms.index}/${ms.total} · role: ${role}. Stay within this module's role and milestone scope.`] : []),
    '',
    `PROJECT GOAL:\n${plan.goal}`,
    '',
    `THIS TURN'S MODULE — build ONLY this, completely and really:`,
    `  id: ${mod.id}`,
    `  name: ${mod.name}`,
    `  what it delivers: ${mod.description || mod.name}`,
    ...(mod.files.length > 0 ? [`  files it owns:\n${mod.files.map((f) => `    - ${f}`).join('\n')}`] : []),
    ...(mod.contracts
      ? ['', 'THIS MODULE\'S FROZEN EXPORT CONTRACT — implement these EXACT exports (other modules will import them by these names):', '```ts', mod.contracts, '```']
      : []),
    ...(doneContracts.length > 0
      ? ['', 'ALREADY-BUILT MODULES — their files exist in the workspace. Import from them using ONLY these frozen contracts; do NOT rewrite, re-scaffold, or "improve" their files:', '```ts', doneContracts.join('\n\n'), '```']
      : []),
    '',
    'RULES:',
    '- Build THIS module only. Do not start other modules; they get their own turns.',
    '- Do not modify files owned by already-done modules except where this module must register itself (e.g. adding a route/import to an app-level composition file).',
    '- Real, complete code — no TODOs, no placeholders. The module must compile when you finish.',
  ];
  return lines.join('\n');
}

// ── GA-7 (project coordinator) — milestones + role coordination projections ─────────────────────
//
// The module DAG already schedules work (nextBuildableModule) and projects progress (planProgress).
// GA-7 adds the coordination LAYER on top of that same DAG, all pure: group modules into
// dependency-ordered MILESTONES (deliverable phases), assign each module a specialist ROLE, and
// render a coordinator digest. These are surfaced into the per-module build context (below) so the
// builder knows where its module sits — no new client surface, no orchestration change.

export type ModuleRole = 'frontend' | 'backend' | 'data' | 'devops' | 'test' | 'general';

export interface Milestone {
  /** 1-based position in the delivery order. */
  index: number;
  total: number;
  /** Modules in this milestone (same dependency depth — buildable in parallel). */
  moduleIds: string[];
}

/** Dependency depth of every module: 0 = no deps, else 1 + max(dep depth). Cycle-safe (bounded). PURE. */
export function moduleDepths(plan: ProjectPlan): Map<string, number> {
  const byId = new Map(plan.modules.map((m) => [m.id, m]));
  const depth = new Map<string, number>();
  const computing = new Set<string>();
  const of = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const m = byId.get(id);
    if (!m || m.dependsOn.length === 0) { depth.set(id, 0); return 0; }
    if (computing.has(id)) return 0; // a cycle — break it deterministically at depth 0
    computing.add(id);
    let d = 0;
    for (const dep of m.dependsOn) if (byId.has(dep)) d = Math.max(d, of(dep) + 1);
    computing.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const m of plan.modules) of(m.id);
  return depth;
}

/** Group modules into dependency-ordered milestones (one per distinct depth). PURE. */
export function computeMilestones(plan: ProjectPlan): Milestone[] {
  if (!plan.modules.length) return [];
  const depth = moduleDepths(plan);
  const byDepth = new Map<number, string[]>();
  for (const m of plan.modules) {
    const d = depth.get(m.id) ?? 0;
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(m.id);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  return depths.map((d, i) => ({ index: i + 1, total: depths.length, moduleIds: byDepth.get(d)!.slice() }));
}

const ROLE_FILE_RULES: Array<{ role: ModuleRole; re: RegExp }> = [
  { role: 'test', re: /\.(test|spec)\.[jt]sx?$|(^|\/)(tests?|__tests__)\//i },
  { role: 'data', re: /\.(prisma|sql)$|(^|\/)(migrations?|schema|models?|entities)\//i },
  { role: 'devops', re: /dockerfile|\.ya?ml$|(^|\/)(\.github|deploy|infra|k8s|helm)\//i },
  { role: 'backend', re: /(^|\/)(server|api|routes?|controllers?|services?|backend)\/|\.(controller|service|route)\.[jt]s$/i },
  { role: 'frontend', re: /\.(tsx|jsx|vue|svelte|css|scss|html?)$|(^|\/)(components?|pages?|views?|ui|client)\//i },
];
const ROLE_KEYWORDS: Array<{ role: ModuleRole; re: RegExp }> = [
  { role: 'data', re: /\b(database|schema|migration|model|prisma|entity|orm)\b/i },
  { role: 'backend', re: /\b(api|endpoint|server|route|auth|controller|service|webhook)\b/i },
  { role: 'frontend', re: /\b(ui|component|page|screen|form|dashboard|layout|styl)\b/i },
  { role: 'devops', re: /\b(deploy|docker|ci\/cd|pipeline|infrastructure|kubernetes)\b/i },
  { role: 'test', re: /\b(test|spec|coverage|e2e)\b/i },
];

/** Heuristically assign a module to a specialist role, by its files first, then its description. PURE. */
export function assignModuleRole(mod: ProjectModule): ModuleRole {
  const votes = new Map<ModuleRole, number>();
  for (const f of mod.files || []) for (const r of ROLE_FILE_RULES) if (r.re.test(f)) votes.set(r.role, (votes.get(r.role) ?? 0) + 1);
  if (votes.size > 0) return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const text = `${mod.name} ${mod.description || ''}`;
  for (const r of ROLE_KEYWORDS) if (r.re.test(text)) return r.role;
  return 'general';
}

/** The milestone (1-based index + total) a module belongs to, or null if not in the plan. PURE. */
export function moduleMilestone(plan: ProjectPlan, moduleId: string): { index: number; total: number } | null {
  const milestones = computeMilestones(plan);
  const m = milestones.find((ms) => ms.moduleIds.includes(moduleId));
  return m ? { index: m.index, total: m.total } : null;
}

/** A coordinator's status digest: milestone progress + what's building + any block. PURE; '' for an empty plan. */
export function coordinatorDigest(plan: ProjectPlan): string {
  if (!plan.modules.length) return '';
  const milestones = computeMilestones(plan);
  const done = new Set(plan.modules.filter((m) => m.status === 'done').map((m) => m.id));
  const doneMilestones = milestones.filter((ms) => ms.moduleIds.every((id) => done.has(id))).length;
  const current = plan.modules.find((m) => m.status === 'in_progress');
  const parts = [`Coordinator: milestone ${Math.min(doneMilestones + 1, milestones.length)}/${milestones.length}`];
  if (current) parts.push(`building "${current.name}" [${assignModuleRole(current)}]`);
  const blocked = planBlockedReason(plan);
  if (blocked) parts.push(`BLOCKED — ${blocked}`);
  return parts.join(' — ');
}

// ── Durable serialization ─────────────────────────────────────────────────────────────────────

export function serializeProjectPlan(plan: ProjectPlan): string {
  return JSON.stringify(plan);
}

const VALID_STATUS = new Set<ModuleStatus>(['pending', 'in_progress', 'done', 'failed']);

/**
 * Parse a stored plan back. Strict enough that corrupt storage can never produce a half-valid
 * plan (which would silently mis-schedule modules): wrong version, missing fields, or an invalid
 * module → null, and the caller re-plans. Never throws. PURE.
 */
export function parseStoredProjectPlan(text: string | null | undefined): ProjectPlan | null {
  if (!text || typeof text !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.version !== 1 || typeof p.goal !== 'string' || typeof p.framework !== 'string' || typeof p.createdAt !== 'number' || !Array.isArray(p.modules)) return null;
  const modules: ProjectModule[] = [];
  for (const item of p.modules) {
    if (!item || typeof item !== 'object') return null;
    const m = item as Record<string, unknown>;
    if (typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name) return null;
    if (typeof m.status !== 'string' || !VALID_STATUS.has(m.status as ModuleStatus)) return null;
    modules.push({
      id: m.id,
      name: m.name,
      description: typeof m.description === 'string' ? m.description : '',
      dependsOn: (Array.isArray(m.dependsOn) ? m.dependsOn : []).filter((d): d is string => typeof d === 'string'),
      files: (Array.isArray(m.files) ? m.files : []).filter((f): f is string => typeof f === 'string'),
      contracts: typeof m.contracts === 'string' ? m.contracts : '',
      status: m.status as ModuleStatus,
      ...(typeof m.statusDetail === 'string' ? { statusDetail: m.statusDetail } : {}),
      ...(typeof m.attempts === 'number' && m.attempts > 0 ? { attempts: m.attempts } : {}),
    });
  }
  return { version: 1, goal: p.goal, framework: p.framework, createdAt: p.createdAt, modules };
}

// ── Planner prompts (module decomposition — ONE call per project, before any build turn) ──────

export function projectPlanSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} software architect decomposing a LARGE software project into`,
    'independently-buildable MODULES. Each module will later be built in its own isolated session',
    'that sees ONLY (a) its own spec and (b) the export contracts of already-built modules — so',
    'the decomposition and the contracts are the ONLY way the modules can fit together.',
    '',
    'OUTPUT: a single JSON array (no prose, no markdown fences). Each element:',
    '{',
    '  "id": "m1-short-slug",',
    '  "name": "Human-readable module name",',
    '  "description": "Exactly what this module delivers, concrete enough to build from alone",',
    '  "dependsOn": ["ids of modules whose exports this one imports"],',
    '  "files": ["every/file/this/module/owns.ts"],',
    '  "contracts": "TypeScript declarations of every export OTHER modules may import from this one"',
    '}',
    '',
    'RULES:',
    '- Order modules foundation-first: shared types/config → data/services → features → app shell.',
    '- Every module must be completable in ONE focused session (roughly 10–60 files each).',
    '- dependsOn must reference EARLIER modules only — no cycles, no forward references.',
    '- contracts: exact exported names, types, and signatures — frozen; later modules import these',
    '  verbatim. A module with nothing importable uses "" (e.g. a pure pages module).',
    '- files: relative paths from the project root; each file belongs to exactly ONE module.',
    '- Do NOT list node_modules, lockfiles, or build output.',
    `- At most ${MAX_MODULES} modules. Prefer fewer, larger, coherent modules over many fragments.`,
  ].join('\n');
}

export function projectPlanUserPrompt(goal: string, scaffoldPaths: string[]): string {
  const scaffold = scaffoldPaths.length
    ? `Already scaffolded in the workspace (build on top of these; the app-shell module edits them):\n${scaffoldPaths.slice(0, 80).map((p) => `  - ${p}`).join('\n')}`
    : 'The project starts from an empty scaffold.';
  return [
    `Decompose this software project into buildable modules:\n\n${goal}`,
    '',
    scaffold,
    '',
    'Output the JSON array of modules now.',
  ].join('\n');
}
