// AgentV3 — auto-reboot decision for a DEAD live preview behind an EXISTING URL.
//
// ROOT CAUSE (admin report 2026-07-07, "Closed Port Error" hours after a successful build): the C1
// auto-resume only fires when there is NO preview URL — but a preview URL is PERMANENT while the dev
// server behind it is EPHEMERAL (sandbox idle/pause kills the process). So a reopened session with a
// remembered URL rendered E2B's "Closed Port Error" page inside the iframe and nothing auto-healed —
// URL presence was being used as liveness. Liveness must come from the server's REAL health probe
// (/api/agentv3/preview-health), and a not-live verdict must trigger the same rehydrate-and-reboot the
// Diagnose button runs. PURE + unit-tested; the impure probe/effect lives in PreviewSurface.
//
// V2 (admin 2026-08-03, "preview chal jane ke baad gayab na ho"): the original guard was ONCE per
// workspace per mount — the FIRST death healed, the SECOND stayed dead (a sandbox pauses again after
// idle minutes, so a tab left open all afternoon died permanently after one heal). Once-ever was the
// loop-prevention; it is now a COOLDOWN + BOUNDED-ATTEMPTS policy, which heals repeat deaths while a
// boot-crash-boot hammer stays impossible by construction:
//   • a heal fires at most once per AUTO_HEAL_COOLDOWN_MS;
//   • at most AUTO_HEAL_MAX_STREAK consecutive FAILED heals (a SUCCESSFUL heal resets the streak —
//     genuine recovery re-arms protection for the next death hours later);
//   • at most AUTO_HEAL_MAX_TOTAL heals per workspace per mount — the absolute backstop.

export interface AutoRebootSignals {
  /** Parent says the session is idle (NOT mid-build) — same gate the C1 auto-resume uses. */
  autoResume: boolean;
  /** The Live-server tab is the active preview mode. */
  liveTabShown: boolean;
  /** A preview URL exists (from this or an earlier session). No URL → C1 auto-resume owns it. */
  hasUrl: boolean;
  /** A live backend (E2B) is configured — otherwise there is nothing to boot. */
  liveBackend: boolean;
  /** A diagnose/reboot is already in flight. */
  diagnosing: boolean;
  /** Consecutive heals since the last SUCCESSFUL one (a success resets this to 0). */
  streak: number;
  /** Total heals for this workspace this mount — the absolute backstop. */
  total: number;
  /** ms since the last heal attempt; Infinity when none has fired yet. */
  msSinceLastAttempt: number;
  /** The server-probed health status, or null when the probe failed (never reboot on a guess). */
  healthStatus: string | null;
}

/** Statuses that mean the preview is fine (or will be) — never reboot over these. */
const HEALTHY = new Set(['live', 'booting']);
/** Statuses with nothing to boot — a reboot cannot help. */
const UNBOOTABLE = new Set(['empty', 'inbrowser_only']);

/** A heal may fire at most once per cooldown window (boots are expensive: install + dev server). */
export const AUTO_HEAL_COOLDOWN_MS = 180_000;
/** Max consecutive FAILED heals — a server that dies right back stops being hammered. */
export const AUTO_HEAL_MAX_STREAK = 3;
/** Absolute per-workspace-per-mount backstop, however long the tab stays open. */
export const AUTO_HEAL_MAX_TOTAL = 10;

export function shouldAutoRebootPreview(s: AutoRebootSignals): boolean {
  if (!s.autoResume || !s.liveTabShown || !s.hasUrl || !s.liveBackend) return false;
  if (s.diagnosing) return false;
  if (s.healthStatus === null) return false; // probe failed — don't boot on a guess
  if (HEALTHY.has(s.healthStatus) || UNBOOTABLE.has(s.healthStatus)) return false;
  if (s.streak >= AUTO_HEAL_MAX_STREAK) return false;
  if (s.total >= AUTO_HEAL_MAX_TOTAL) return false;
  if (s.msSinceLastAttempt < AUTO_HEAL_COOLDOWN_MS) return false; // Infinity (never fired) always passes
  return true;
}
