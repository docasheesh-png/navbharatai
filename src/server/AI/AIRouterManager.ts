import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { GrokProvider } from './Router/providers/GrokProvider';
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

  static getRouter(namespace: 'free' | 'pro' | 'professional'): AIRouter {
    if (namespace === 'pro') {
      if (!this.instancePro) this.instancePro = this.buildPro();
      return this.instancePro;
    }
    if (namespace === 'professional') {
      if (!this.instanceProfessional) this.instanceProfessional = this.buildProfessional();
      return this.instanceProfessional;
    }
    if (!this.instanceFree) this.instanceFree = this.buildFree();
    return this.instanceFree;
  }

  static reset() { this.instanceFree = null; this.instancePro = null; this.instanceProfessional = null; }

  // FREE: Vertex (5 models) → Gemini (3 models) → Grok. Claude NEVER used in free.
  private static buildFree(): AIRouter {
    const router = new AIRouter();
    console.log('[ROUTER_MGR] Building FREE chain: Vertex×5 → Gemini×3 → Grok');

    const vertex = new VertexProvider();
    [
      ['gemini-2.5-pro',   1],
      ['gemini-2.5-flash', 2],
      ['gemini-2.0-flash', 3],
      ['gemini-1.5-pro',   4],
      ['gemini-1.5-flash', 5],
    ].forEach(([m, p]) => {
      try { router.registerProvider(slot(vertex, p as number, m as string)); } catch {}
    });

    const gemini = new GeminiProvider();
    [
      ['gemini-2.5-flash', 6],
      ['gemini-2.0-flash', 7],
      ['gemini-1.5-pro',   8],
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

  // PRO: Claude Opus 4.8 (primary) → Sonnet 3.5 → Grok → Vertex → Gemini
  private static buildPro(): AIRouter {
    const router = new AIRouter();
    console.log('[ROUTER_MGR] Building PRO chain: Opus4.8(p1) → Sonnet3.5(p2) → Grok×2 → Vertex×5 → Gemini×3');

    try {
      const opus = new AnthropicProvider('claude-opus-4-8');
      opus.priority = 1;
      opus.enableThinking = true;
      router.registerProvider(opus);
    } catch {}

    try {
      const sonnet = new AnthropicProvider('claude-3-5-sonnet-20241022');
      sonnet.priority = 2;
      router.registerProvider(sonnet);
    } catch {}

    try {
      const grok = new GrokProvider();
      router.registerProvider(slot(grok, 3, 'grok-3'));
      router.registerProvider(slot(grok, 4, 'grok-3-fast'));
    } catch {}

    const vertex = new VertexProvider();
    [['gemini-2.5-pro',5],['gemini-2.5-flash',6],['gemini-2.0-flash',7],['gemini-1.5-pro',8],['gemini-1.5-flash',9]].forEach(([m,p]) => {
      try { router.registerProvider(slot(vertex, p as number, m as string)); } catch {}
    });

    const gemini = new GeminiProvider();
    [['gemini-2.5-flash',10],['gemini-2.0-flash',11],['gemini-1.5-pro',12]].forEach(([m,p]) => {
      try { router.registerProvider(slot(gemini, p as number, m as string)); } catch {}
    });

    return router;
  }

  // PROFESSIONAL universe (Doctor AI / SDA + every config-driven professional:
  // Teacher, Lawyer, CA, Astrologer, Kisan, …): Grok×2 → Gemini×2 → Vertex×5 →
  // Claude (last resort ONLY). Fully isolated from FREE and PRO — the professional
  // universe never shares router state with them. Core law: Grok primary, Claude
  // reachable only as the final safety net.
  private static buildProfessional(): AIRouter {
    const router = new AIRouter();
    console.log('[ROUTER_MGR] Building PROFESSIONAL chain: Grok×2 → Gemini×2 → Vertex×5 → Claude(last)');

    try {
      const grok = new GrokProvider();
      router.registerProvider(slot(grok, 1, 'grok-3'));
      router.registerProvider(slot(grok, 2, 'grok-3-fast'));
    } catch {}

    const gemini = new GeminiProvider();
    [['gemini-2.0-flash', 3], ['gemini-2.5-flash', 4]].forEach(([m, p]) => {
      try { router.registerProvider(slot(gemini, p as number, m as string)); } catch {}
    });

    const vertex = new VertexProvider();
    [['gemini-2.5-flash',5],['gemini-2.0-flash',6],['gemini-1.5-pro',7],['gemini-1.5-flash',8],['gemini-2.5-pro',9]].forEach(([m,p]) => {
      try { router.registerProvider(slot(vertex, p as number, m as string)); } catch {}
    });

    // Claude — LAST RESORT ONLY. High priority number keeps it strictly last in
    // the fallback chain, honoring the "Grok primary, Claude last" core law for SDA.
    try {
      const claude = new AnthropicProvider('claude-3-5-sonnet-20241022');
      claude.priority = 99;
      router.registerProvider(claude);
    } catch {}

    return router;
  }
}
