// P-AI.9 — Explainability / decision trace.
//
// AuditManager logs mutations and TracingManager (P-BRE.1) logs timing spans, but neither captures
// WHY the AI made each choice. This records an append-only, per-build trace of the semantic decisions
// — intent detected → complexity/tier chosen → model/provider selected → repair strategy chosen →
// final outcome — each with a short human reason. Stored per workspace (Firestore, best-effort) and
// kept in an in-memory last-trace cache for an owner-scoped admin/debug endpoint.
//
// Pure core (DecisionTrace.record/snapshot/format) → unit-tested. Persistence is VITEST-skip + never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { redactProvidersText } from '../lib/providerRedaction';

export interface Decision {
  stage: string;
  decision: string;
  reason: string;
  at: string;
}

/** An append-only decision trace for one build. Pure (the caller supplies timestamps). */
export class DecisionTrace {
  readonly workspaceId: string;
  private decisions: Decision[] = [];

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /** Append a decision. `decision` = what was chosen; `reason` = why. Never throws. */
  record(stage: string, decision: string, reason: string, nowIso: string): void {
    this.decisions.push({
      stage: String(stage || '').slice(0, 80),
      decision: String(decision || '').slice(0, 200),
      reason: String(reason || '').slice(0, 300),
      at: nowIso,
    });
  }

  /** Ordered copy of the recorded decisions. */
  snapshot(): Decision[] {
    return [...this.decisions];
  }

  /** A compact human-readable trace (for logs / the debug endpoint). */
  format(): string {
    if (this.decisions.length === 0) return 'No decisions recorded.';
    return this.decisions.map((d, i) => `${i + 1}. [${d.stage}] ${d.decision} — ${d.reason}`).join('\n');
  }
}

/**
 * The decision trace as a given VIEWER may see it — White-Label Law (Q-978, found while root-causing Q-970).
 *
 * 🔴 THE LEAK. `GET /api/agentv3/decision-trace` is gated to the workspace OWNER, not the admin, and the
 * trace records the engine choice in vendor terms — `haiku (GLM)`, `sonnet (claude-sonnet-4-6)`, and a
 * reason like "analyzer chose sonnet start tier". So any owner who opened the URL learned which third-party
 * models built their app, which the law forbids on every surface a normal user can reach. The diagnostics
 * route had closed the same hole long ago (`showProviderDetail`, Fix 68); this route was its sibling.
 *
 * The admin gets the decisions exactly as recorded. Anyone else gets every text field through the ONE
 * shared scrubber (`redactProvidersText`), so this view can never disagree with the build report's.
 * PURE — never mutates its input.
 */
export function decisionTraceForViewer(decisions: readonly Decision[], isAdmin: boolean): Decision[] {
  if (isAdmin) return decisions.map((d) => ({ ...d }));
  return decisions.map((d) => ({
    stage: redactProvidersText(d.stage),
    decision: redactProvidersText(d.decision),
    reason: redactProvidersText(d.reason),
    at: d.at,
  }));
}

/** Last-trace-per-workspace cache (per instance) so the endpoint can return without a Firestore read. */
const lastTraces = new Map<string, Decision[]>();
const MAX_CACHE = 100;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    return getServerDb();
  } catch {
    return null;
  }
}

/** Persist a finished trace (Firestore `buildTraces/{workspaceId}` + in-memory cache). Best-effort. */
export async function persistDecisionTrace(trace: DecisionTrace, nowIso: string): Promise<void> {
  const decisions = trace.snapshot();
  if (decisions.length === 0) return;
  // In-memory cache first (bounded) — always available for the endpoint on this instance.
  if (lastTraces.size >= MAX_CACHE) {
    const oldest = lastTraces.keys().next().value as string | undefined;
    if (oldest !== undefined) lastTraces.delete(oldest);
  }
  lastTraces.set(trace.workspaceId, decisions);
  const db = getDb();
  if (!db || !trace.workspaceId) return;
  try {
    await db.collection('buildTraces').doc(trace.workspaceId).set({ decisions, updatedAt: nowIso }, { merge: false });
  } catch { /* best-effort — never block a build */ }
}

/** Read a workspace's decision trace (in-memory cache first, then Firestore). Never throws. */
export async function getDecisionTrace(workspaceId: string): Promise<Decision[] | null> {
  if (!workspaceId) return null;
  const cached = lastTraces.get(workspaceId);
  if (cached) return cached;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection('buildTraces').doc(workspaceId).get();
    return snap.exists ? ((snap.data()?.decisions as Decision[]) ?? null) : null;
  } catch {
    return null;
  }
}
