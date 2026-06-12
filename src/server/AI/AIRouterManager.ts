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

  static getRouter(namespace: 'free' | 'pro'): AIRouter {
    if (namespace === 'pro') {
      if (!this.instancePro) this.instancePro = this.buildPro();
      return this.instancePro;
    }
    if (!this.instanceFree) this.instanceFree = this.buildFree();
    return this.instanceFree;
  }

  static reset() { this.instanceFree = null; this.instancePro = null; }

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

  // PRO: Claude (best quality) → Grok → Vertex → Gemini (full fallback)
  private static buildPro(): AIRouter {
    const router = new AIRouter();
    console.log('[ROUTER_MGR] Building PRO chain: Claude×2 → Grok×2 → Vertex×5 → Gemini×3');

    try {
      const claude = new AnthropicProvider();
      router.registerProvider(slot(claude, 1, 'claude-3-5-sonnet-20241022'));
      router.registerProvider(slot(claude, 2, 'claude-3-haiku-20240307'));
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
}
