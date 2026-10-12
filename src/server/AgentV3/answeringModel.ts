/**
 * WHICH MODEL ACTUALLY ANSWERED THIS TURN? — one answer, for every per-call record in the report.
 *
 * 🔴 THE DEFECT (autopsy `f152c1ab`, 2026-09-20). The report's per-call log recorded
 * `model: "kimi"` — a PROVIDER FAMILY — while the build's own manifest recorded the real id,
 * `kimi-k2.7-code`. The expression behind it was copy-pasted at five call sites:
 *
 *     model: lbl === 'anthropic' ? fastBuildModel() : someProvider.toLowerCase()
 *
 * …so every non-Claude aux call in every build report named a vendor where a model belongs.
 *
 * 🔑 WHY IT IS NOT COSMETIC. This repo prices builds on the EXACT model, and two ids inside one
 * family differ by 2×: `kimi-k2.7-code` is $0.95/$4.00 and `kimi-k2.7-code-highspeed` is twice that
 * — a distinction `providerRates.ts` had to grow a dedicated row for after it silently under-billed.
 * A per-call log that says "kimi" cannot be reconciled against an invoice, and the one screen an
 * admin uses to check a bill is the one that could not answer the question.
 *
 * 🔒 THE FIX IS TO READ WHAT IS ALREADY THERE. `TurnResult.model` is documented as *"the model id
 * that ACTUALLY produced this turn, when the runner knows it"*, and the GLM/Kimi/Gemini/Claude
 * runners all report it — `AgentRunner` has read it since the day a test recorded the same lesson
 * ("onLlmCall recorded the REQUESTED model id, not the one that answered"). Only the AUX call sites
 * never did.
 *
 * ⚠️ A runner that genuinely does not report a model falls back to the PLANNED id, and only then to
 * the family label. The order matters: a planned id can be checked against the ladder, a family
 * label cannot be checked against anything. What it never does is INVENT an id.
 */
export interface AnsweringModelInput {
  /** `TurnResult.model` — the id the runner says actually answered, when it knows. */
  readonly answered?: string | null;
  /** The id this call was PLANNED on (e.g. `fastBuildModel()`), when the caller knows one. */
  readonly planned?: string | null;
  /** The provider family label, the last resort (`'KIMI'`, `'GLM'`, …). */
  readonly family?: string | null;
}

const clean = (v: string | null | undefined): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : undefined;
};

/**
 * PURE. The most specific truthful name for the model behind a turn: what answered, else what was
 * planned, else the family. Never an invented id, and never an empty string.
 */
export function answeringModel(input: AnsweringModelInput): string {
  return clean(input.answered) ?? clean(input.planned) ?? clean(input.family) ?? 'unknown';
}

/**
 * PURE. TRUE when a recorded per-call `model` is only a FAMILY LABEL — the shape this module exists
 * to stop. Used by the regression suite, and safe for a caller that wants to assert its own record.
 *
 * A family label is the provider name itself (`kimi`, `glm`, `nemotron`, …): no version, no dash,
 * no dot. Every real id this platform runs carries one (`kimi-k2.7-code`, `glm-4.7-flashx`,
 * `claude-haiku-4-5-20251001`, `gemini-2.5-flash-lite`, `nvidia/nemotron-3-super-120b-a12b`).
 */
export function looksLikeFamilyLabelOnly(model: string | null | undefined): boolean {
  const s = clean(model);
  if (!s) return true;
  return !/[-.\/]/.test(s);
}

/**
 * PURE. The answering model's OWN time, as a spread for a per-call record — `{ answerMs }` when the runner
 * measured it (`TurnResult.attemptMs`, set by the multi-provider chain), else nothing.
 *
 * ⏱️ THE SAME DEFECT, ONE FIELD OVER (autopsy 303e8a6f, 2026-10-12). This module moved each row's MODEL to
 * the rung that answered; the row's DURATION stayed the caller's stopwatch around the whole chain. So the
 * report said "kimi-k2.7-code, 18 s" for a call where GLM crawled 15 s and was abandoned and KIMI answered in
 * 3.4 s — the rescuer charged with the crawl, and every per-model speed comparison inverted. `latencyMs` keeps
 * meaning the caller's wait (preparation is measured against it); this is the number a per-model speed reads.
 */
export function answerTimeOf(turn: { readonly attemptMs?: number; readonly fallbackMs?: number; readonly openedAfterMs?: number } | null | undefined): { answerMs?: number; fallbackMs?: number; openMs?: number } {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return {
    ...(ok(turn?.attemptMs) ? { answerMs: turn!.attemptMs } : {}),
    // …the rungs left behind before it, as measured by the chain — never a subtraction (adversarial review).
    ...(ok(turn?.fallbackMs) ? { fallbackMs: turn!.fallbackMs } : {}),
    // …and how long it took to OPEN its answer, where the runner measured it (autopsy 303e8a6f).
    ...(ok(turn?.openedAfterMs) ? { openMs: turn!.openedAfterMs } : {}),
  };
}
