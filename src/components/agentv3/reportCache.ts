// Device-local LAST-RESORT cache for the build report (admin 2026-07-11: "build report 100% bane hi
// bane, data gayab na ho — pukhta prabandh").
//
// The server already has four delivery layers (durable per-workspace doc + bounded history + durable
// per-user latest + in-memory), and the report also rides the live result event. The residual
// "No build report yet" cases are all SERVER-unreachable ones: an anon/token-blip fetch that can't
// match the per-user doc, a fresh session with a new workspaceId before any fetch succeeds, or plain
// network failure. This cache closes that class: the moment a report reaches THIS device (with the
// build result), it is persisted locally — so the device where the build ran can ALWAYS produce the
// last report, even fully offline.
//
// Storage: localStorage (survives reloads/tabs). Quota-safe: if the full report is too big, a SLIM
// copy (heavy raw sections dropped, honestly marked) is stored instead — a slightly smaller report
// always beats no report. Never throws.

const KEY = 'nbv3:last-build-report';

/** Strip the heavy raw sections so the report fits quota — honestly marked as slimmed. */
function slimReport(report: Record<string, unknown>): Record<string, unknown> {
  const { commands, llmCalls, generatedFiles, ...rest } = report;
  void commands; void llmCalls; void generatedFiles;
  return { ...rest, _slimmed: 'heavy raw sections (commands/llmCalls/generatedFiles) dropped to fit local storage — the durable server copy has them' };
}

/** Persist the latest build report locally. Quota-safe, never throws. */
export function saveLastReport(report: unknown): void {
  if (typeof localStorage === 'undefined' || !report || typeof report !== 'object') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(report));
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(slimReport(report as Record<string, unknown>)));
    } catch { /* even the slim copy failed (quota/private mode) — the server layers still apply */ }
  }
}

/** The locally-cached last report, or null. Never throws. */
export function readLastReport(): unknown | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
