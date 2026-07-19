// U-1 (deterministic build harness) — a signed per-build MANIFEST recording the deterministic inputs
// of a build (routing + prompt hash + framework) plus a SHA-256 content-hash map of every file the
// build wrote, optionally HMAC-signed. This is the audit-trail half of "deterministic build harness":
// two builds of the same source can be compared for drift, and a signed manifest proves what a build
// actually produced and under which routing.
//
// HONEST SCOPE (rule 6): a true bit-for-bit reproducibility SEED is NOT supported across the providers
// v5.0 routes to (GLM / Kimi / Claude ignore or don't expose a seed), so "pin the seed" cannot mean
// deterministic regeneration. We therefore record the deterministic ROUTING inputs (model id, effort,
// power level, provider ladder, prompt hash) + the output file hashes as a determinism-AUDIT manifest —
// never a faked seed the providers would ignore.
//
// PURE + dependency-free (Node `crypto` only), fully unit-tested. Reuses `manifestOf` from
// AppMakerLab/BuildReproducibilityChecker (activating that previously-unwired helper) rather than
// duplicating the sha256 logic.

import crypto from 'crypto';
import { manifestOf } from '../AppMakerLab/BuildReproducibilityChecker';

export const BUILD_MANIFEST_SCHEMA = 'navbharatai.v3.build-manifest/1' as const;

export type GateOutcome = 'pass' | 'fail' | 'skipped';

export interface BuildManifestV1 {
  schema: typeof BUILD_MANIFEST_SCHEMA;
  buildId: string;
  /** FNV/hash of the exact prompt that drove the build (same value the diagnostics report records). */
  promptHash: string;
  /**
   * The model id that ACTUALLY delivered the build (the real model that produced the most output),
   * when known — falling back to the nominal routed/ladder-lead model id otherwise. Kept honest so a
   * cheap-floor build shows the cheap model that built it, NOT the nominal Claude fallback identity
   * (ShopSphere autopsy 2026-07-19: a weak GLM-built app recorded `claude-sonnet-4-6` here, which read
   * like a no-Claude-on-weak violation even though only GLM ran). `deliveredVia` carries the provider.
   */
  model: string;
  /** The provider that drove the most build turns (e.g. 'GLM'/'KIMI'/'CLAUDE') — the real builder. */
  deliveredVia?: string;
  /** Reasoning effort, when a power tier pinned one. */
  effort?: string;
  /** Resolved power level for the build (off/mini/medium/max/weak…). */
  powerLevel?: string;
  /** The provider ladder as resolved (lead first) — the deterministic routing decision. */
  providerLadder?: string[];
  framework?: string;
  /** ISO timestamp — passed in (callers stamp it; the module never reads the clock, so it stays pure). */
  createdAt: string;
  /** path → sha256 of every file the build wrote. */
  fileHashes: Record<string, string>;
  /** The end-of-build gate verdicts, co-recorded for the audit trail. */
  gates?: { tsc?: GateOutcome; lint?: GateOutcome };
  /** HMAC-SHA256 of the canonicalized manifest (signature field excluded). Absent when no secret. */
  signature?: string;
}

export interface BuildManifestInput {
  buildId: string;
  promptHash: string;
  model: string;
  deliveredVia?: string;
  effort?: string;
  powerLevel?: string;
  providerLadder?: string[];
  framework?: string;
  createdAt: string;
  /** The files the build wrote (path → content). Hashed via manifestOf. */
  files: Record<string, string | Buffer>;
  gates?: { tsc?: GateOutcome; lint?: GateOutcome };
}

/** Assemble a build manifest (unsigned). Pure. */
export function buildBuildManifest(input: BuildManifestInput): BuildManifestV1 {
  const m: BuildManifestV1 = {
    schema: BUILD_MANIFEST_SCHEMA,
    buildId: input.buildId,
    promptHash: input.promptHash,
    model: input.model,
    createdAt: input.createdAt,
    fileHashes: manifestOf(input.files || {}),
  };
  if (input.deliveredVia) m.deliveredVia = input.deliveredVia;
  if (input.effort) m.effort = input.effort;
  if (input.powerLevel) m.powerLevel = input.powerLevel;
  if (input.providerLadder && input.providerLadder.length) m.providerLadder = input.providerLadder;
  if (input.framework) m.framework = input.framework;
  if (input.gates) m.gates = input.gates;
  return m;
}

/**
 * The model id that actually DELIVERED the build — the model with the most output tokens across the
 * per-(provider, model) usage slices, preferring the dominant provider's slices when one is given.
 * Returns undefined when no slice carries a model id (nothing to attribute → keep the nominal model).
 * This is what makes the manifest honest: a cheap-floor build reports the cheap model that built it,
 * not the nominal Claude fallback identity. PURE.
 */
export function deliveredModelId(
  entries: ReadonlyArray<{ provider?: string; model?: string; usage?: { outputTokens?: number } }>,
  dominantProvider?: string,
): string | undefined {
  const withModel = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && typeof e.model === 'string' && e.model.trim(),
  );
  if (withModel.length === 0) return undefined;
  const out = (e: { usage?: { outputTokens?: number } }): number =>
    Number.isFinite(e.usage?.outputTokens) && (e.usage?.outputTokens ?? 0) > 0 ? (e.usage!.outputTokens as number) : 0;
  const pickMax = (list: typeof withModel): string | undefined =>
    list.length ? list.reduce((best, e) => (out(e) > out(best) ? e : best)).model : undefined;
  // Prefer the dominant provider's models; fall back to the global max if it delivered none with an id.
  if (dominantProvider && dominantProvider.trim()) {
    const dp = dominantProvider.trim().toLowerCase();
    const dpEntries = withModel.filter((e) => (e.provider || '').trim().toLowerCase() === dp);
    const picked = pickMax(dpEntries);
    if (picked) return picked;
  }
  return pickMax(withModel);
}

/**
 * Deterministic, stable-key-sorted JSON of the manifest with the `signature` field EXCLUDED (so a
 * manifest signs/verifies to the same bytes regardless of the signature). Recursively sorts object
 * keys so field order can never change the canonical form. Pure.
 */
export function canonicalizeManifest(m: BuildManifestV1): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        if (k === 'signature') continue; // never sign over the signature itself
        out[k] = stable(obj[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(stable(m));
}

/**
 * Sign the manifest with HMAC-SHA256 over its canonical form, keyed by `secret`. Returns a NEW manifest
 * carrying the `signature`. When `secret` is empty/undefined, returns the manifest unchanged (no
 * signature) — an honest "unsigned" state, never a fake signature. Pure (aside from crypto).
 */
export function signManifest(m: BuildManifestV1, secret: string | undefined | null): BuildManifestV1 {
  if (!secret) return m;
  const signature = crypto.createHmac('sha256', secret).update(canonicalizeManifest(m)).digest('hex');
  return { ...m, signature };
}

/** Verify a manifest's HMAC signature. False when unsigned, no secret, or tampered. Pure. */
export function verifyManifestSignature(m: BuildManifestV1, secret: string | undefined | null): boolean {
  if (!secret || !m || !m.signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalizeManifest(m)).digest('hex');
  // Constant-time compare (both hex strings of equal length on the happy path).
  const a = Buffer.from(m.signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A short human line for the diagnostics report. Pure. */
export function manifestSummaryLine(m: BuildManifestV1): string {
  const files = Object.keys(m.fileHashes).length;
  const gate = m.gates ? ` · gates tsc=${m.gates.tsc ?? '—'}/lint=${m.gates.lint ?? '—'}` : '';
  const sig = m.signature ? `signed(${m.signature.slice(0, 12)}…)` : 'unsigned';
  return `Build manifest: ${files} file hash(es) · model=${m.model}${m.powerLevel ? `/${m.powerLevel}` : ''} · promptHash=${m.promptHash} · ${sig}${gate}`;
}
