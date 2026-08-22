// WHICH SANDBOX DOES THIS WORKSPACE ACTUALLY HAVE? — the question a fresh server instance could not ask.
//
// 🔒 ROOT CAUSE (admin, 2026-08-22): E2B's own page —
//
//     "The sandbox i5ougia1mw2kcj39ualmm is running but there's no service running on port 3000.
//      Connection refused on port 3000"
//
// The actuator tracks live sandboxes in an IN-MEMORY map. That map belongs to ONE server instance, and
// it is empty after every deploy, every instance recycle, and on every other instance behind the load
// balancer. The workspace's real sandbox id was durable the whole time (`sandboxStore`), and one path —
// the wake/diagnose route — already read it and passed it in by hand. Nothing else did.
//
// Two failures fell out of that, and the admin has now reported both:
//
//  1. `getSandboxId` returned null on a cold instance, so the preview HEALTH probe never ran. Without
//     it `livePortUp` stayed unknown, the app was never classified as stopped, the auto-restore never
//     fired, the wake card never appeared — and the iframe simply loaded the stale URL, which is E2B's
//     closed-port page. Every reload repeated it identically: "chahe kuch kar lo".
//
//  2. Worse, and silent: a cold instance running ANY command for an existing workspace fell through to
//     `Sandbox.create()` — a brand-new EMPTY machine. The in-memory replay cache is empty on a fresh
//     instance too, so there was nothing to replay into it.
//
// Reconnecting to the workspace's own durable sandbox is not an optimisation over creating one; it is
// the only correct answer. This module holds that precedence rule, PURE, so it is decided once and
// tested rather than re-derived at each call site.

export interface ResumeChoiceInput {
  /** An id the caller already resolved (the wake route does this today). Highest precedence. */
  explicit?: string | null;
  /** What the durable store says this workspace's sandbox is, or null when it says nothing. */
  durable?: string | null;
  /** The `AGENTV3_SANDBOX_RESUME` master switch. */
  resumeEnabled: boolean;
}

/**
 * The sandbox id to reconnect to, or undefined to create a fresh one. PURE.
 *
 * Precedence, and why:
 *  1. **explicit** — a caller that already resolved an id knows something we do not (it may be
 *     resuming a specific historical sandbox), and second-guessing it would break that path.
 *  2. **durable** — the workspace's own recorded sandbox. This is the case a cold instance was missing.
 *  3. **undefined** — genuinely nothing to resume: a first-ever build, or resume switched off.
 *
 * 🔒 The kill switch is honoured for the DURABLE lookup only, never for an explicit id. Turning resume
 * off must stop us from reaching for a sandbox on our own initiative — it must not sabotage a caller
 * that was handed one, which is how a "safe" flag becomes the thing that breaks the working path.
 */
export function resumeSandboxChoice(input: ResumeChoiceInput): string | undefined {
  const explicit = clean(input.explicit);
  if (explicit) return explicit;
  if (!input.resumeEnabled) return undefined;
  return clean(input.durable) ?? undefined;
}

function clean(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : undefined;
}
