// AgentV3 — auto-reboot decision for a DEAD live preview behind an EXISTING URL.
//
// ROOT CAUSE (admin report 2026-07-07, "Closed Port Error" hours after a successful build): the C1
// auto-resume only fires when there is NO preview URL — but a preview URL is PERMANENT while the dev
// server behind it is EPHEMERAL (sandbox idle/pause kills the process). So a reopened session with a
// remembered URL rendered E2B's "Closed Port Error" page inside the iframe and nothing auto-healed —
// URL presence was being used as liveness. Liveness must come from the server's REAL health probe
// (/api/agentv3/preview-health), and a not-live verdict must trigger the same rehydrate-and-reboot the
// Diagnose button runs. PURE + unit-tested; the impure probe/effect lives in PreviewSurface.

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
  /** The once-per-workspace guard already fired (never loop / repeatedly boot a sandbox). */
  alreadyRebooted: boolean;
  /** The server-probed health status, or null when the probe failed (never reboot on a guess). */
  healthStatus: string | null;
}

/** Statuses that mean the preview is fine (or will be) — never reboot over these. */
const HEALTHY = new Set(['live', 'booting']);
/** Statuses with nothing to boot — a reboot cannot help. */
const UNBOOTABLE = new Set(['empty', 'inbrowser_only']);

export function shouldAutoRebootPreview(s: AutoRebootSignals): boolean {
  if (!s.autoResume || !s.liveTabShown || !s.hasUrl || !s.liveBackend) return false;
  if (s.diagnosing || s.alreadyRebooted) return false;
  if (s.healthStatus === null) return false; // probe failed — don't boot on a guess
  return !HEALTHY.has(s.healthStatus) && !UNBOOTABLE.has(s.healthStatus);
}
