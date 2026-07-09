import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { GrokProvider } from './Router/providers/GrokProvider';
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
    executeStream: base.executeStream
      ? (p, sys, cb) => base.executeStream!(p, sys, cb)
      : undefined,
  };
}

export class AIRouterManager {
  private static instanceFree: AIRouter | null = null;
  private static instancePro: AIRouter | null = null;
  private static instanceProfessional: AIRouter | null = null;
  private static instanceProfessionalFree: AIRouter | null = null;

  static getRouter(namespace: 'free' | 'pro' | 'professional' | 'professional-free'): AIRouter {
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
    if (!this.instanceFree) this.instanceFree = this.buildFree();
    return this.instanceFree;
  }

  static reset() { this.instanceFree = null; this.instancePro = null; this.instanceProfessional = null; this.instanceProfessionalFree = null; }

  // FREE: GLM-flash (free leader) → Vertex (3 models) → Gemini (2 models) → Grok.
  // Claude NEVER used in free.
  private static buildFree(): AIRouter {
    const router = new AIRouter("free");
    console.log('[ROUTER_MGR] Building FREE chain: GLM-flash(free) → Vertex×3 → Gemini×2 → Grok');

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
    const vertex = new VertexProvider();
    [
      ['gemini-2.5-pro',        1],
      ['gemini-2.5-flash',      2],
      ['gemini-2.5-flash-lite', 3],
    ].forEach(([m, p]) => {
      try { router.registerProvider(slot(vertex, p as number, m as string)); } catch {}
    });

    const gemini = new GeminiProvider();
    [
      ['gemini-2.5-flash',      6],
      ['gemini-2.5-flash-lite', 7],
    ].forEach(([m, p]) => {
      try { router.registerProvider(slot(gemini, p as number, m as string)); } catch {}
    });

    try {
      const grok = new GrokProvider();
      grok.priority = 9;
      router.registerProvider(grok);
      console.log('[ROUTER_MGR] FREE: Grok registered as final fallback');
    } catch {}

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
}
