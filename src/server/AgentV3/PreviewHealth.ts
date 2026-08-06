// AgentV3 — Preview Health: v5.0's self-awareness of whether the preview is actually running.
//
// The problem this solves: v5.0 used to have NO idea whether the preview was live. After a build it
// published a URL and forgot about it — so when the E2B sandbox idle-recycled (it pauses after ~15
// min) or the dev server crashed, the URL silently went dead ("Closed Port Error: no service on port
// 5173") and nothing knew. And when a user reopens an old chat YEARS later, the sandbox is long gone,
// so the live preview must be re-booted from the durably-saved files — but only the AI knowing the
// preview is "sleeping" (vs genuinely broken) lets it do the right thing.
//
// This module is the PURE decision brain. Given real signals (durable files exist? is a live backend
// configured? did a port probe just succeed? was a URL ever published? how old is the sandbox?), it
// classifies the true preview state and decides whether an automatic reboot is warranted — crucially
// distinguishing an EXPECTED idle-recycle ("sleeping", reboot on demand) from a real CRASH ("crashed",
// heal it). No I/O here, so it is fully unit-testable; the route/actuator feed it real signals.

/** The real state of a workspace's preview, as far as v5.0 can determine. */
export type PreviewStatus =
  | 'live'            // the server is genuinely SERVING the app (a page was fetched and it rendered)
  | 'not_serving'     // the port answers, but what it returns is not the app (404 / "Cannot GET" / blank)
  | 'booting'         // a boot / heal is in progress
  | 'sleeping'        // files exist + a live backend exists, but the sandbox is cold/idle-recycled —
                      //   EXPECTED (E2B pauses when idle); the preview can be rebooted on demand
  | 'crashed'         // a URL was published and the port then went DOWN with an error — should heal
  | 'inbrowser_only'  // no live backend configured (E2B off) — the in-browser preview is the truth
  | 'empty';          // no files persisted yet — there is nothing to preview

export interface PreviewHealthSignals {
  /** Durable files exist for this workspace (so it CAN be previewed at all, even years later). */
  hasFiles: boolean;
  /** A live-preview backend (E2B) is configured on this deployment — a live server is even possible. */
  liveBackend: boolean;
  /** The most recent real port probe: true=up, false=down, null=not probed (cold, no sandbox). */
  livePortUp: boolean | null;
  /**
   * Did the fetched page actually RENDER THE APP? true=yes, false=the port answered but returned a
   * 404 / "Cannot GET" / blank shell, null=not checked.
   *
   * ROOT CAUSE (admin report 2026-08-06, "Cannot GET /customer/home" shown INSIDE the preview while we
   * labelled it live). The probe behind `livePortUp` only read an HTTP STATUS CODE from `/`, and
   * counted `301/302` as healthy. The app's `/` did `res.redirect("/customer/home")` → 302 → we
   * declared "live — up and running", the tab rendered the iframe, the iframe followed the redirect,
   * and the user got a raw `Cannot GET` page presented as their app. A status code is not a working
   * app — the same "EARN THE VERDICT" rule the import boot already follows via analyzePreviewHtml,
   * which this probe simply never used. `pageRendered` carries that verdict here.
   */
  pageRendered?: boolean | null;
  /** What analyzePreviewHtml found wrong when `pageRendered` is false (for an honest message). */
  pageProblems?: string[];
  /** A live URL was published at least once for this workspace (from durable history/checkpoints). */
  everPublished: boolean;
  /** The last dev-server failure detail, if the port went down with a known error (else null). */
  lastError: string | null;
  /** True while a boot/heal is actively running right now. */
  booting: boolean;
}

export interface PreviewHealth {
  status: PreviewStatus;
  /** True when the live preview can be (re)booted from the durable files on demand. */
  canReboot: boolean;
  /** A short, honest human/AI-readable summary of the state. */
  summary: string;
}

/**
 * Classify the true preview state from real signals. PURE. Ordered so the most decisive signal wins.
 */
export function classifyPreviewHealth(s: PreviewHealthSignals): PreviewHealth {
  const canReboot = s.hasFiles && s.liveBackend;

  if (s.booting) {
    return { status: 'booting', canReboot, summary: 'The live preview is starting up…' };
  }
  if (!s.hasFiles) {
    return { status: 'empty', canReboot: false, summary: 'No app has been built yet — there is nothing to preview.' };
  }
  if (!s.liveBackend) {
    return { status: 'inbrowser_only', canReboot: false, summary: 'A live cloud server is not configured here — the In-browser preview renders your saved files.' };
  }
  if (s.livePortUp === true) {
    // A PORT THAT ANSWERS IS NOT AN APP THAT WORKS. When the page was actually fetched and did NOT
    // render, say so — never label it "live". This is the state the user was being shown as their app:
    // the server answers, and every page is a 404.
    if (s.pageRendered === false) {
      const why = (s.pageProblems ?? []).filter(Boolean).join('; ');
      return {
        status: 'not_serving',
        canReboot,
        summary: `The server is answering, but it is not serving your app${why ? ` — ${why}` : ''}. This usually means the app is still finishing its start-up, or its page routes are not wired.`,
      };
    }
    return { status: 'live', canReboot, summary: 'The live preview is up and running.' };
  }
  // Port is down (false) or was never probed (null) — decide sleeping vs crashed.
  // A real error signal means it went down BADLY (crash) → heal. Otherwise it is simply cold/idle-
  // recycled (E2B pauses idle sandboxes), which is EXPECTED and just needs a reboot on demand.
  if (s.lastError) {
    return { status: 'crashed', canReboot, summary: `The live preview went down: ${s.lastError.slice(0, 200)}. It can be rebooted from your saved files.` };
  }
  return {
    status: 'sleeping',
    canReboot,
    summary: s.everPublished
      ? 'The live preview is asleep (the cloud sandbox idles after inactivity). Your app and files are safely saved — it reboots from them on demand.'
      : 'Your app is saved and ready — the live preview can be booted from your saved files on demand.',
  };
}

/**
 * Decide whether v5.0 should AUTOMATICALLY (re)boot the live preview now. Bounded so it can never loop:
 * only for a rebootable sleeping/crashed state, only while attempts remain, and only after a cooldown
 * since the last attempt (so a genuinely un-bootable app can't spin the sandbox forever). PURE.
 *
 * @param health        the classified health
 * @param attempts      how many auto-reboots have already been tried this session
 * @param maxAttempts   the cap on auto-reboots
 * @param msSinceLastAttempt time since the last auto-reboot (Infinity if none yet)
 * @param cooldownMs    minimum gap between auto-reboots
 */
export function shouldAutoRebootPreview(
  health: PreviewHealth,
  attempts: number,
  maxAttempts: number,
  msSinceLastAttempt: number,
  cooldownMs: number,
): boolean {
  if (!health.canReboot) return false;
  if (health.status !== 'sleeping' && health.status !== 'crashed') return false;
  if (attempts >= Math.max(0, maxAttempts)) return false;
  if (msSinceLastAttempt < Math.max(0, cooldownMs)) return false;
  return true;
}

/**
 * A one-line context string so EVERY AI in v5.0 answers "is the preview running?" from the REAL state
 * instead of guessing (same pattern as the file-count awareness line). Empty when there is nothing
 * meaningful to add (no files yet). PURE.
 */
export function previewHealthContextLine(health: PreviewHealth): string {
  if (health.status === 'empty') return '';
  const label: Record<PreviewStatus, string> = {
    live: 'RUNNING (live)',
    not_serving: 'ANSWERING BUT NOT SERVING THE APP (404 / not-yet-wired pages)',
    booting: 'STARTING UP',
    sleeping: 'ASLEEP (saved; reboots on demand)',
    crashed: 'DOWN (needs a reboot/heal)',
    inbrowser_only: 'IN-BROWSER ONLY (no live server here)',
    empty: 'none',
  };
  return `\n\n[Live preview status for this project: ${label[health.status]}. ${health.summary} When asked whether the preview/app is running, answer with THIS real state — never guess.]`;
}
