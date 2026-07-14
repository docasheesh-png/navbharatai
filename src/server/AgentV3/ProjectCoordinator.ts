// GA-7 — Project Coordinator: live-replan + specialist arbitration.
//
// The module DAG (ProjectPlan) already schedules work, projects progress, and survives across
// sessions (ProjectPlanStore). What it did NOT do: repair itself. A failed module just flipped to
// 'failed' and blocked its dependents; a dependency CYCLE was reported as permanently blocked with
// nothing to fix it; and two modules could silently own the same file or export the same symbol with
// no arbitration. This module adds the coordination LOGIC that a "standing coordinator" would provide,
// computed synchronously at the turn points where the plan is already loaded/settled — no daemon, no
// VM, no external service (the literal always-on background process stays an honest open infra residue).
//
// Everything here is PURE and unit-tested. The route wires it in additively (behind the existing
// project-mode try/catch), so any failure falls back to today's behaviour — never worse (SPM invariant).

import {
  type ProjectPlan,
  type ProjectModule,
  moduleDepths,
  nextBuildableModule,
  planComplete,
} from './ProjectPlan';

/** A file owned (listed) by more than one module. */
export interface OwnershipConflict {
  file: string;
  moduleIds: string[];
}

/** An exported symbol declared in more than one module's contract. */
export interface ContractCollision {
  symbol: string;
  moduleIds: string[];
}

/** After this many failed build turns on a still-not-done module, deterministic repair is exhausted
 *  and the coordinator asks for an LLM plan revision. */
export const LLM_REPLAN_THRESHOLD = 2;

/** Files listed by >1 module — a specialist-arbitration conflict (two owners for one file). PURE. */
export function detectOwnershipConflicts(plan: ProjectPlan): OwnershipConflict[] {
  const byFile = new Map<string, string[]>();
  for (const m of plan.modules) {
    for (const f of m.files || []) {
      const arr = byFile.get(f) ?? byFile.set(f, []).get(f)!;
      if (!arr.includes(m.id)) arr.push(m.id);
    }
  }
  const out: OwnershipConflict[] = [];
  for (const [file, moduleIds] of byFile) if (moduleIds.length > 1) out.push({ file, moduleIds });
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Exported identifiers a module's contract declares. Handles `export const/function/class/interface/
 *  type/enum Name` and `export { a, b as c }`. PURE. */
function exportedSymbols(contract: string): string[] {
  const out = new Set<string>();
  const text = String(contract || '');
  const declRe = /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text)) !== null) out.add(m[1]);
  const groupRe = /export\s*\{([^}]*)\}/g;
  while ((m = groupRe.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return [...out];
}

/** Symbols exported by >1 module's contract — a cross-module name collision. PURE. */
export function detectContractCollisions(plan: ProjectPlan): ContractCollision[] {
  const bySymbol = new Map<string, string[]>();
  for (const m of plan.modules) {
    for (const sym of exportedSymbols(m.contracts)) {
      const arr = bySymbol.get(sym) ?? bySymbol.set(sym, []).get(sym)!;
      if (!arr.includes(m.id)) arr.push(m.id);
    }
  }
  const out: ContractCollision[] = [];
  for (const [symbol, moduleIds] of bySymbol) if (moduleIds.length > 1) out.push({ symbol, moduleIds });
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** True when the plan is blocked PURELY by a dependency cycle: nothing buildable, nothing failed, but
 *  pending modules remain (so it's not a failure block and not complete). PURE. */
function blockedByCycleOnly(plan: ProjectPlan): boolean {
  if (planComplete(plan)) return false;
  if (nextBuildableModule(plan)) return false;
  if (plan.modules.some((m) => m.status === 'failed')) return false;
  return plan.modules.some((m) => m.status === 'pending');
}

/**
 * Repair a plan that is blocked purely by a dependency cycle among its pending modules, by deleting
 * back-edges deterministically until a module becomes buildable. The edge cut each round is the
 * dependency with the HIGHEST depth (the most "downstream" back-edge), ties broken by
 * lexicographically-lowest (module, dep) — so the repair is stable and reproducible. PURE.
 */
export function repairPlanCycles(plan: ProjectPlan): { plan: ProjectPlan; changed: boolean; removed: Array<{ module: string; dep: string }> } {
  const removed: Array<{ module: string; dep: string }> = [];
  let current = plan;
  // Bound the loop to the number of edges (can never need more cuts than edges).
  const maxCuts = current.modules.reduce((n, m) => n + (m.dependsOn?.length || 0), 0);
  for (let i = 0; i < maxCuts; i++) {
    if (!blockedByCycleOnly(current)) break;
    const depth = moduleDepths(current);
    const doneOrRemoved = new Set(current.modules.filter((m) => m.status === 'done').map((m) => m.id));
    const validId = new Set(current.modules.map((m) => m.id));
    // Candidate back-edges: a pending module → an unmet, in-plan dependency.
    const candidates: Array<{ module: string; dep: string; depDepth: number }> = [];
    for (const m of current.modules) {
      if (m.status !== 'pending') continue;
      for (const dep of m.dependsOn) {
        if (!validId.has(dep) || doneOrRemoved.has(dep)) continue;
        candidates.push({ module: m.id, dep, depDepth: depth.get(dep) ?? 0 });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.depDepth - a.depDepth || a.module.localeCompare(b.module) || a.dep.localeCompare(b.dep));
    const cut = candidates[0];
    removed.push({ module: cut.module, dep: cut.dep });
    current = {
      ...current,
      modules: current.modules.map((m) =>
        m.id === cut.module ? { ...m, dependsOn: m.dependsOn.filter((d) => d !== cut.dep) } : m,
      ),
    };
  }
  return { plan: current, changed: removed.length > 0, removed };
}

/**
 * Arbitrate file ownership: assign every shared file to a SINGLE owner — the lowest-depth module
 * (built earliest; tie → first in plan order) — and strip it from the others' `files`. PURE.
 */
export function resolveOwnershipConflicts(plan: ProjectPlan): { plan: ProjectPlan; changed: boolean; resolved: OwnershipConflict[] } {
  const conflicts = detectOwnershipConflicts(plan);
  if (conflicts.length === 0) return { plan, changed: false, resolved: [] };
  const depth = moduleDepths(plan);
  const order = new Map(plan.modules.map((m, i) => [m.id, i] as const));
  // For each conflicted file, choose the single owner.
  const ownerOf = new Map<string, string>();
  for (const c of conflicts) {
    const owner = [...c.moduleIds].sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
    ownerOf.set(c.file, owner);
  }
  const nextPlan: ProjectPlan = {
    ...plan,
    modules: plan.modules.map((m) => ({
      ...m,
      files: (m.files || []).filter((f) => !ownerOf.has(f) || ownerOf.get(f) === m.id),
    })),
  };
  return { plan: nextPlan, changed: true, resolved: conflicts };
}

export type CoordinatorActionKind = 'none' | 'cycle-break' | 'ownership-resolve' | 'needs-llm-replan';

export interface CoordinatorAction {
  kind: CoordinatorActionKind;
  plan: ProjectPlan;
  notes: string[];
}

/**
 * Run the deterministic coordinator BEFORE scheduling the next module: break a blocking cycle,
 * arbitrate file ownership, and note any contract collisions. Returns `needs-llm-replan` only when a
 * not-done module has failed >= LLM_REPLAN_THRESHOLD times AND deterministic repair still leaves the
 * plan unable to advance — the one case worth an LLM plan revision. PURE (no I/O). Never throws.
 */
export function coordinateBeforeTurn(plan: ProjectPlan): CoordinatorAction {
  const notes: string[] = [];
  let current = plan;
  let cycleBroke = false;
  let ownershipResolved = false;

  const cyc = repairPlanCycles(current);
  if (cyc.changed) {
    current = cyc.plan;
    cycleBroke = true;
    for (const r of cyc.removed) notes.push(`Broke a dependency cycle: dropped "${r.module}" → "${r.dep}".`);
  }

  const own = resolveOwnershipConflicts(current);
  if (own.changed) {
    current = own.plan;
    ownershipResolved = true;
    for (const c of own.resolved) notes.push(`File "${c.file}" was claimed by ${c.moduleIds.length} modules — assigned to one owner.`);
  }

  for (const col of detectContractCollisions(current)) {
    notes.push(`Contract collision: "${col.symbol}" is exported by ${col.moduleIds.length} modules — later modules should import it, not re-declare it.`);
  }

  // Does a repeatedly-failing module need an LLM replan? (Only when we still can't advance.)
  const stuck = current.modules.find(
    (m) => m.status !== 'done' && (m.attempts ?? 0) >= LLM_REPLAN_THRESHOLD,
  );
  if (stuck && !nextBuildableModule(current) && !planComplete(current)) {
    notes.push(`Module "${stuck.name}" has failed ${stuck.attempts} times — requesting a revised plan.`);
    return { kind: 'needs-llm-replan', plan: current, notes };
  }

  const kind: CoordinatorActionKind = cycleBroke ? 'cycle-break' : ownershipResolved ? 'ownership-resolve' : 'none';
  return { kind, plan: current, notes };
}

/**
 * Apply an LLM-revised module list to a plan WITHOUT regressing progress: every already-DONE module
 * (with its frozen contract) is kept verbatim; only the not-done tail is replaced by the revision.
 * If the revision is empty, or would drop/undo any done module, the ORIGINAL plan is returned
 * unchanged (SPM "never make it worse"). PURE.
 */
export function applyReplan(oldPlan: ProjectPlan, revisedModules: ProjectModule[]): ProjectPlan {
  if (!Array.isArray(revisedModules) || revisedModules.length === 0) return oldPlan;
  const done = oldPlan.modules.filter((m) => m.status === 'done');
  const doneIds = new Set(done.map((m) => m.id));
  // The revision must preserve every done module (a plan that drops delivered work is a regression).
  const revisedIds = new Set(revisedModules.map((m) => m.id));
  for (const id of doneIds) if (!revisedIds.has(id)) return oldPlan;
  // Keep done modules verbatim; take the not-done modules from the revision (reset to pending unless
  // the revision explicitly marks a state we can trust — new/split modules start pending).
  const keptDone = done;
  const newTail = revisedModules
    .filter((m) => !doneIds.has(m.id))
    .map((m) => ({ ...m, status: m.status === 'done' ? 'pending' : m.status, attempts: 0 } as ProjectModule));
  if (newTail.length === 0) return oldPlan; // nothing left to build but not complete → don't wipe the tail
  return { ...oldPlan, modules: [...keptDone, ...newTail] };
}

/** System prompt for a plan REVISION call — mirrors projectPlanSystemPrompt but for repair. PURE. */
export function replanSystemPrompt(framework: string): string {
  return [
    `You are an elite ${framework} software architect REVISING a stalled project plan. One module has`,
    'repeatedly failed to build. Revise the plan so the project can finish — typically by SPLITTING the',
    'failing module into smaller, clearly-scoped modules, fixing an unclear/oversized contract, or',
    'correcting its dependencies. Keep every ALREADY-BUILT module unchanged.',
    '',
    'OUTPUT: a single JSON array (no prose, no markdown fences) of the modules — same element shape as',
    'the original plan ({ id, name, description, dependsOn, files, contracts }). Include the already-built',
    'modules verbatim (by their ids) plus the revised not-done modules. Do NOT drop a built module.',
  ].join('\n');
}

/** User prompt for a plan REVISION call — hands the model the current modules + the failing detail. PURE. */
export function replanUserPrompt(plan: ProjectPlan, failingModuleId: string): string {
  const failing = plan.modules.find((m) => m.id === failingModuleId);
  const list = plan.modules.map((m) =>
    `- ${m.id} "${m.name}" [${m.status}${m.attempts ? `, ${m.attempts} attempts` : ''}] deps=[${m.dependsOn.join(', ')}] files=[${(m.files || []).slice(0, 8).join(', ')}]`,
  );
  return [
    `Project goal: ${plan.goal}`,
    '',
    'Current modules:',
    ...list,
    '',
    failing
      ? `The FAILING module is "${failing.id}" (${failing.name}). Its last failure: ${failing.statusDetail || 'unknown error'}.`
      : `A module is stuck. Revise the not-done modules so the plan can proceed.`,
    '',
    'Return the revised JSON array now — keep every done module verbatim; split or fix only what is needed.',
  ].join('\n');
}
