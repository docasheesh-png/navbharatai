import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { AIRouter } from './Router/AIRouter';
import { ModelHealthRegistry } from './HealthRegistry';

export class AIRouterManager {
    private static instanceFree: AIRouter | null = null;
    private static instancePro: AIRouter | null = null;
    private static registryFree = new ModelHealthRegistry('free');
    private static registryPro = new ModelHealthRegistry('pro');

    static getRouter(namespace: 'free' | 'pro'): AIRouter {
        if (namespace === 'pro') {
            if (!this.instancePro) {
                this.instancePro = this.createRouterInstance('pro');
            }
            return this.instancePro;
        } else {
            if (!this.instanceFree) {
                this.instanceFree = this.createRouterInstance('free');
            }
            return this.instanceFree;
        }
    }

    private static createRouterInstance(namespace: 'free' | 'pro'): AIRouter {
        const router = new AIRouter();
        console.log(`[DEBUG] Creating router for ${namespace}`);

        try {
            const vertexProvider = new VertexProvider();
            router.registerProvider(vertexProvider);
            console.log(`[DEBUG] VertexProvider registered for ${namespace}`);
        } catch (e) {
            console.error(`[ERROR] Failed to register VertexProvider for ${namespace}:`, e);
        }

        // Both free and pro get Gemini as Vertex fallback
        router.registerProvider(new GeminiProvider());
        console.log(`[DEBUG] GeminiProvider registered for ${namespace}`);

        // Anthropic only for Pro — Free stays lightweight (Vertex+Gemini only)
        if (namespace === 'pro') {
            router.registerProvider(new AnthropicProvider());
            console.log(`[DEBUG] AnthropicProvider registered for pro`);
        }

        return router;
    }
}
