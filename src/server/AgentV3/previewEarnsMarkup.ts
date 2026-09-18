// THE MARKUP IS EARNED BY A PREVIEW THAT RAN — not by the absence of proof that it didn't.
//
// 🔒 ADMIN-MANDATED 2026-09-18, verbatim: *"app बनी = preview चला — aur paise tabhi charge hone
// chahiye, jab preview chale"*, and, choosing between three options for the case where it did not:
// *"(c) सिर्फ़ असली लागत लें, बिना markup"*.
//
// 🔴 WHAT IT COST, from autopsy `1a7f4a58`. A free-tier user was billed **₹613.08** for a build whose
// `RELEASE_GATE` was `UNKNOWN`, whose preview served `Cannot GET /`, and which ended in a
// `GREEN_GUARD_RESTORED` rollback. Our own real cost was about ₹145. Nothing was broken in the money
// path — every existing guard did exactly what it says:
//
//   • `zeroBillForUnrenderedPreview` needs `previewVerifiedFailed` — we LOOKED and it FAILED.
//   • `zeroBillForFailedBuild`       needs `!result.ok`           — the build reported failure.
//
// This build was neither. We never managed to look at all, and the build reported success. So the
// full markup applied to a build nobody could show had produced a working app.
//
// 🔑 THE DISTINCTION IS ONE THIS CODEBASE ALREADY MAKES EVERYWHERE ELSE, and had never applied to
// money: `previewProvenBroken` exists precisely because *"we looked and it was broken"* and *"we could
// not look"* are different facts, and only the first is evidence. The billing guards covered the
// first. This covers the second — the ignorance case — and it is the commonest of the three.
//
// ⚠️ IT IS NOT ₹0, DELIBERATELY. The admin was offered that and refused it, for a reason recorded in
// `CLAUDE.md` from autopsy `4efab9d7`: *"app bani = preview chala. agar preview chala gaya to ₹0 charge
// karoge to aise to mai barbad ho jaunga."* Free-when-unproven would hand away every build whose app
// works but whose proof we failed to collect — our instrument's failure, paid for by us. So the user
// pays what the build genuinely cost us and not one paisa of margin: we do not profit from a build we
// cannot show them working, and we do not eat the bill for one either.
//
// 🔒 IT CAN ONLY EVER REDUCE. The result is `min(decided, real)`, so a path whose real cost somehow
// exceeds its decided bill is left alone, and every zeroing rule downstream still takes precedence.
//
// PURE — numbers in, a number out. No I/O, no clock, never throws.

export interface MarkupDecision {
  /** What to bill. Never greater than what was decided before this ran. */
  billedUsd: number;
  /** False when the margin was waived — drives the report line and the user's notice. */
  markupApplied: boolean;
  /** One honest sentence for the admin report, or '' when nothing changed. */
  reason: string;
  /** What the user is told, or '' when nothing changed. Branded, no vendor names. */
  userMessage: string;
}

/** `off` restores the pre-2026-09-18 behaviour exactly, with no deploy. */
export function markupNeedsPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env['AGENTV3_MARKUP_NEEDS_PREVIEW'] ?? '').trim().toLowerCase() !== 'off';
}

export function decideMarkupOnProof(input: {
  /** The bill as decided by `decideBuildBilledUsd` — tokens and VM, with the tier's markup applied. */
  decidedBilledUsd: number;
  /** What the providers really cost us (USD, tokens). */
  realCostUsd: number;
  /** What the VM really cost us (USD), already capped to this build's own window. */
  sandboxUsd: number;
  /**
   * Did a real check SEE this app render? `buildObs.previewRendered`, whose only producer is
   * `markAppRendered` — one fact, one write. Never inferred from "the build said ok".
   */
  previewProven: boolean;
  /**
   * Was an app expected at all? A chat turn, a survey or an import answers a QUESTION and has no
   * preview to earn, so this rule must not touch it — the same carve-out
   * `zeroBillForUnrenderedPreview` already makes.
   */
  expectsArtifacts: boolean;
  enabled?: boolean;
}): MarkupDecision {
  const decided = Number(input.decidedBilledUsd);
  const unchanged: MarkupDecision = {
    billedUsd: Number.isFinite(decided) ? Math.max(0, decided) : 0,
    markupApplied: true,
    reason: '',
    userMessage: '',
  };
  if (input.enabled === false) return unchanged;
  if (!input.expectsArtifacts) return unchanged;
  if (input.previewProven) return unchanged;
  if (!Number.isFinite(decided) || decided <= 0) return unchanged;

  const real = Math.max(0, Number(input.realCostUsd) || 0) + Math.max(0, Number(input.sandboxUsd) || 0);
  // Only ever reduces. A real cost above the decided bill means some other formula already billed
  // below cost, and raising it here would be a price rise nobody authorised.
  if (real >= decided) return unchanged;

  return {
    billedUsd: real,
    markupApplied: false,
    reason: `The app was never confirmed running here, so the service margin was waived: billed at real cost only `
      + `($${real.toFixed(4)} instead of $${decided.toFixed(4)}).`,
    userMessage: 'I could not confirm your app running here, so you have been charged only what this build '
      + 'actually cost to run — no service charge on top. Your files are saved; send a follow-up and I will '
      + 'get it running.',
  };
}
