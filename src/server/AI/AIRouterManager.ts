import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { GrokProvider } from './Router/providers/GrokProvider';
import { AIRouter } from './Router/AIRouter';

// Priority order (lower number = tried first):
// 1 = Vertex (fastest, cheapest via GCP)
// 2 = Gemini (direct API, very reliable)
// 3 = Grok  (xAI, OpenAI-compatible, great fallback)
// 4 = Claude (Anthropic, highest quality, last resort / fallback)

export class AIRouterManager {
    private static instanceFree: AIRouter | null = null;
    private static instancePro: AIRouter | null = null;

    static getRouter(namespace: 'free' | 'pro'): AIRouter {
        if (namespace === 'pro') {
            if (!this.instancePro) this.instancePro = this.createRouter('pro');
            return this.instancePro;
        } else {
            if (!this.instanceFree) this.instanceFree = this.createRouter('free');
            return this.instanceFree;
        }
    }

    // Invalidate cached instances (call after env var updates if ever needed)
    static reset() {
        this.instanceFree = null;
        this.instancePro = null;
    }

    private static createRouter(namespace: 'free' | 'pro'): AIRouter {
        const router = new AIRouter();
        console.log(`[ROUTER_MGR] Building ${namespace} router with 4-provider chain`);

        // 1. Vertex AI (priority 1)
        try {
            const vertex = new VertexProvider();
            vertex.priority = 1;
            router.registerProvider(vertex);
            console.log(`[ROUTER_MGR] ✓ VertexProvider registered`);
        } catch (e) {
            console.warn(`[ROUTER_MGR] ✗ VertexProvider failed to init:`, e);
        }

        // 2. Gemini Direct API (priority 2)
        try {
            const gemini = new GeminiProvider();
            gemini.priority = 2;
            router.registerProvider(gemini);
            console.log(`[ROUTER_MGR] ✓ GeminiProvider registered`);
        } catch (e) {
            console.warn(`[ROUTER_MGR] ✗ GeminiProvider failed to init:`, e);
        }

        // 3. Grok / xAI (priority 3) — add key GROK_API_KEY in Cloud Run env
        try {
            const grok = new GrokProvider();
            grok.priority = 3;
            router.registerProvider(grok);
            console.log(`[ROUTER_MGR] ✓ GrokProvider registered (key present: ${!!(process.env.GROK_API_KEY || process.env.XAI_API_KEY)})`);
        } catch (e) {
            console.warn(`[ROUTER_MGR] ✗ GrokProvider failed to init:`, e);
        }

        // 4. Anthropic / Claude (priority 4) — best quality, used as final fallback
        try {
            const claude = new AnthropicProvider();
            claude.priority = 4;
            router.registerProvider(claude);
            console.log(`[ROUTER_MGR] ✓ AnthropicProvider registered`);
        } catch (e) {
            console.warn(`[ROUTER_MGR] ✗ AnthropicProvider failed to init:`, e);
        }

        return router;
    }
}
