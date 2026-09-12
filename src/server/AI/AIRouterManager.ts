import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { GrokProvider } from './Router/providers/GrokProvider';
import { allowedOnFreeTier, chatCostIndex, freeTierCeiling } from './freeTierCostCeiling';
import { GlmProvider } from './Router/providers/GlmProvider';
import { AIProvider } from './Router/ProviderTypes';
import { AIRouter } from './Router/AIRouter';

// Slot factory — wraps a base provider with a specific model override
function slot(base: AIProvider, priority: number, model: string): AIProvider {
  return {
    name: base.name,
    priority,
    healthCheck: () => base.healthCheck(),
    execute: (p, s, _, sys) => base.execute(p, s, model, sys),
    // 🔴 THE MODEL MUST RIDE THE STREAM TOO. Dropping it here is what made every slotted rung stream
    // on its provider's hardcoded default — on Vertex, `gemini-2.5-pro` at $10/MTok — so the cheap
    // rungs of the FREE ladder were, on the streaming path chat actually uses, the dearest model.
    executeStream: base.executeStream
      ? (p, sys, cb) => base.executeStream!(p, sys, cb, model)
      : undefined,
  };
}

export class AIRouterManager {
  private static instanceFree: AIRouter | null = null;
  private static instancePro: AIRouter | null = null;
  private static instanceProfessional: AIRouter | null = null;
  private static instanceProfessionalFree: AIRouter | null = null;
  private static instanceProfessionalFreeFallback: AIRouter | null = null;

  static getRouter(namespace: 'free' | 'pro' | 'professional' | 'professional-free' | 'professional-free-fallback'): AIRouter {
    if (namespace === 'pro') {
      if (!this.instancePro) this.instancePro = this.buildPro();
      return this.instancePro;
    }
    if (namespace === 'professional') {
      if (!this.instanceProfessional) this.instanceProfessional = this.buildProfessional();
      return this.instanceProfessional;
    }
    if (namespace === 'professional-free') {
      if (!this.instanceProfessionalFree) this.instanceProfessionalFree = this.buildProfessionalFree();
      return this.instanceProfessionalFree;
    }
    if (namespace === 'professional-free-fallback') {
      if (!this.instanceProfessionalFreeFallback) this.instanceProfessionalFreeFallback = this.buildProfessionalFreeFallback();
      return this.instanceProfessionalFreeFallback;
    }
    if (!this.instanceFree) this.instanceFree = this.buildFree();
    return this.instanceFree;
  }

  static reset() { this.instanceFree = null; this.instancePro = null; this.instanceProfessional = null; this.instanceProfessionalFree = null; this.instanceProfessionalFreeFallback = null; }

  // FREE: GLM-flash (free leader) → Gemini flash-lite/flash on both Google doors → GLM-4.7.
  // Claude NEVER used in free. Nothing dearer than `kimi-k2.7` — see the ceiling below.
  //
  // 🔴 THE ADMIN DREW THE LINE (2026-09-12). Shown the whole rate card, they marked it up to
  // `kimi-k2.7` and said "bas yahi tak rakho". So `gemini-2.5-pro` ($10/MTok out) and grok ($15) are
  // GONE from the free ladder — not demoted, removed. `freeTierCeiling()` states that rule in money
  // rather than as a list of ids, and `tests/freeChainCost.test.ts` enforces it against the live rate
  // card, so a rung added later at any price above the line fails CI instead of reaching a bill.
  //
  // 🔴 TWO BUGS PRODUCED THE ORIGINAL LEAK, AND THE SECOND HID THE FIRST.
  // (1) The paid rungs were registered dearest-first: `gemini-2.5-pro` sat above the flash rungs, so
  //     a rate-limited leader fell to the DEAREST model. Reordering fixes that — on the non-streaming
  //     path.
  // (2) `slot()` could not pin a model on the STREAMING path at all (no `model` parameter existed on
  //     `executeStream`), and `VertexProvider.executeStream` hardcoded `this.modelPro`. Chat streams.
  //     So on the path that actually matters, EVERY Vertex rung ran `gemini-2.5-pro` regardless of
  //     which one won, and re-ordering alone would have changed nothing while reading as a fix. The
  //     model now rides the stream; without that, this ceiling would be decoration.
  //
  // 🔒 WHAT REMOVING THE LAST RESORTS COSTS, STATED PLAINLY: if GLM and both Google doors are all
  // failing at once, a free chat turn now returns an honest "busy" instead of an answer. That is the
  // deliberate trade the admin chose, and it is the SAME trade `buildProfessionalFreeFallback` below
  // already makes in writing — "a free build must never silently escalate to a paid provider". PRO and
  // PROFESSIONAL keep every rung they had; this ceiling is the FREE ladder's alone.
  private static buildFree(): AIRouter {
    const router = new AIRouter("free");
    console.log('[ROUTER_MGR] Building FREE chain: GLM-flash(free) → flash-lite → flash (Vertex, then Gemini) → GLM-4.7 — capped at the kimi-k2.7 price line');

    // Free, fast leader: GLM-4.7-Flash ($0 in/out on Z.AI). Self-gates on GLM_API_KEY
    // (healthCheck) so this is inert until the key is set; on failure/rate-limit the
    // router falls through to the paid providers below, so reliability is unchanged.
    try {
      const glm = new GlmProvider();
      glm.priority = 0;
      router.registerProvider(glm);
      console.log('[ROUTER_MGR] FREE: GLM-flash registered as free chain leader');
    } catch {}

    // Current Gemini models only — gemini-2.0-flash / gemini-1.5-* are RETIRED and 404
    // at the provider, making those fallback slots dead weight that only added latency.
    // ONE ladder across both Google doors, ordered by the CHAT cost index (input-weighted — a chat
    // turn is input-heavy, so the output column alone orders them wrongly). Vertex leads among equals
    // because it is the free universe's service-account auth and needs no extra key.
    //
    // 🔒 THE CEILING IS ENFORCED HERE, AT REGISTRATION — not only in CI. A test that fails on a dear
    // rung protects the repo; this protects the BILL, including on a branch nobody ran the suite on.
    // A refused rung says so loudly in the server log rather than vanishing, because a ladder that is
    // quietly shorter than it reads is how the original leak stayed invisible.
    const registerFree = (prov: AIProvider, priority: number, model: string, label: string) => {
      if (!allowedOnFreeTier(label, model)) {
        console.warn(
          `[ROUTER_MGR] FREE: REFUSED ${model} — chat cost ${chatCostIndex(label, model).toFixed(2)} is above the ` +
          `free-tier ceiling ${freeTierCeiling().toFixed(2)} (the kimi-k2.7 line). Free chat never pays more than that.`,
        );
        return;
      }
      try { router.registerProvider(slot(prov, priority, model)); } catch {}
    };

    const vertex = new VertexProvider();
    const gemini = new GeminiProvider();
    ([
      [vertex, 'gemini-2.5-flash-lite', 1],
      [vertex, 'gemini-2.5-flash',      2],
      [gemini, 'gemini-2.5-flash-lite', 3],
      [gemini, 'gemini-2.5-flash',      4],
    ] as const).forEach(([prov, m, p]) => registerFree(prov, p, m, 'VERTEX'));

    // GLM's cheap coder as the final rung — under the ceiling, and the only rung left that is not
    // Google, so a Google-wide outage still has somewhere to go.
    // ⚠️ HONEST CAVEAT: it shares ONE key with the flash leader. When the leader failed because that
    // KEY was rate-limited, this rung will usually fail too — it earns its place on a model-specific
    // failure, not on a 429 storm. It costs nothing to keep, and it is not a substitute for a second
    // provider; a genuinely independent rung (Kimi) has no chat provider in this repo yet.
    registerFree(new GlmProvider(), 5, 'glm-4.7', 'GLM');

    return router;
  }

  // PRO: Claude Opus 4.8 (primary) → Sonnet 4.6 → Grok → Vertex → Gemini
  private static buildPro(): AIRouter {
    const router = new AIRouter("pro");
    console.log('[ROUTER_MGR] Building PRO chain: Opus4.8(p1) → Sonnet4.6(p2) → Grok×2 → Vertex×3 → Gemini×2');

    try {
      const opus = new AnthropicProvider('claude-opus-4-8');
      opus.priority = 1;
      opus.enableThinking = true;
      router.registerProvider(opus);
    } catch {}

    try {
      // claude-3-5-sonnet-20241022 is RETIRED (404s) — this fallback slot was silently dead.
      const sonnet = new AnthropicProvider('claude-sonnet-4-6');
      sonnet.priority = 2;
      router.registerProvider(sonnet);
    } catch {}

    try {
      const grok = new GrokProvider();
      router.registerProvider(slot(grok, 3, 'grok-3'));
      router.registerProvider(slot(grok, 4, 'grok-3-fast'));
    } catch {}

    const vertex = new VertexProvider();
    [['gemini-2.5-pro',5],['gemini-2.5-flash',6],['gemini-2.5-flash-lite',7]].forEach(([m,p]) => {
      try { router.registerProvider(slot(vertex, p as number, m as string)); } catch {}
    });

    const gemini = new GeminiProvider();
    [['gemini-2.5-flash',10],['gemini-2.5-flash-lite',11]].forEach(([m,p]) => {
      try { router.registerProvider(slot(gemini, p as number, m as string)); } catch {}
    });

    return router;
  }

  // PROFESSIONAL universe (Doctor AI / SDA + every config-driven professional:
  // Teacher, Lawyer, CA, Astrologer, Kisan, …). Fully isolated from FREE and PRO.
  // Routing shape (via AIRouter.routeRaced): RACE Grok × Gemini × Vertex
  // concurrently — first non-empty success wins; ONLY if all three fail, fall back
  // to Claude Haiku (last resort). Honors the "Grok primary, Claude last" core law.
  private static buildProfessional(): AIRouter {
    const router = new AIRouter("professional");
    console.log('[ROUTER_MGR] Building PROFESSIONAL chain: RACE(Grok × Gemini × Vertex) → Claude Haiku(last resort)');

    // ── Race participants (fired concurrently) ──
    try {
      const grok = new GrokProvider();
      router.registerProvider(slot(grok, 1, 'grok-3'));
    } catch {}

    try {
      const gemini = new GeminiProvider();
      router.registerProvider(slot(gemini, 2, 'gemini-2.5-flash'));
    } catch {}

    try {
      const vertex = new VertexProvider();
      router.registerProvider(slot(vertex, 3, 'gemini-2.5-flash'));
    } catch {}

    // ── Last resort ONLY: Claude Haiku (cheap, reached only if the race fails) ──
    try {
      const claude = new AnthropicProvider('claude-haiku-4-5-20251001');
      claude.priority = 99;
      claude.lastResort = true;
      router.registerProvider(claude);
    } catch {}

    return router;
  }

  // PROFESSIONAL-FREE universe (admin 2026-07-09): the free first-attempt tier for the
  // config-driven professionals. It contains ONLY GLM-4.7-Flash ($0 in/out on Z.AI) — the
  // caller (professionals/engine.ts) tries this universe first and, on any failure or
  // rate-limit, falls back to the full PAID professional universe above, which stays
  // byte-for-byte unchanged (RACE Grok × Gemini × Vertex → Claude Haiku). Keeping the free
  // tier as its own single-provider universe (instead of mixing GLM into the paid race)
  // means a successful free answer fires ZERO paid provider calls, and a missing
  // GLM_API_KEY makes this universe inert (healthCheck false) so behaviour degrades to
  // exactly today's paid path.
  private static buildProfessionalFree(): AIRouter {
    const router = new AIRouter("professional-free");
    console.log('[ROUTER_MGR] Building PROFESSIONAL-FREE chain: GLM-flash only (paid universe is the fallback)');
    try {
      const glm = new GlmProvider();
      glm.priority = 0;
      router.registerProvider(glm);
    } catch {}
    return router;
  }

  // PROFESSIONAL-FREE-FALLBACK universe (admin 2026-07-15): the ONLY fallback a FREE-tier professional
  // user gets when GLM-flash fails/rate-limits — Vertex (cheap Gemini on Google), NEVER Grok / direct
  // Gemini / Claude. This enforces the free-tier cost policy "GLM (free) + Vertex only" so a free user
  // can never trigger the pricier paid providers. gemini-2.5-flash primary → -flash-lite (cheaper)
  // fallback within Vertex. If Vertex is unavailable the router simply fails and the engine returns an
  // honest "busy" — a free build must never silently escalate to a paid provider.
  private static buildProfessionalFreeFallback(): AIRouter {
    const router = new AIRouter("professional-free-fallback");
    console.log('[ROUTER_MGR] Building PROFESSIONAL-FREE-FALLBACK chain: Vertex only (gemini-2.5-flash → -flash-lite)');
    try {
      const vertex = new VertexProvider();
      router.registerProvider(slot(vertex, 1, 'gemini-2.5-flash'));
      router.registerProvider(slot(vertex, 2, 'gemini-2.5-flash-lite'));
    } catch {}
    return router;
  }
}
